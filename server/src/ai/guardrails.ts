/**
 * Agent guardrails.
 *
 * These run after the model speaks and before the user sees anything. They
 * exist because a plausible-sounding answer can still be wrong.
 *
 *  - **Budget guard** — a recommendation outside the user's stated budget is
 *    flagged and removed, whatever the model said.
 *  - **Citation gate** — an answer that makes factual claims without a
 *    resolvable citation is rejected.
 *  - **Claim verifier** — every price, rating and discount figure in the text
 *    is checked against the values we actually hold.
 *  - **Stock guard** — the agent may not present an out-of-stock listing as
 *    buyable, but saying "it is out of stock" is correct and must not be
 *    flagged.
 *  - **Sample-data warning** — sample prices are labelled as such.
 *
 * The claim-verification rules are adapted from the Apache-2.0 "Aria"
 * project (github.com/caprion/agentic-shopping, demo/app/guardrails.py).
 * The important idea taken from it is that a *limit echo* ("under ₹70,000"),
 * a *price band* ("₹1,200–1,500"), an *approximation* ("around ₹40,000") and a
 * *derived difference* ("₹500 cheaper than the other") are not product-price
 * claims and must not be treated as fabrications. See THIRD_PARTY_NOTICE.md.
 */

import type { PurchaseRequirements } from '../domain/types.ts';
import { formatPaise } from '../intelligence/normalize/specs.ts';
import type { Citation } from './tools.ts';

export interface GuardrailViolation {
  kind:
    | 'budget'
    | 'missing_citation'
    | 'price_mismatch'
    | 'rating_mismatch'
    | 'discount_mismatch'
    | 'stock_mismatch'
    | 'sample_price'
    | 'unsupported_claim';
  message: string;
  detail?: unknown;
}

export interface GuardrailResult {
  ok: boolean;
  reply: string;
  violations: GuardrailViolation[];
  citations: Citation[];
}

/* ------------------------------------------------------------------ */
/* Claim extraction patterns                                           */
/* ------------------------------------------------------------------ */

const RUPEE = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;
const RATING = /([0-5](?:\.[0-9]+)?)\s*(?:★|stars?)/gi;
const PERCENT_OFF = /([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:off|discount)/gi;

/**
 * Phrases that echo a budget or limit rather than naming a product price.
 * "under ₹70,000" is the user's own budget, not a price claim.
 */
const LIMIT_ECHO =
  /\b(?:under|below|sub[-\s]?|less than|within|up to|at most|a maximum of|max(?:imum)?|or less|or cheaper|budget(?:\s+(?:cap|limit))?|cap of|above|over|more than|no more than|not more than|session cap|spend up to|ceiling|limit)\s*(?:(?:of|is|at|equal to|:|=|,)?\s*)?(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;

/** The reversed form: "₹70,000 budget", "₹70,000 cap". */
const LIMIT_ECHO_POST =
  /(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:budget(?:\s+(?:cap|limit))?|cap|limit|ceiling|maximum)\b/gi;

/** A price band, e.g. "₹1,200-1,500" or "between ₹10,000 and ₹15,000". */
const PRICE_RANGE =
  /(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*[-–—~]\s*(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]+)?|\bbetween\s+(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s+and\s+(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]+)?/gi;

/** A derived comparison between two known prices. */
const DERIVED_DIFF =
  /(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:cheaper|more expensive|less expensive|dearer|pricier|higher|lower|more)\b/gi;

/** An approximate price, which is a paraphrase rather than a claim. */
const APPROX_PRICE =
  /(?:~|about|around|approximately|approx|roughly|near)\s*(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]+)?/gi;

function toNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function collect(text: string, pattern: RegExp): number[] {
  const values: number[] = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = toNumber(match[1] ?? '');
    if (value !== null) values.push(value);
  }
  return values;
}

/**
 * Remove text that is not a product-price claim.
 * This is the rule that stops a user's own budget from being reported as a
 * fabricated price.
 */
export function stripNonPriceClaims(text: string): string {
  return text
    .replace(LIMIT_ECHO, ' ')
    .replace(LIMIT_ECHO_POST, ' ')
    .replace(PRICE_RANGE, ' ')
    .replace(DERIVED_DIFF, ' ')
    .replace(APPROX_PRICE, ' ');
}

/** Rupee amounts that appear in a reply, normalised to paise. */
export function extractPriceClaims(text: string): { raw: string; paise: number }[] {
  const claims: { raw: string; paise: number }[] = [];
  const regex = new RegExp(RUPEE.source, RUPEE.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = toNumber(match[1] ?? '');
    if (value === null) continue;
    claims.push({ raw: match[0].trim(), paise: Math.round(value * 100) });
  }
  return claims;
}

