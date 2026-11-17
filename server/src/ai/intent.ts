/**
 * Requirement extraction.
 *
 * Turns a natural-language shopping request into a structured purchase brief.
 *
 * This is implemented as deterministic rules first, because it must work with
 * no API key and must never guess a budget it cannot read. An LLM may later
 * *refine* the brief (see `ai/agent.ts`), but the rules are the floor: if the
 * parser cannot determine a constraint, the constraint is left unset and the
 * gap is reported in `missingInfo` rather than invented.
 *
 * English, Hindi and Hinglish inputs are all handled.
 */

import type { CategoryId, PurchaseRequirements } from '../domain/types.ts';
import { detectCategoryFromText, listCategories } from '../intelligence/categories/index.ts';

/* ------------------------------------------------------------------ */
/* Category detection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Detect the category from free text.
 *
 * Detection is driven by the category registry, so a newly registered
 * category is recognised without touching this parser. The registry's
 * aliases and request terms already include local-language terms.
 */
export function detectCategory(text: string): CategoryId | null {
  return detectCategoryFromText(text);
}

/**
 * Every category the platform knows about, for the UI and for coverage tests.
 */
export function knownCategories(): { id: string; label: string }[] {
  return listCategories().map((profile) => ({ id: profile.id, label: profile.label }));
}

/* ------------------------------------------------------------------ */
/* Budget parsing                                                      */
/* ------------------------------------------------------------------ */

/** Parse an Indian-formatted amount to paise. */
export function parseAmountToPaise(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/,/g, '');
  const lakh = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/);
  if (lakh?.[1]) {
    const value = Number.parseFloat(lakh[1]);
    if (Number.isFinite(value)) return Math.round(value * 100_000 * 100);
  }
  const thousand = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:thousand|k\b|हज़ार|हजार)/);
  if (thousand?.[1]) {
    const value = Number.parseFloat(thousand[1]);
    if (Number.isFinite(value)) return Math.round(value * 1000 * 100);
  }
  const plain = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (plain?.[1]) {
    const value = Number.parseFloat(plain[1]);
    if (Number.isFinite(value)) return Math.round(value * 100);
  }
  return null;
}

/**
 * Amount pattern.
 *
 * The digit class deliberately excludes whitespace so that the optional unit
 * suffix cannot be ambiguous with it. An earlier version used `[\d,.\s]+`
 * followed by `\s*` — a nested quantifier that caused catastrophic
 * backtracking. The performance suite caught it at ~600 ms per parse.
 */
const AMOUNT = '([0-9][0-9,]*(?:\\.[0-9]+)?(?:\\s*(?:k|lakh|lac|l|thousand))?)';

