/**
 * Category-aware follow-up questions.
 *
 * The generic question bank asks about battery, camera and display,
 * because that is what most shopping is. A shopper buying shoes is
 * asked about something else entirely: what the shoe is for, and what
 * size they wear.
 *
 * A category can declare its own questions. They replace the generic
 * ones for that category, so the conversation stays short and every
 * question is one whose answer changes the shortlist.
 *
 * A question declares when it is worth asking. That is what keeps the
 * conversation from becoming a questionnaire.
 */

import type { CategoryId } from '../domain/types.ts';

/** The profile the question's relevance test reads. */
export interface QuestionContext {
  /** The category, once it is known. */
  category: CategoryId | null;
  /** The buyer's stated usage, as workload tags. */
  usage: string[];
  /** The buyer's stated priorities. */
  priorities: Record<string, number>;
  /** The buyer's hard requirements. */
  mustHaves: string[];
  /** What the shopper said, verbatim. */
  rawStatements: string[];
  /** The buyer's context, such as their bank. */
  context: Record<string, unknown>;
}

/** A category-specific question. */
export interface CategoryQuestion {
  id: string;
  /** The question as the shopper sees it. */
  prompt: string;
  /** Why this question is being asked. */
  why: string;
  /** The fixed options, when there are any. */
  options?: { label: string; value: string; priority?: string }[];
  /** Whether "you decide" is offered. */
  allowDelegate: boolean;
  /** Is this question worth asking? */
  isRelevant: (context: QuestionContext) => boolean;
  /** The priority this answer sets, when it sets one. */
  priority?: string;
}

/* ------------------------------------------------------------------ */
/* The shoe questions                                                   */
/* ------------------------------------------------------------------ */

/**
 * The footwear questions.
 *
 * The order is deliberate. The intended use comes first, because it
 * decides which shoes are even in the running. Then size, because a shoe
 * recommendation without a size is not actionable. Then the trade-off
 * the shopper is actually weighing.
 */
const SHOE_QUESTIONS: CategoryQuestion[] = [
  {
    id: 'shoes.use',
    prompt: 'What will you wear them for most — running, walking, gym, casual days, formal occasions, or a specific sport?',
    why: 'A running shoe and a formal shoe fail in different ways, so the ranking changes completely with the intended use.',
    options: [
      { label: 'Running and jogging', value: 'running', priority: 'cushioning' },
      { label: 'Walking and everyday use', value: 'walking', priority: 'comfort' },
      { label: 'Gym and training', value: 'gym', priority: 'grip' },
      { label: 'Casual everyday wear', value: 'casual', priority: 'style' },
      { label: 'Formal or office wear', value: 'formal', priority: 'style' },
      { label: 'A specific sport', value: 'sports', priority: 'grip' },
      { label: 'Hiking and outdoor', value: 'hiking', priority: 'durability' },
    ],
    allowDelegate: true,
    isRelevant: (context) =>
      !context.usage.some((usage) =>
        ['running', 'walking', 'gym', 'casual', 'formal', 'sports', 'hiking'].includes(usage),
      ),
  },
  {
    id: 'shoes.size',
    prompt: 'What size do you usually wear, and in which standard — UK, US or EU?',
    why: 'Size and standard define the exact sellable item, and shoe sizes are not standardised between brands.',
    options: [
      { label: 'UK', value: 'UK' },
      { label: 'US', value: 'US' },
      { label: 'EU', value: 'EU' },
      { label: 'India', value: 'IN' },
    ],
    allowDelegate: true,
    isRelevant: (context) => context.usage.length > 0 && context.context.shoeSize === undefined,
  },
  {
    id: 'shoes.fit',
    prompt: 'How do your shoes usually fit — narrow, standard, or wide? Do any of them run small or large?',
    why: 'Owners repeatedly report that a shoe runs small or that the published size chart is wrong. That is the single most common reason a shoe purchase goes wrong.',
    options: [
      { label: 'Narrow, and they often run small', value: 'narrow_small' },
      { label: 'Standard fit', value: 'standard' },
      { label: 'Wide', value: 'wide' },
      { label: 'They usually run large', value: 'large' },
      { label: 'Not sure', value: 'unknown' },
    ],
    allowDelegate: true,
    isRelevant: (context) => context.usage.length > 0 && context.context.shoeFit === undefined,
  },
  {
    id: 'shoes.tradeoff',
    prompt: 'What matters most to you — a soft cushioned ride, a durable shoe that lasts, a light shoe, or a good-looking one?',
    why: 'This decides which dimension the ranking leans on, and it is a genuine trade-off rather than a preference for everything at once.',
    options: [
      { label: 'Cushioning and a soft ride', value: 'cushioning', priority: 'cushioning' },
      { label: 'Durability that lasts', value: 'durability', priority: 'durability' },
      { label: 'Lightweight', value: 'weight', priority: 'weight' },
      { label: 'Looks and style', value: 'style', priority: 'style' },
      { label: 'Grip and stability', value: 'grip', priority: 'grip' },
      { label: 'Value for money', value: 'value', priority: 'value' },
    ],
    allowDelegate: true,
    isRelevant: (context) =>
      context.usage.length > 0 &&
      Object.keys(context.priorities).length === 0,
  },
  {
    id: 'shoes.gender',
    prompt: 'Are these for a man, a woman, or unisex?',
    why: "Men's and women's shoes are different lasts even at the same size, so this changes which listings are the right ones.",
    options: [
      { label: "Men's", value: 'Men' },
      { label: "Women's", value: 'Women' },
      { label: 'Unisex', value: 'Unisex' },
    ],
    allowDelegate: true,
    isRelevant: (context) => context.usage.length > 0 && context.context.shoeGender === undefined,
  },
];

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

