/**
 * The research planner.
 *
 * The planner turns a buyer's brief into *questions*, and questions into
 * *investigation tasks*. This is the difference between "search for
 * {model}" and "establish which exact configuration this is, what it costs
 * everywhere, and what owners report after a year".
 *
 * The planner is deterministic. It reads the category profile and the skill
 * definitions and produces a prioritised task list. The adaptive stage then
 * adds tasks when the evidence comes back insufficient.
 */

import type { CategoryId, PurchaseRequirements } from '../domain/types.ts';
import { getCategory } from '../intelligence/categories/index.ts';
import { skillsForCategory } from './skills/index.ts';
import type { ResearchFactKind, ResearchSkill } from './types.ts';

/** A research question the investigation must answer. */
export interface ResearchQuestion {
  id: string;
  /** The question in plain language. */
  question: string;
  /** Why it matters to the decision. */
  rationale: string;
  /** Which fact kinds would answer it. */
  factKinds: ResearchFactKind[];
  /** How important it is, 0..1. Higher means investigated first. */
  priority: number;
  /** True when the answer is needed before any recommendation is useful. */
  blocking: boolean;
}

/** A concrete investigation task. */
export interface ResearchTask {
  id: string;
  questionId: string;
  /** The search query to issue. */
  query: string;
  /** The source type the task is aimed at. */
  sourceType: ResearchSkill['pagePreference'][number];
  /** Domains to prefer. */
  preferredDomains: string[];
  /** Fact kinds this task should produce. */
  factKinds: ResearchFactKind[];
  /** How many results to consider. */
  limit: number;
  /** Whether a browser may be needed. */
  requiresBrowser: boolean;
  /** Round this task belongs to. */
  round: number;
}

/** The plan. */
export interface ResearchPlanDocument {
  questions: ResearchQuestion[];
  tasks: ResearchTask[];
  /** The questions that must be answered before a decision is possible. */
  blockingQuestions: string[];
}

/**
 * The questions that matter for every product, whatever the category.
 *
 * These are the things a shopper is implicitly asking when they ask for a
 * recommendation, and the things a recommendation engine most often gets
 * wrong.
 */
const UNIVERSAL_QUESTIONS: ResearchQuestion[] = [
  {
    id: 'q.identity',
    question: 'What exactly is this product — which model, generation and configuration?',
    rationale:
      'Without the exact variant, every other fact risks belonging to a different product.',
    factKinds: ['model_identification', 'variant_identification'],
    priority: 1,
    blocking: true,
  },
  {
    id: 'q.price',
    question: 'What does it actually cost right now, and which discounts apply?',
    rationale:
      'The listed price is not the payable price, and the gap decides which product is cheaper.',
    factKinds: ['price', 'offer', 'delivery'],
    priority: 0.95,
    blocking: true,
  },
  {
    id: 'q.availability',
    question: 'Is it actually buyable right now?',
    rationale: 'A recommendation the user cannot act on is not a recommendation.',
    factKinds: ['stock'],
    priority: 0.8,
    blocking: false,
  },
  {
    id: 'q.specs',
    question: 'What are the specifications that actually affect the purchase decision?',
    rationale: 'The specifications decide suitability; everything else is decoration.',
    factKinds: ['specification'],
    priority: 0.9,
    blocking: true,
  },
  {
    id: 'q.ownership',
    question: 'What do owners report after living with it?',
    rationale:
      'Owner reports are the only source for comfort, heat, noise and long-term degradation.',
    factKinds: ['review_theme', 'review_complaint', 'owner_experience'],
    priority: 0.75,
    blocking: false,
  },
  {
    id: 'q.warranty',
    question: 'What is covered by warranty, and for how long?',
    rationale: 'Warranty length is one of the strongest predictors of long-term cost.',
    factKinds: ['warranty'],
    priority: 0.65,
    blocking: false,
  },
];

/** Questions a safety-sensitive category must also answer. */
const SAFETY_QUESTIONS: ResearchQuestion[] = [
  {
    id: 'q.certification',
    question: 'Does it carry the certification required for this category?',
    rationale:
      'In a safety-sensitive category an unverified product cannot be recommended, and the certification is checkable.',
    factKinds: ['certification'],
    priority: 0.95,
    blocking: true,
  },
  {
    id: 'q.authenticity',
    question: 'How can the buyer verify it is genuine?',
    rationale: 'Counterfeit risk is a category-specific hazard, not a general one.',
    factKinds: ['certification', 'owner_experience'],
    priority: 0.7,
    blocking: false,
  },
];

/** Questions a category with an ownership cost must answer. */
const OWNERSHIP_COST_QUESTIONS: ResearchQuestion[] = [
  {
    id: 'q.running_cost',
    question: 'What does it cost to run and maintain over its life?',
    rationale:
      'The running cost of an appliance or a consumable can exceed its purchase price.',
    factKinds: ['specification', 'owner_experience'],
    priority: 0.85,
    blocking: false,
  },
];

/** Fill a search template with the buyer's terms. */
export function renderTemplate(template: string, terms: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(terms)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return output.replace(/\s+/g, ' ').trim();
}

/**
 * Build the research plan for a product.
 */
