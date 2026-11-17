/**
 * The buying conversation.
 *
 * A shopper does not arrive with a specification sheet. They arrive with a
 * half-formed idea: "a laptop under ₹70,000 for backend work, some gaming,
 * and small local models, and I want it to last".
 *
 * This module turns that into a structured buyer profile and holds the
 * conversation that fills the gaps. The rules:
 *
 *  - **Conditional.** A question is only asked when its answer would change
 *    which products are recommended. There is no static questionnaire.
 *  - **Bounded.** At most two questions are outstanding at a time, and at
 *    most four are asked in total.
 *  - **Skippable.** Every question can be skipped, and the shopper can say
 *    "you decide" and get a recommendation from what is known.
 *  - **Honest.** When a profile cannot be completed, the gaps are reported
 *    in the decision rather than filled with an assumption.
 */

import { randomUUID } from 'node:crypto';

import type {
  CategoryId,
  PurchaseRequirements,
} from '../domain/types.ts';
import { getCategory } from '../intelligence/categories/index.ts';
import { detectCategoryFromText } from '../intelligence/categories/types.ts';
import { parseBudget } from './intent.ts';
import {
  applyCategoryAnswer,
  categoryQuestions,
  selectCategoryQuestions,
  type CategoryQuestion,
  type QuestionContext,
} from './category-questions.ts';
import { parseRequirements } from './intent.ts';

/* ------------------------------------------------------------------ */
/* The profile                                                         */
/* ------------------------------------------------------------------ */

/**
 * A structured buyer profile.
 *
 * Every field records where it came from: the shopper said it, the system
 * inferred it, or it is still open. Nothing is silently assumed.
 */
export interface BuyerProfile {
  /** The category, once it is known. */
  category: CategoryId | null;
  /** How the category was determined. */
  categorySource: 'stated' | 'inferred' | 'unknown';
  /** The budget ceiling, in paise. */
  budgetMaxPaise: number | null;
  budgetMinPaise: number | null;
  budgetSource: 'stated' | 'inferred' | 'unknown';
  /** What the shopper will use it for. */
  usage: string[];
  usageSource: 'stated' | 'inferred' | 'unknown';
  /** What matters most, with weights. */
  priorities: Record<string, number>;
  /** Things that are not negotiable. */
  mustHaves: string[];
  /** Things the shopper will accept a compromise on. */
  acceptableCompromises: string[];
  /** How long the shopper expects to keep it. */
  expectedLifespanYears: number | null;
  /** The shopper's own context, e.g. an existing phone or an HDFC card. */
  context: Record<string, unknown>;
  /** The questions already asked and answered. */
  answeredQuestions: string[];
  /** The questions the shopper skipped. */
  skippedQuestions: string[];
  /** The raw text of everything the shopper said. */
  rawStatements: string[];
}