/** The category-specific questions, by category. */
const BY_CATEGORY = new Map<CategoryId, CategoryQuestion[]>([['shoes', SHOE_QUESTIONS]]);

/**
 * The questions for a category.
 *
 * A category with no specific questions gets an empty list, and the
 * caller falls back to the generic questions.
 */
export function categoryQuestions(category: CategoryId | null): CategoryQuestion[] {
  if (!category) return [];
  return BY_CATEGORY.get(category) ?? [];
}

/**
 * The next category-specific questions worth asking.
 *
 * At most `limit` are returned, and only those whose answer would change
 * the shortlist.
 */
export function selectCategoryQuestions(
  context: QuestionContext,
  asked: string[],
  limit = 2,
): CategoryQuestion[] {
  const pool = categoryQuestions(context.category);
  return pool
    .filter((question) => !asked.includes(question.id))
    .filter((question) => question.isRelevant(context))
    .slice(0, limit);
}

/**
 * Apply a category question's answer to the buyer context.
 *
 * The answer sets a usage tag, a priority, or a context value.
 */
export function applyCategoryAnswer(
  question: CategoryQuestion,
  answer: string,
  context: QuestionContext,
): void {
  const option = question.options?.find(
    (entry) => entry.value.toLowerCase() === answer.trim().toLowerCase(),
  );

  const value = option?.value ?? answer.trim();
  const lower = value.toLowerCase();

  if (/you decide|your call|whatever/.test(lower)) return;

  switch (question.id) {
    case 'shoes.use': {
      const use = option?.value ?? detectUse(answer);
      if (use && !context.usage.includes(use)) context.usage.push(use);
      if (option?.priority && context.priorities[option.priority] === undefined) {
        context.priorities[option.priority] = 0.85;
      }
      break;
    }
    case 'shoes.size': {
      const standard = option?.value ?? 'UK';
      context.context.shoeSize = { standard, value: answer.trim() };
      break;
    }
    case 'shoes.fit': {
      context.context.shoeFit = option?.value ?? answer.trim().toLowerCase();
      break;
    }
    case 'shoes.tradeoff': {
      const priority = option?.priority ?? mapTradeoff(value);
      if (priority) context.priorities[priority] = 0.9;
      break;
    }
    case 'shoes.gender': {
      context.context.shoeGender = option?.value ?? answer.trim();
      break;
    }
    default:
      break;
  }
}

/** Read the intended use out of a free-text answer. */
function detectUse(answer: string): string | null {
  const lower = answer.toLowerCase();
  const map: [string, RegExp][] = [
    ['running', /running|jogging|marathon|road/],
    ['hiking', /hik|trek|outdoor|trail/],
    ['gym', /gym|training|workout|lifting/],
    ['sports', /cricket|football|soccer|basketball|tennis|badminton/],
    ['walking', /walk|commut/],
    ['formal', /formal|office|office wear|dress/],
    ['casual', /casual|everyday|daily/],
  ];
  for (const [use, pattern] of map) {
    if (pattern.test(lower)) return use;
  }
  return null;
}

/** Map a free-text trade-off answer onto a priority. */
function mapTradeoff(value: string): string | null {
  const lower = value.toLowerCase();
  const map: [string, RegExp][] = [
    ['cushioning', /cushion|soft|plush|comfort/],
    ['durability', /durab|last|longevity/],
    ['weight', /light|weight/],
    ['style', /look|style|appear/],
    ['grip', /grip|traction|stable|stability/],
    ['value', /value|worth|price|money/],
    ['breathability', /breath|ventilat/],
  ];
  for (const [priority, pattern] of map) {
    if (pattern.test(lower)) return priority;
  }
  return null;
}