export function buildResearchPlan(
  product: {
    productId: string;
    variantId: string | null;
    category: CategoryId;
    brand: string;
    model: string;
    displayName?: string;
    variantLabel?: string | null;
  },
  requirements: PurchaseRequirements,
  options: { limit?: number } = {},
): ResearchPlanDocument {
  const limit = options.limit ?? 8;
  const profile = getCategory(product.category);
  const skills = skillsForCategory(product.category);

  const questions: ResearchQuestion[] = [...UNIVERSAL_QUESTIONS];

  if (profile?.safetyCritical) questions.push(...SAFETY_QUESTIONS);
  if (profile?.ownership.annualRunningCostPaise) questions.push(...OWNERSHIP_COST_QUESTIONS);

  // The category's own skills add their questions.
  for (const skill of skills) {
    for (const kind of skill.factKinds) {
      const existing = questions.find((question) => question.factKinds.includes(kind));
      if (existing) continue;
      questions.push({
        id: `q.${skill.id}.${kind}`,
        question: skill.objective,
        rationale: skill.notes ?? 'Needed to decide whether this product fits the brief.',
        factKinds: [kind],
        priority: skill.weight,
        blocking: false,
      });
    }
  }

  // The buyer's own priorities become questions, because the brief decides
  // what matters and therefore what must be investigated.
  for (const [priority, strength] of Object.entries(requirements.priorities ?? {})) {
    if (strength < 0.4) continue;
    questions.push({
      id: `q.priority.${priority}`,
      question: `How does this perform on ${priority}, and what do independent sources say about it?`,
      rationale: `The shopper named ${priority} as a priority.`,
      factKinds: ['specification', 'review_theme', 'owner_experience'],
      priority: 0.7 + strength * 0.3,
      blocking: false,
    });
  }

  questions.sort((a, b) => b.priority - a.priority);

  /* ---------------- Tasks ---------------- */
  const terms: Record<string, string> = {
    brand: product.brand,
    model: product.model,
    terms:
      product.displayName ??
      [product.brand, product.model, product.variantLabel].filter(Boolean).join(' '),
    variant: product.variantLabel ?? '',
  };

  const tasks: ResearchTask[] = [];
  let taskCounter = 0;

  for (const skill of skills) {
    const question = questions.find((entry) =>
      skill.factKinds.some((kind) => entry.factKinds.includes(kind)),
    );

    for (const template of skill.searches) {
      const query = renderTemplate(template, terms);
      if (!query) continue;
      tasks.push({
        id: `t.${taskCounter++}`,
        questionId: question?.id ?? 'q.specs',
        query,
        sourceType: skill.pagePreference[0] ?? 'retailer',
        preferredDomains: skill.preferredDomains,
        factKinds: skill.factKinds,
        limit,
        requiresBrowser: skill.requiresBrowser,
        round: 0,
      });
    }
  }

  return {
    questions,
    tasks,
    blockingQuestions: questions.filter((question) => question.blocking).map((question) => question.id),
  };
}

/**
 * Build the follow-up tasks for a second round.
 *
 * This is the adaptive part. It is called when the first round came back
 * with a conflict, a gap in a blocking question, or a risk that deserves
 * another look. Each reason produces a *different* question, so the second
 * round is genuinely new work rather than a repeat.
 */
export function buildFollowUpTasks(
  plan: ResearchPlanDocument,
  reasons: {
    /** Questions with no evidence at all. */
    unanswered: string[];
    /** Questions where sources disagreed. */
    conflicted: string[];
    /** Risks that deserve a second look. */
    risks: string[];
  },
  terms: Record<string, string>,
  options: { limit?: number } = {},
): ResearchTask[] {
  const limit = options.limit ?? 6;
  const tasks: ResearchTask[] = [];
  let counter = 0;

  const byId = new Map(plan.questions.map((question) => [question.id, question]));

  // 1. A question with no evidence gets a differently-angled search.
  for (const questionId of reasons.unanswered) {
    const question = byId.get(questionId);
    if (!question) continue;
    const kind = question.factKinds[0] ?? 'specification';
    tasks.push({
      id: `f.${counter++}`,
      questionId,
      query: renderTemplate(`${terms.terms ?? ''} ${angleForKind(kind)}`.trim(), terms),
      sourceType: 'review_site',
      preferredDomains: [],
      factKinds: question.factKinds,
      limit,
      requiresBrowser: false,
      round: 1,
    });
  }

  // 2. A conflict gets a tie-breaking search aimed at the primary source.
  for (const questionId of reasons.conflicted) {
    const question = byId.get(questionId);
    if (!question) continue;
    tasks.push({
      id: `f.${counter++}`,
      questionId,
      query: renderTemplate(
        `${terms.brand} ${terms.model} official specifications ${question.factKinds[0] ?? ''}`,
        terms,
      ),
      sourceType: 'manufacturer',
      preferredDomains: [],
      factKinds: question.factKinds,
      limit,
      requiresBrowser: false,
      round: 1,
    });
  }

  // 3. A risk gets a targeted search on the risk itself.
  for (const risk of reasons.risks) {
    tasks.push({
      id: `f.${counter++}`,
      questionId: 'q.risk',
      query: renderTemplate(`${terms.terms ?? ''} ${risk}`.trim(), terms),
      sourceType: 'community',
      preferredDomains: [],
      factKinds: ['owner_experience', 'review_complaint'],
      limit,
      requiresBrowser: false,
      round: 1,
    });
  }

  return tasks;
}

/** A search angle for a fact kind that came back empty. */
function angleForKind(kind: ResearchFactKind): string {
  switch (kind) {
    case 'price':
    case 'offer':
      return 'price discount offer buy';
    case 'stock':
      return 'in stock availability';
    case 'warranty':
      return 'warranty coverage service';
    case 'compatibility':
      return 'compatible fits upgrade';
    case 'certification':
      return 'certified BIS ISI approved standard';
    case 'ingredients':
      return 'ingredients full list composition';
    case 'nutrition':
      return 'nutrition facts per serving';
    case 'review_theme':
    case 'review_complaint':
    case 'owner_experience':
      return 'long term review problems experience';
    default:
      return 'full specifications details review';
  }
}