const MAX_PATTERNS = [
  new RegExp(`under\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`below\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`less than\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`(?:₹|rs\\.?|inr)\\s*${AMOUNT}\\s*(?:se\\s*kam|से\\s*कम|tak|or\\s+less)`, 'i'),
  new RegExp(`(?:₹|rs\\.?|inr)\\s*${AMOUNT}\\s*(?:se\\s*kam\\s*nahi|से\\s*ज़्यादा|se\\s*zyada)`, 'i'),
  new RegExp(`(?:max|maximum|upto|up\\s*to)\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`budget\\s*(?:is|of)?\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
];

const MIN_PATTERNS = [
  new RegExp(`above\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`at least\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`more than\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`, 'i'),
  new RegExp(`(?:₹|rs\\.?|inr)\\s*${AMOUNT}\\s*(?:se\\s*upar|से\\s*ऊपर)`, 'i'),
];

const BETWEEN_PATTERN = new RegExp(
  `between\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}\\s*(?:and|to|से|se|–|-)\\s*(?:₹|rs\\.?|inr)?\\s*${AMOUNT}`,
  'i',
);

/** A bare rupee amount, e.g. "₹70,000". */
const STANDALONE_AMOUNT = new RegExp(`(?:₹|rs\\.?|inr)\\s*${AMOUNT}`, 'i');

export interface ParsedBudget {
  minPaise: number | null;
  maxPaise: number | null;
}

export function parseBudget(text: string): ParsedBudget {
  const between = text.match(BETWEEN_PATTERN);
  if (between?.[1] && between[2]) {
    const min = parseAmountToPaise(between[1]);
    const max = parseAmountToPaise(between[2]);
    if (min !== null && max !== null) {
      return { minPaise: Math.min(min, max), maxPaise: Math.max(min, max) };
    }
  }

  for (const pattern of MAX_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseAmountToPaise(match[1]);
      if (value !== null) return { minPaise: null, maxPaise: value };
    }
  }

  for (const pattern of MIN_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseAmountToPaise(match[1]);
      if (value !== null) return { minPaise: value, maxPaise: null };
    }
  }

  // "₹70,000" on its own is a budget ceiling.
  const standalone = text.match(STANDALONE_AMOUNT);
  if (standalone?.[1]) {
    const value = parseAmountToPaise(standalone[1]);
    if (value !== null) return { minPaise: null, maxPaise: value };
  }

  return { minPaise: null, maxPaise: null };
}

/* ------------------------------------------------------------------ */
/* Priorities and workloads                                           */
/* ------------------------------------------------------------------ */

interface PriorityRule {
  key: string;
  patterns: RegExp[];
}

const PRIORITY_RULES: PriorityRule[] = [
  {
    key: 'camera',
    patterns: [/\bcamera\b/i, /\bphoto(graph)?\b/i, /\bshots?\b/i, /\u0915\u0948\u092e\u0930\u093e/, /\u092b\u094b\u091f\u094b/, /photo khelna/i],
  },
  {
    key: 'battery',
    patterns: [/\bbattery\b/i, /\bbackup\b/i, /\u092c\u0948\u091f\u0930\u0940/, /\u092c\u0948\u091f\u0930\u093f/],
  },
  {
    key: 'performance',
    patterns: [/\bperform(ance|ant)\b/i, /\bfast\b/i, /\bsmooth\b/i, /\bprocessing\b/i, /\u092a\u0930\u092b\u093c\u0949\u0930\u094d\u092e\u0947\u0902\u0938/, /\u0924\u0947\u091c\u093c/],
  },
  {
    key: 'display',
    patterns: [/\bdisplay\b/i, /\bscreen\b/i, /\u0921\u093f\u0938\u094d\u092a\u094d\u0932\u0947/, /\u0938\u094d\u0915\u094d\u0930\u0940\u0928/],
  },
  {
    key: 'gaming',
    patterns: [/\bgaming\b/i, /\bgames?\b/i, /\bplay\b/i, /\u0917\u0947\u092e\u093f\u0902\u0917/],
  },
  {
    key: 'storage',
    patterns: [/\bstorage\b/i, /\bspace\b/i, /\u0938\u094d\u091f\u094b\u0930\u0947\u091c/],
  },
  {
    key: 'build_quality',
    patterns: [/\bbuild quality\b/i, /\bdurable?\b/i, /\bsturdiness\b/i, /\u092c\u093f\u0932\u094d\u0921/],
  },
  {
    key: 'software',
    patterns: [/\bsoftware\b/i, /\bos\b/i, /\bupdates?\b/i, /\u0938\u0949\u092b\u094d\u091f\u0935\u0947\u092f\u0930/],
  },
  {
    key: 'value',
    patterns: [/\bvalue\b/i, /\bworth\b/i, /\bbest price\b/i, /\bvalue for money\b/i, /\u092a\u0948\u0938\u093e/, /\u0935\u0948\u0932\u094d\u092f\u0942/],
  },
  {
    key: 'local_ai',
    patterns: [/\blocal ai\b/i, /\bllm\b/i, /\bllama\b/i, /\bmistral\b/i, /\brun models?\b/i, /\bon-device model/i],
  },
  {
    key: 'memory',
    patterns: [/\bram\b/i, /\bmemory\b/i, /\u0930\u0948\u092e/],
  },
];

interface WorkloadRule {
  key: string;
  patterns: RegExp[];
}

const WORKLOAD_RULES: WorkloadRule[] = [
  {
    key: 'gaming',
    patterns: [/\bgaming\b/i, /\bgames?\b/i, /\bsteam\b/i, /\u0917\u0947\u092e\u093f\u0902\u0917/],
  },
  {
    key: 'local_ai',
    patterns: [/\blocal ai\b/i, /\bllm\b/i, /\bllama\b/i, /\brun models?\b/i, /\blocally\b/i],
  },
  {
    key: 'programming',
    patterns: [/\bprogram(ming)?\b/i, /\bdevelopment\b/i, /\bdev(elopment)?\b/i, /\bjava\b/i, /\bpython\b/i, /\bdocker\b/i, /\bkubernetes\b/i, /\u092a\u094d\u0930\u094b\u0917\u094d\u0930\u093e\u092e\u093f\u0902\u0917/, /\u0921\u0947\u0935\u0932\u092a\u092e\u0947\u0902\u091f/],
  },
  {
    key: 'video_editing',
    patterns: [/\bvideo edit(ing)?\b/i, /\bpremiere\b/i, /\bafter effects\b/i, /\bfinal cut\b/i],
  },
  {
    key: 'design',
    patterns: [/\bphoto ?design\b/i, /\bphotoshop\b/i, /\billustrat/i, /\bui\/ux\b/i],
  },
  {
    key: 'travel',
    patterns: [/\btravel\b/i, /\btravelling\b/i, /\bcommute?\b/i, /\bcompact\b/i, /\u092f\u093e\u0924\u094d\u0930\u093e/i],
  },
  {
    key: 'office',
    patterns: [/\boffice\b/i, /\bwork from home\b/i, /\bwfh\b/i, /\bexcel\b/i, /\baccounting\b/i],
  },
  {
    key: 'content_creation',
    patterns: [/\bcontent creat/i, /\byoutube\b/i, /\binstagram\b/i, /\breels\b/i],
  },
  {
    key: 'fitness',
    // "running" alone is too ambiguous (running a model, running an app), so
    // the patterns require fitness context.
    patterns: [/\bfitness\b/i, /\bgym\b/i, /\bworkout\b/i, /\brunning shoes?\b/i, /\bhealth tracker\b/i],
  },
];

export function detectPriorities(text: string): Record<string, number> {
  const priorities: Record<string, number> = {};
  for (const rule of PRIORITY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      priorities[rule.key] = 0.8;
    }
  }
  return priorities;
}

export function detectWorkloads(text: string): string[] {
  const workloads: string[] = [];
  for (const rule of WORKLOAD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      workloads.push(rule.key);
    }
  }
  return workloads;
}

/* ------------------------------------------------------------------ */
/* Must-haves                                                          */
/* ------------------------------------------------------------------ */

export function detectMustHaves(text: string): string[] {
  const mustHaves: string[] = [];
  const add = (value: string): void => {
    if (value && !mustHaves.includes(value)) mustHaves.push(value);
  };

  const ram = text.match(/(\d+)\s*gb\s*(?:ram|memory|रैम)/i);
  if (ram?.[1]) add(`${ram[1]}GB RAM`);

  const storage = text.match(/(\d+)\s*gb\s*(?:storage|ssd|rom|स्टोरेज)/i);
  if (storage?.[1]) add(`${storage[1]}GB storage`);

  const tbStorage = text.match(/(\d+)\s*tb\s*(?:storage|ssd|rom)/i);
  if (tbStorage?.[1]) add(`${Number.parseInt(tbStorage[1], 10) * 1024}GB storage`);

  if (/\b5g\b/i.test(text)) add('5G');
  if (/\bamoled\b/i.test(text)) add('AMOLED');
  if (/\bssd\b/i.test(text)) add('SSD');
  if (/\bnvme\b/i.test(text)) add('NVMe');
  if (/\bexpansion card\b|\brtx\b/i.test(text)) add('dedicated GPU');
  if (/\bheadphone jack\b|\b3\.5mm\b/i.test(text)) add('3.5mm headphone jack');
  if (/\bip\d+ rating\b|\bwaterproof\b|\bwater resistant\b/i.test(text)) add('water resistant');

  return mustHaves;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export interface ParseOptions {
  /** Requirements already supplied by the client (e.g. from a saved brief). */
  overrides?: Partial<PurchaseRequirements>;
}

/**
 * Parse a natural-language request into a purchase brief.
 */
export function parseRequirements(text: string, options: ParseOptions = {}): PurchaseRequirements {
  const overrides = options.overrides ?? {};
  const budget = parseBudget(text);
  const category = overrides.category ?? detectCategory(text);
  const priorities = { ...detectPriorities(text), ...(overrides.priorities ?? {}) };
  const workloads = [...new Set([...detectWorkloads(text), ...(overrides.workloads ?? [])])];
  const mustHaves = [...new Set([...detectMustHaves(text), ...(overrides.mustHaves ?? [])])];
  const niceToHaves = [...new Set([...(overrides.niceToHaves ?? [])])];

  const budgetMinPaise = overrides.budgetMinPaise ?? budget.minPaise;
  const budgetMaxPaise = overrides.budgetMaxPaise ?? budget.maxPaise;

  const missingInfo = findMissingInfo(category, budgetMaxPaise, priorities, workloads);

  return {
    category,
    budgetMinPaise,
    budgetMaxPaise,
    priorities,
    mustHaves,
    niceToHaves,
    workloads,
    rawQuery: text,
    missingInfo,
  };
}

/**
 * Work out what is still unknown, so the assistant can ask a useful question
 * instead of guessing.
 */
export function findMissingInfo(
  category: CategoryId | null | undefined,
  budgetMaxPaise: number | null | undefined,
  priorities: Record<string, number>,
  workloads: string[],
): string[] {
  const missing: string[] = [];

  if (!category) missing.push('category');
  if (budgetMaxPaise === null || budgetMaxPaise === undefined) missing.push('budget');
  if (Object.keys(priorities).length === 0) missing.push('priorities');

  // A laptop used for local AI needs a GPU question answered.
  if (category === 'laptop' && workloads.includes('local_ai')) {
    missing.push('gpu_budget');
  }
  if (category === 'smartphone' && !priorities.camera && !priorities.battery) {
    missing.push('use_case');
  }

  return missing;
}

/** A human-readable summary of a brief, used in the UI and in agent answers. */
export function describeRequirements(requirements: PurchaseRequirements): string {
  const parts: string[] = [];
  if (requirements.category) parts.push(`Category: ${requirements.category}`);
  if (requirements.budgetMaxPaise !== null && requirements.budgetMaxPaise !== undefined) {
    parts.push(`Budget up to ₹${(requirements.budgetMaxPaise / 100).toLocaleString('en-IN')}`);
  }
  if (requirements.budgetMinPaise !== null && requirements.budgetMinPaise !== undefined) {
    parts.push(`Minimum ₹${(requirements.budgetMinPaise / 100).toLocaleString('en-IN')}`);
  }
  const priorityKeys = Object.keys(requirements.priorities);
  if (priorityKeys.length > 0) {
    parts.push(`Priorities: ${priorityKeys.join(', ')}`);
  }
  if (requirements.workloads.length > 0) {
    parts.push(`Use: ${requirements.workloads.join(', ')}`);
  }
  if (requirements.mustHaves.length > 0) {
    parts.push(`Required: ${requirements.mustHaves.join(', ')}`);
  }
  return parts.join(' · ');
}