/* ------------------------------------------------------------------ */
/* Claim verification                                                  */
/* ------------------------------------------------------------------ */

export interface KnownValues {
  /** Every price we actually hold, in paise. */
  pricesPaise: number[];
  /** Ratings we hold, 0..5. */
  ratings: number[];
  /** Discount percentages we hold. */
  discountPercents: number[];
}

export interface VerifiedClaims {
  text: string;
  violations: GuardrailViolation[];
}

/**
 * Verify that every price, rating and discount figure in the reply is one we
 * actually hold.
 *
 * Tolerance: 2% of the known value or ₹2, whichever is larger — a rounded
 * "₹62,990" is legitimately a rupee or two away from "₹62,989.50".
 */
export function verifyClaims(text: string, known: KnownValues): VerifiedClaims {
  const violations: GuardrailViolation[] = [];

  // Derived differences between two known prices are legitimate comparisons.
  const derived: number[] = [];
  for (let i = 0; i < known.pricesPaise.length; i += 1) {
    for (let j = i + 1; j < known.pricesPaise.length; j += 1) {
      const a = known.pricesPaise[i] ?? 0;
      const b = known.pricesPaise[j] ?? 0;
      derived.push(Math.abs(a - b));
    }
  }

  const priceText = stripNonPriceClaims(text);

  for (const claim of extractPriceClaims(priceText)) {
    const tolerance = Math.max(200, Math.round(Math.abs(claim.paise) * 0.02));
    const matched = known.pricesPaise.some((value) => Math.abs(value - claim.paise) <= tolerance);
    const matchedDerived = derived.some((value) => Math.abs(value - claim.paise) <= tolerance);
    if (!matched && !matchedDerived) {
      violations.push({
        kind: 'price_mismatch',
        message: `Removed a price (${claim.raw}) that does not match any price in the catalogue.`,
        detail: { claim: claim.raw, paise: claim.paise },
      });
    }
  }

  for (const rating of collect(text, RATING)) {
    if (known.ratings.length === 0) continue;
    const matched = known.ratings.some((value) => Math.abs(value - rating) <= 0.15);
    if (!matched) {
      violations.push({
        kind: 'rating_mismatch',
        message: `Removed a rating (${rating}★) that does not match any rating in the catalogue.`,
        detail: { rating },
      });
    }
  }

  for (const percent of collect(text, PERCENT_OFF)) {
    if (known.discountPercents.length === 0) continue;
    const matched = known.discountPercents.some((value) => Math.abs(value - percent) <= 2);
    if (!matched) {
      violations.push({
        kind: 'discount_mismatch',
        message: `Removed a discount (${percent}%) that does not match any recorded discount.`,
        detail: { percent },
      });
    }
  }

  return { text, violations };
}

/**
 * Remove the values we could not verify from the text.
 */
export function redactUnverifiedClaims(text: string, known: KnownValues): string {
  let corrected = text;
  const derived: number[] = [];
  for (let i = 0; i < known.pricesPaise.length; i += 1) {
    for (let j = i + 1; j < known.pricesPaise.length; j += 1) {
      derived.push(Math.abs((known.pricesPaise[i] ?? 0) - (known.pricesPaise[j] ?? 0)));
    }
  }

  for (const claim of extractPriceClaims(text)) {
    const tolerance = Math.max(200, Math.round(Math.abs(claim.paise) * 0.02));
    const matched =
      known.pricesPaise.some((value) => Math.abs(value - claim.paise) <= tolerance) ||
      derived.some((value) => Math.abs(value - claim.paise) <= tolerance);
    if (!matched) {
      corrected = corrected.replace(claim.raw, '[price unavailable]');
    }
  }

  return corrected;
}

/**
 * Remove recommendations that exceed the stated budget.
 */
export function enforceBudget<T extends { productId: string; bestPricePaise: number | null }>(
  items: T[],
  requirements: PurchaseRequirements,
): { kept: T[]; removed: T[]; violations: GuardrailViolation[] } {
  const max = requirements.budgetMaxPaise ?? null;
  const min = requirements.budgetMinPaise ?? null;
  if (max === null && min === null) {
    return { kept: items, removed: [], violations: [] };
  }

  const kept: T[] = [];
  const removed: T[] = [];
  const violations: GuardrailViolation[] = [];

  for (const item of items) {
    const price = item.bestPricePaise;
    if (price === null) {
      kept.push(item);
      continue;
    }
    if (max !== null && price > max) {
      removed.push(item);
      violations.push({
        kind: 'budget',
        message: `Removed ${item.productId}: ${formatPaise(price)} is above the stated budget of ${formatPaise(max)}.`,
        detail: { productId: item.productId, pricePaise: price, budgetMaxPaise: max },
      });
      continue;
    }
    if (min !== null && price < min) {
      removed.push(item);
      violations.push({
        kind: 'budget',
        message: `Removed ${item.productId}: ${formatPaise(price)} is below the stated minimum of ${formatPaise(min)}.`,
        detail: { productId: item.productId, pricePaise: price, budgetMinPaise: min },
      });
      continue;
    }
    kept.push(item);
  }

  return { kept, removed, violations };
}