function emptyProfile(): BuyerProfile {
  return {
    category: null,
    categorySource: 'unknown',
    budgetMaxPaise: null,
    budgetMinPaise: null,
    budgetSource: 'unknown',
    usage: [],
    usageSource: 'unknown',
    priorities: {},
    mustHaves: [],
    acceptableCompromises: [],
    expectedLifespanYears: null,
    context: {},
    answeredQuestions: [],
    skippedQuestions: [],
    rawStatements: [],
  };
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

/** How a question's answer is applied to the profile. */
export type ProfileUpdate =
  | { kind: 'category'; value: CategoryId }
  | { kind: 'budgetMax'; value: number }
  | { kind: 'budgetMin'; value: number }
  | { kind: 'usage'; value: string }
  | { kind: 'priority'; value: string; weight: number }
  | { kind: 'mustHave'; value: string }
  | { kind: 'compromise'; value: string }
  | { kind: 'lifespan'; value: number }
  | { kind: 'context'; key: string; value: unknown }
  | { kind: 'none' };

export interface ConversationQuestion {
  id: string;
  /** The question as the shopper sees it. */
  prompt: string;
  /** Why this question is being asked. */
  why: string;
  /** The options, when the question has a fixed set. */
  options?: { label: string; value: string; update: ProfileUpdate }[];
  /** Whether "you decide" is offered. */
  allowDelegate: boolean;
  /** The categories the question applies to. */
  categories: CategoryId[] | null;
  /**
   * Is this question worth asking? A question whose answer would not change
   * the shortlist is not asked.
   */
  isRelevant: (profile: BuyerProfile) => boolean;
  /** How the answer updates the profile. */
  apply: (profile: BuyerProfile, answer: string) => ProfileUpdate;
}

/* ------------------------------------------------------------------ */
/* The question bank                                                   */
/* ------------------------------------------------------------------ */

/**
 * The questions.
 *
 * Each declares when it is worth asking. That is what keeps the
 * conversation short: a shopper who says "just give me the best under ₹50,000"
 * is never asked about expected lifespan.
 */
export const QUESTIONS: ConversationQuestion[] = [
  {
    id: 'q.category',
    prompt: 'What kind of product are you looking for — a laptop, a phone, an appliance, something else?',
    why: 'The category decides which specifications and risks matter at all.',
    allowDelegate: false,
    categories: null,
    isRelevant: (profile) => profile.category === null,
    apply: (profile, answer) => {
      const detected = detectCategoryFromText(answer);
      return detected ? { kind: 'category', value: detected } : { kind: 'none' };
    },
  },
  {
    id: 'q.budget',
    prompt: 'What is your budget? A rough ceiling is enough — for example "under ₹50,000".',
    why: 'The budget decides which products are even considered.',
    allowDelegate: false,
    categories: null,
    isRelevant: (profile) => profile.budgetMaxPaise === null,
    apply: (_profile, answer) => {
      const budget = parseBudget(answer);
      return budget.maxPaise !== null
        ? { kind: 'budgetMax', value: budget.maxPaise }
        : budget.minPaise !== null
          ? { kind: 'budgetMin', value: budget.minPaise }
          : { kind: 'none' };
    },
  },
  {
    id: 'q.usage',
    prompt: 'What will you mainly use it for? That decides what the ranking should favour.',
    why: 'Usage changes what matters: a battery matters more for travel than for a desk.',
    options: [
      { label: 'Work and study', value: 'office', update: { kind: 'usage', value: 'office' } },
      { label: 'Heavy work — development, editing', value: 'programming', update: { kind: 'usage', value: 'programming' } },
      { label: 'Gaming', value: 'gaming', update: { kind: 'usage', value: 'gaming' } },
      { label: 'Travel and daily use', value: 'travel', update: { kind: 'usage', value: 'travel' } },
      { label: 'Running AI models locally', value: 'local_ai', update: { kind: 'usage', value: 'local_ai' } },
    ],
    allowDelegate: true,
    categories: null,
    isRelevant: (profile) => profile.usage.length === 0,
    apply: (_profile, answer) => {
      const lower = answer.toLowerCase();
      if (/you decide|your call|whatever/.test(lower)) return { kind: 'none' };
      const known: [string, RegExp][] = [
        ['programming', /code|develop|program|backend|frontend|devops|work|office|study/i],
        ['gaming', /game|gaming|play/i],
        ['local_ai', /ai|llm|model|ollama|local/i],
        ['travel', /travel|commute|trip|outdoor/i],
        ['office', /office|browsing|email|daily|casual/i],
      ];
      for (const [value, pattern] of known) {
        if (pattern.test(lower)) return { kind: 'usage', value };
      }
      return { kind: 'none' };
    },
  },
  {
    id: 'q.priority',
    prompt: 'What matters most to you — battery, camera, performance, display, or something else?',
    why: 'The priorities decide how the evidence is weighted.',
    options: [
      { label: 'Battery life', value: 'battery', update: { kind: 'priority', value: 'battery', weight: 0.9 } },
      { label: 'Camera', value: 'camera', update: { kind: 'priority', value: 'camera', weight: 0.9 } },
      { label: 'Performance', value: 'performance', update: { kind: 'priority', value: 'performance', weight: 0.9 } },
      { label: 'Display', value: 'display', update: { kind: 'priority', value: 'display', weight: 0.9 } },
      { label: 'Value for money', value: 'value', update: { kind: 'priority', value: 'value', weight: 0.9 } },
      { label: 'Durability', value: 'durability', update: { kind: 'priority', value: 'durability', weight: 0.9 } },
    ],
    allowDelegate: true,
    categories: null,
    isRelevant: (profile) => Object.keys(profile.priorities).length === 0 && profile.usage.length > 0,
    apply: (_profile, answer) => {
      const lower = answer.toLowerCase();
      const known: [string, RegExp][] = [
        ['battery', /battery/],
        ['camera', /camera|photo/],
        ['performance', /performance|speed|fast/],
        ['display', /display|screen/],
        ['value', /value|worth|price|cheap/],
        ['durability', /durab|long|last/],
        ['running_cost', /running cost|electricity|bijli|maintenance/],
        ['service', /service|warranty|repair|support/],
        ['compatibility', /compatib|fit|works with/],
        ['safety', /safe|safety/],
        ['authenticity', /authentic|genuine|original|fake/],
      ];
      for (const [value, pattern] of known) {
        if (pattern.test(lower)) return { kind: 'priority', value, weight: 0.9 };
      }
      return { kind: 'none' };
    },
  },
  {
    id: 'q.lifespan',
    prompt: 'How long do you expect to keep it — two years, or four to five?',
    why:
      'A product bought for two years is judged on price; one bought for five is judged on reliability, warranty and repair.',
    options: [
      { label: 'One to two years', value: '2', update: { kind: 'lifespan', value: 2 } },
      { label: 'Three years', value: '3', update: { kind: 'lifespan', value: 3 } },
      { label: 'Four to five years', value: '5', update: { kind: 'lifespan', value: 5 } },
    ],
    allowDelegate: true,
    categories: ['laptop', 'smartphone', 'tv', 'appliance', 'furniture', 'camera', 'audio'],
    isRelevant: (profile) =>
      profile.expectedLifespanYears === null &&
      profile.usage.length > 0 &&
      profile.category !== null,
    apply: (_profile, answer) => {
      const match = answer.match(/(\d+)/);
      if (!match?.[1]) return { kind: 'none' };
      const years = Number(match[1]);
      if (!Number.isFinite(years) || years <= 0) return { kind: 'none' };
      return { kind: 'lifespan', value: years };
    },
  },
  {
    id: 'q.mustHave',
    prompt: 'Is there anything you absolutely cannot compromise on? For example "must have 16GB RAM" or "must be under 5 kg".',
    why: 'A hard requirement removes products outright rather than just ranking them lower.',
    allowDelegate: true,
    categories: null,
    isRelevant: (profile) =>
      profile.mustHaves.length === 0 &&
      profile.category !== null &&
      profile.budgetMaxPaise !== null,
    apply: (_profile, answer) => {
      const trimmed = answer.trim();
      if (!trimmed || /you decide|nothing|no|any/i.test(trimmed)) return { kind: 'none' };
      return { kind: 'mustHave', value: trimmed };
    },
  },
  {
    id: 'q.bank',
    prompt: 'Which bank card do you pay with? Bank and card offers only apply to specific banks.',
    why: 'A bank discount worth thousands is only counted if the shopper actually holds the card.',
    options: [
      { label: 'HDFC Bank', value: 'HDFC Bank', update: { kind: 'context', key: 'bank', value: 'HDFC Bank' } },
      { label: 'ICICI Bank', value: 'ICICI Bank', update: { kind: 'context', key: 'bank', value: 'ICICI Bank' } },
      { label: 'Axis Bank', value: 'Axis Bank', update: { kind: 'context', key: 'bank', value: 'Axis Bank' } },
      { label: 'SBI Card', value: 'SBI Card', update: { kind: 'context', key: 'bank', value: 'SBI Card' } },
      { label: 'None / prefer no card offer', value: '', update: { kind: 'context', key: 'bank', value: null } },
    ],
    allowDelegate: true,
    categories: null,
    isRelevant: (profile) =>
      profile.context.bank === undefined &&
      profile.category !== null &&
      profile.budgetMaxPaise !== null,
    apply: (_profile, answer) => {
      const lower = answer.toLowerCase();
      for (const bank of ['HDFC', 'ICICI', 'Axis', 'SBI', 'Kotak', 'Yes Bank', 'IDFC', 'Paytm']) {
        if (lower.includes(bank.toLowerCase())) {
          const full = bank === 'HDFC' ? 'HDFC Bank' : bank === 'ICICI' ? 'ICICI Bank' : bank === 'Axis' ? 'Axis Bank' : bank === 'SBI' ? 'SBI Card' : bank;
          return { kind: 'context', key: 'bank', value: full };
        }
      }
      return { kind: 'context', key: 'bank', value: null };
    },
  },
];

/* ------------------------------------------------------------------ */
/* The session                                                         */
/* ------------------------------------------------------------------ */

export interface ConversationSession {
  id: string;
  profile: BuyerProfile;
  /** The questions still outstanding. */
  outstanding: string[];
  /** The turns of the conversation. */
  turns: { role: 'shopper' | 'assistant'; text: string; at: string }[];
  createdAt: string;
  updatedAt: string;
  /** True when the shopper has said "you decide". */
  delegated: boolean;
  /** How many questions have been asked. */
  questionsAsked: number;
}

const MAX_QUESTIONS = 4;
const MAX_OUTSTANDING = 2;

const sessions = new Map<string, ConversationSession>();

/* ------------------------------------------------------------------ */
/* Profile updates                                                     */
/* ------------------------------------------------------------------ */

/** Apply an update to a profile. */
export function applyUpdate(profile: BuyerProfile, update: ProfileUpdate): void {
  switch (update.kind) {
    case 'category':
      profile.category = update.value;
      profile.categorySource = 'inferred';
      break;
    case 'budgetMax':
      profile.budgetMaxPaise = update.value;
      profile.budgetSource = 'stated';
      break;
    case 'budgetMin':
      profile.budgetMinPaise = update.value;
      profile.budgetSource = 'stated';
      break;
    case 'usage':
      if (!profile.usage.includes(update.value)) {
        profile.usage.push(update.value);
        profile.usageSource = 'stated';
      }
      break;
    case 'priority':
      profile.priorities[update.value] = update.weight;
      break;
    case 'mustHave':
      if (!profile.mustHaves.includes(update.value)) profile.mustHaves.push(update.value);
      break;
    case 'compromise':
      if (!profile.acceptableCompromises.includes(update.value)) {
        profile.acceptableCompromises.push(update.value);
      }
      break;
    case 'lifespan':
      profile.expectedLifespanYears = update.value;
      break;
    case 'context':
      profile.context[update.key] = update.value;
      break;
    case 'none':
      break;
  }
}

/**
 * Fold a free-text statement into the profile.
 *
 * This is what lets a shopper answer in prose rather than picking from a
 * list — "I want it to last 4-5 years" updates the lifespan without the
 * shopper having to answer a form.
 */
export function ingestStatement(profile: BuyerProfile, text: string): void {
  profile.rawStatements.push(text);

  // A category.
  if (profile.category === null) {
    const detected = detectCategoryFromText(text);
    if (detected) {
      profile.category = detected;
      profile.categorySource = 'inferred';
    }
  }

  // A budget.
  if (profile.budgetMaxPaise === null || profile.budgetMinPaise === null) {
    const budget = parseBudget(text);
    if (budget.maxPaise !== null) {
      profile.budgetMaxPaise = budget.maxPaise;
      profile.budgetSource = 'stated';
    }
    if (budget.minPaise !== null) {
      profile.budgetMinPaise = budget.minPaise;
      profile.budgetSource = 'stated';
    }
  }

  // Lifespan: "last 4-5 years", "for 2 years", "long term".
  const lifespanMatch = text.match(/(\d+)\s*(?:-|to)?\s*(\d+)?\s*years?/i);
  if (lifespanMatch?.[1] && profile.expectedLifespanYears === null) {
    const first = Number(lifespanMatch[1]);
    const second = lifespanMatch[2] ? Number(lifespanMatch[2]) : null;
    if (Number.isFinite(first)) {
      profile.expectedLifespanYears = second && Number.isFinite(second) ? Math.max(first, second) : first;
    }
  }

  // Priorities mentioned in prose.
  const priorityWords: [string, RegExp][] = [
    ['battery', /battery/i],
    ['camera', /camera|photo/i],
    ['performance', /performance|fast|speed/i],
    ['display', /display|screen/i],
    ['value', /\bvalue\b|worth|cheap/i],
    ['durability', /durab|long|last|lasting/i],
    ['running_cost', /running cost|electricity|bijli|maintenance/i],
    ['service', /service|warranty|repair|support/i],
    ['compatibility', /compatib|works with/i],
    ['safety', /\bsafe\b|safety/i],
    ['authenticity', /authentic|genuine/i],
  ];
  for (const [key, pattern] of priorityWords) {
    if (pattern.test(text) && profile.priorities[key] === undefined) {
      profile.priorities[key] = 0.85;
    }
  }

  // Workloads.
  const workloadWords: [string, RegExp][] = [
    ['programming', /\bcode|develop|program|backend|frontend|devops|software engineer/i],
    ['gaming', /\bgame|gaming|play\b/i],
    ['local_ai', /\bai\b|llm|ollama|local model|run models/i],
    ['video_editing', /edit|premiere|final cut|video/i],
    ['travel', /travel|commute|trip/i],
    ['office', /office|browsing|email|daily use/i],
    ['photography', /photo|camera work|portrait/i],
  ];
  for (const [key, pattern] of workloadWords) {
    if (pattern.test(text) && !profile.usage.includes(key)) {
      profile.usage.push(key);
      profile.usageSource = 'stated';
    }
  }

  // An explicit "you decide".
  if (/\byou decide\b|\byour call\b|\bwhatever you\b|\bjust recommend\b/i.test(text)) {
    profile.acceptableCompromises.push('you_decide');
  }
}

/* ------------------------------------------------------------------ */
/* Question selection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Choose the questions to ask.
 *
 * Only questions whose answer would change the shortlist are asked, and at
 * most two at a time.
 */
export function selectQuestions(profile: BuyerProfile, asked: string[]): ConversationQuestion[] {
  const eligible = QUESTIONS.filter((question) => {
    if (asked.includes(question.id)) return false;
    if (question.categories && profile.category && !question.categories.includes(profile.category)) {
      return false;
    }
    return question.isRelevant(profile);
  });

  // The category and the budget come first — nothing else can be judged
  // without them. These two are asked for every category, because they
  // are about the search rather than about the product.
  const universalOrder = ['q.category', 'q.budget'];
  const genericOrder = ['q.usage', 'q.priority', 'q.lifespan', 'q.mustHave', 'q.bank'];

  const universal = eligible
    .filter((question) => universalOrder.includes(question.id))
    .sort((a, b) => universalOrder.indexOf(a.id) - universalOrder.indexOf(b.id));

  const generic = eligible
    .filter((question) => !universalOrder.includes(question.id))
    .sort((a, b) => genericOrder.indexOf(a.id) - genericOrder.indexOf(b.id));

  // A category with its own questions uses them in place of the generic
  // ones, because a question about battery life is a waste of a
  // shopper's time when they are buying a shoe.
  const categorySpecific = selectCategoryQuestions(
    toQuestionContext(profile),
    asked,
    MAX_OUTSTANDING,
  ).map(toConversationQuestion);

  if (categorySpecific.length > 0) {
    return [...universal, ...categorySpecific].slice(0, MAX_OUTSTANDING);
  }

  return [...universal, ...generic].slice(0, MAX_OUTSTANDING);
}

/**
 * A category's own question, by id.
 */
export function categoryQuestionById(
  category: CategoryId | null,
  questionId: string,
): ConversationQuestion | null {
  const question = categoryQuestions(category).find((entry) => entry.id === questionId);
  return question ? toConversationQuestion(question) : null;
}

/**
 * The context the category questions read.
 */
export function toQuestionContext(profile: BuyerProfile): QuestionContext {
  return {
    category: profile.category,
    usage: profile.usage,
    priorities: profile.priorities,
    mustHaves: profile.mustHaves,
    rawStatements: profile.rawStatements,
    context: profile.context,
  };
}

/**
 * Present a category question through the conversation's own shape, so
 * the API and the UI do not need to know where the question came from.
 */
function toConversationQuestion(question: CategoryQuestion): ConversationQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    why: question.why,
    allowDelegate: question.allowDelegate,
    categories: null,
    options: question.options?.map((option) => ({
      label: option.label,
      value: option.value,
      update: { kind: 'none' },
    })),
    isRelevant: () => true,
    apply: (profile, answer) => {
      applyCategoryAnswer(question, answer, toQuestionContext(profile));
      return { kind: 'none' };
    },
  };
}