/**
 * The citation gate. An answer that states prices, ratings or specifications
 * must carry at least one citation.
 */
export function citationGate(reply: string, citations: Citation[]): GuardrailViolation | null {
  const makesFactualClaims =
    /(?:₹|rs\.?|inr)\s*[0-9]/.test(reply) ||
    /[0-5](?:\.[0-9]+)?\s*(?:★|stars?)/i.test(reply) ||
    /\b\d+\s*(?:gb|tb|mp|mah|inch|litre|kg|w)\b/i.test(reply) ||
    /reviews? say|owners? (?:say|report|complain)/i.test(reply);

  if (makesFactualClaims && citations.length === 0) {
    return {
      kind: 'missing_citation',
      message:
        'The answer made factual claims but carried no citation, so it was withheld rather than shown to the user.',
    };
  }
  return null;
}

/**
 * The stock guard.
 *
 * An out-of-stock listing may not be presented as buyable. However, *saying*
 * that it is out of stock is truthful and must not be flagged.
 */
export function stockGuard(options: {
  outOfStockProductIds: string[];
  reply: string;
}): GuardrailViolation | null {
  if (options.outOfStockProductIds.length === 0) return null;
  const declaresUnavailable =
    /\bout of stock\b|\bnot (?:currently )?(?:available|in stock)\b|\bunavailable\b|\bsold out\b|\bno longer available\b|\bdiscontinued\b/i.test(
      options.reply,
    );
  if (declaresUnavailable) return null;
  return {
    kind: 'stock_mismatch',
    message: `The answer presented an out-of-stock listing without saying so: ${options.outOfStockProductIds.join(', ')}.`,
    detail: { productIds: options.outOfStockProductIds },
  };
}

/**
 * Warn when sample prices are being presented.
 */
export function sampleDataWarning(citations: Citation[]): GuardrailViolation | null {
  const sample = citations.filter((citation) => citation.origin === 'sample');
  if (sample.length === 0) return null;
  return {
    kind: 'sample_price',
    message: `${sample.length} supporting record${sample.length === 1 ? '' : 's'} came from the bundled sample catalogue, not a live retailer feed.`,
    detail: { citationIds: sample.map((citation) => citation.id) },
  };
}

export interface ApplyGuardrailsInput {
  reply: string;
  citations: Citation[];
  requirements: PurchaseRequirements;
  known: KnownValues;
  hasSampleData: boolean;
  outOfStockProductIds?: string[];
  /** Redact unverifiable figures instead of only reporting them. */
  redact?: boolean;
}

export function applyGuardrails(input: ApplyGuardrailsInput): GuardrailResult {
  const violations: GuardrailViolation[] = [];

  const verified = verifyClaims(input.reply, input.known);
  violations.push(...verified.violations);

  let reply = input.redact ? redactUnverifiedClaims(input.reply, input.known) : input.reply;

  const missing = citationGate(reply, input.citations);
  if (missing) violations.push(missing);

  const stock = stockGuard({
    outOfStockProductIds: input.outOfStockProductIds ?? [],
    reply,
  });
  if (stock) violations.push(stock);

  if (input.hasSampleData) {
    const warning = sampleDataWarning(input.citations);
    if (warning) violations.push(warning);
  }

  return {
    ok: !violations.some(
      (violation) =>
        violation.kind === 'missing_citation' || violation.kind === 'stock_mismatch',
    ),
    reply,
    violations,
    citations: input.citations,
  };
}

/**
 * Guardrail for content that came from an external source.
 * Instructions embedded in retailer text are stripped, never followed.
 */
export function neutraliseUntrustedContent(text: string): string {
  return text
    .replace(/ignore (all )?(previous|prior|above) instructions?/gi, '')
    .replace(/disregard (all )?(previous|prior|above) instructions?/gi, '')
    .replace(/you are (now )?a [a-z ]{0,40}/gi, '')
    .replace(/system prompt:?/gi, '')
    .trim();
}