/** Is the profile complete enough to make a recommendation? */
export function isProfileSufficient(profile: BuyerProfile): boolean {
  if (profile.category === null) return false;
  if (profile.budgetMaxPaise === null) return false;
  // Usage is strongly recommended but not strictly required: the decision
  // engine reports the absence as a gap rather than refusing to answer.
  return true;
}

/* ------------------------------------------------------------------ */
/* Conversation operations                                              */
/* ------------------------------------------------------------------ */

/** Start a conversation from the shopper's opening message. */
export function startConversation(message: string): ConversationSession {
  const profile = emptyProfile();
  ingestStatement(profile, message);

  const session: ConversationSession = {
    id: randomUUID(),
    profile,
    outstanding: [],
    turns: [
      { role: 'shopper', text: message, at: new Date().toISOString() },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    delegated: false,
    questionsAsked: 0,
  };

  sessions.set(session.id, session);
  refreshQuestions(session);
  return session;
}

/** Read a session. */
export function getConversation(id: string): ConversationSession | null {
  return sessions.get(id) ?? null;
}

/** Every session, for the operator. */
export function listConversations(): ConversationSession[] {
  return [...sessions.values()];
}

/**
 * Answer an outstanding question.
 *
 * A free-text answer is accepted as well as one of the offered options, so
 * the shopper can always say "you decide" or answer in their own words.
 */
export function answerQuestion(
  sessionId: string,
  questionId: string,
  answer: string,
): { session: ConversationSession | null; question: ConversationQuestion | null; error: string | null } {
  const session = sessions.get(sessionId);
  if (!session) return { session: null, question: null, error: 'No such conversation.' };

  // The question may be a generic one or one of the category's own.
  const question =
    QUESTIONS.find((entry) => entry.id === questionId) ??
    categoryQuestionById(session.profile.category, questionId);
  if (!question) return { session, question: null, error: 'No such question.' };

  session.turns.push({ role: 'shopper', text: answer, at: new Date().toISOString() });

  // "You decide" ends the questioning.
  if (/\byou decide\b|\byour call\b|\bwhatever\b|\bjust tell me\b|\bno more questions\b/i.test(answer)) {
    session.delegated = true;
    session.profile.acceptableCompromises.push('you_decide');
    session.profile.answeredQuestions.push(questionId);
    session.outstanding = session.outstanding.filter((id) => id !== questionId);
    refreshQuestions(session);
    return { session, question, error: null };
  }

  // An option match takes precedence, because the option carries the
  // precise update.
  const option = question.options?.find(
    (entry) => entry.value.toLowerCase() === answer.trim().toLowerCase(),
  );

  const update = option ? option.update : question.apply(session.profile, answer);
  applyUpdate(session.profile, update);

  // Free-text answers are also folded in generally, so a shopper who writes
  // "it must have 32GB RAM" updates the profile even if the question was
  // asking something else.
  ingestStatement(session.profile, answer);

  session.profile.answeredQuestions.push(questionId);
  session.outstanding = session.outstanding.filter((id) => id !== questionId);
  refreshQuestions(session);

  return { session, question, error: null };
}

/** Skip a question. */
export function skipQuestion(
  sessionId: string,
  questionId: string,
): { session: ConversationSession | null; error: string | null } {
  const session = sessions.get(sessionId);
  if (!session) return { session: null, error: 'No such conversation.' };

  session.profile.skippedQuestions.push(questionId);
  session.outstanding = session.outstanding.filter((id) => id !== questionId);
  refreshQuestions(session);
  return { session, error: null };
}

/** Recompute the outstanding questions. */
function refreshQuestions(session: ConversationSession): void {
  const asked = [
    ...session.profile.answeredQuestions,
    ...session.profile.skippedQuestions,
  ];

  if (session.delegated) {
    session.outstanding = [];
    return;
  }

  // The budget counts against the question budget, because a shopper
  // who has already answered it has given us what we needed.
  //
  // The count is of questions *answered*, not questions *offered*. The
  // engine offers several at once, and counting the offers would stop
  // the conversation after the first batch.
  const answered = asked.length;
  if (answered >= MAX_QUESTIONS) {
    session.outstanding = [];
    session.questionsAsked = answered;
    return;
  }

  const next = selectQuestions(session.profile, asked);
  session.outstanding = next.map((question) => question.id);
  session.questionsAsked = answered;
  session.updatedAt = new Date().toISOString();
}

/**
 * The questions to show the shopper, with their prompts and options.
 */
export function outstandingQuestions(session: ConversationSession): ConversationQuestion[] {
  return session.outstanding
    .map((id) => categoryQuestionById(session.profile.category, id) ?? QUESTIONS.find((question) => question.id === id))
    .filter((question): question is ConversationQuestion => question !== undefined);
}

/**
 * Convert a profile into the purchase requirements the decision engine
 * consumes.
 */
export function profileToRequirements(profile: BuyerProfile): PurchaseRequirements {
  const priorities: Record<string, number> = { ...profile.priorities };

  // Usage implies priorities. A shopper who says "battery" in the usage
  // wants it weighted even if they never said "battery" explicitly.
  if (profile.usage.includes('travel')) priorities.battery = Math.max(priorities.battery ?? 0, 0.7);
  if (profile.usage.includes('gaming')) priorities.performance = Math.max(priorities.performance ?? 0, 0.8);
  if (profile.usage.includes('local_ai')) priorities.performance = Math.max(priorities.performance ?? 0, 0.75);
  if (profile.usage.includes('programming')) priorities.performance = Math.max(priorities.performance ?? 0, 0.7);

  // A long expected lifespan shifts weight towards reliability and service.
  if (profile.expectedLifespanYears !== null && profile.expectedLifespanYears >= 4) {
    priorities.durability = Math.max(priorities.durability ?? 0, 0.8);
    priorities.service = Math.max(priorities.service ?? 0, 0.7);
  }
  if (profile.expectedLifespanYears !== null && profile.expectedLifespanYears <= 2) {
    priorities.value = Math.max(priorities.value ?? 0, 0.8);
  }

  // Footwear has its own priority vocabulary, and the shopper's intended
  // use decides how the trade-off is resolved.
  if (profile.category === 'shoes') {
    const use = profile.usage.find((usage) =>
      ['running', 'walking', 'gym', 'casual', 'formal', 'sports', 'hiking'].includes(usage),
    );

    const usePriority: Record<string, string> = {
      running: 'cushioning',
      walking: 'comfort',
      gym: 'grip',
      casual: 'style',
      formal: 'style',
      sports: 'grip',
      hiking: 'durability',
    };

    if (use && usePriority[use]) {
      priorities[usePriority[use] as string] = Math.max(
        priorities[usePriority[use] as string] ?? 0,
        0.8,
      );
    }

    // A shoe bought for a long time is a shoe bought for durability.
    if (profile.expectedLifespanYears !== null && profile.expectedLifespanYears >= 3) {
      priorities.durability = Math.max(priorities.durability ?? 0, 0.75);
    }
  }

  const requirements: PurchaseRequirements = {
    category: profile.category,
    budgetMinPaise: profile.budgetMinPaise,
    budgetMaxPaise: profile.budgetMaxPaise,
    priorities,
    mustHaves: profile.mustHaves,
    niceToHaves: [],
    workloads: profile.usage,
    rawQuery: profile.rawStatements.join(' '),
    missingInfo: [],
  };

  requirements.missingInfo = describeGaps(profile);
  return requirements;
}

/**
 * What the profile is still missing.
 *
 * This is reported to the shopper rather than assumed away.
 */
export function describeGaps(profile: BuyerProfile): string[] {
  const gaps: string[] = [];

  if (profile.category === null) gaps.push('category');
  if (profile.budgetMaxPaise === null) gaps.push('budget');
  if (profile.usage.length === 0) gaps.push('use_case');
  if (Object.keys(profile.priorities).length === 0) gaps.push('priorities');
  if (profile.expectedLifespanYears === null) gaps.push('lifespan');

  // A workload that needs a dedicated GPU needs to know whether one is
  // acceptable — this is a genuine fork in the road.
  if (
    profile.usage.some((usage) => ['gaming', 'local_ai', 'video_editing'].includes(usage)) &&
    profile.budgetMaxPaise !== null &&
    profile.budgetMaxPaise < 60_000_00
  ) {
    gaps.push('gpu_budget');
  }

  return gaps;
}

/**
 * A one-line description of the profile, for the shopper and the trace.
 */
export function describeProfile(profile: BuyerProfile): string {
  const parts: string[] = [];
  if (profile.category) parts.push(profile.category);
  if (profile.budgetMaxPaise !== null) {
    parts.push(`up to ₹${(profile.budgetMaxPaise / 100).toLocaleString('en-IN')}`);
  }
  if (profile.usage.length > 0) {
    parts.push(`for ${profile.usage.map((usage) => usage.replace(/_/g, ' ')).join(', ')}`);
  }
  if (Object.keys(profile.priorities).length > 0) {
    parts.push(
      `prioritising ${Object.keys(profile.priorities).join(', ')}`,
    );
  }
  if (profile.expectedLifespanYears !== null) {
    parts.push(`over ${profile.expectedLifespanYears} years`);
  }
  if (profile.mustHaves.length > 0) {
    parts.push(`requiring ${profile.mustHaves.join(', ')}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing yet';
}

/**
 * Parse an opening message into a profile directly, without a session.
 *
 * Used by the one-shot chat endpoint, which has no conversation state.
 */
export function profileFromMessage(message: string): BuyerProfile {
  const profile = emptyProfile();
  ingestStatement(profile, message);

  // Fall back to the full intent parser for anything the prose ingest missed.
  const parsed = parseRequirements(message);
  if (profile.category === null && parsed.category) {
    profile.category = parsed.category;
    profile.categorySource = 'inferred';
  }
  if (profile.budgetMaxPaise === null && parsed.budgetMaxPaise !== null && parsed.budgetMaxPaise !== undefined) {
    profile.budgetMaxPaise = parsed.budgetMaxPaise;
    profile.budgetSource = 'stated';
  }
  if (profile.usage.length === 0 && parsed.workloads.length > 0) {
    profile.usage = parsed.workloads;
    profile.usageSource = 'inferred';
  }
  for (const [key, weight] of Object.entries(parsed.priorities)) {
    if (profile.priorities[key] === undefined) profile.priorities[key] = weight;
  }
  if (profile.mustHaves.length === 0 && parsed.mustHaves.length > 0) {
    profile.mustHaves = parsed.mustHaves;
  }

  return profile;
}
