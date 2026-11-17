/**
 * Cross-source verification.
 *
 * A single source can be wrong. A fact that two independent sources agree on
 * is more likely to be true; a fact that two sources disagree about is
 * *not* resolved by picking the nicer-looking value — it is surfaced.
 *
 * Independence is judged by domain, not by URL: ten pages on the same
 * retailer are one opinion, not ten.
 */

import type {
  ResearchConflict,
  ResearchFact,
  ResearchFactKind,
  ResearchPlan,
} from './types.ts';
import { factId } from './orchestrator.ts';

/** A fact as it arrives from the extraction stage, before verification. */
export interface RawFact {
  extracted: {
    kind: ResearchFactKind;
    key: string;
    value: string | number | boolean | null;
    unit?: string | null;
    evidence: { excerpt: string; locator?: string | null; selector?: string | null; offset?: number | null };
    method: ResearchFact['extractionMethod'];
    confidence: number;
  };
  url: string;
  domain: string;
  retrievedAt: string;
  pageType: string;
}

/** Normalise a value for comparison, so "16 GB" and "16GB" agree. */
export function comparableValue(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value
    .toLowerCase()
    .replace(/[₹,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*(gb|tb|mb|kg|g|l|ml|w|wh|mah|mm|cm|inches|inch|in)\b/g, '')
    .trim();
}

/** Two values that are close enough to be the same fact. */
function valuesAgree(a: string | number | boolean | null, b: string | number | boolean | null): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true;
    // Allow a small relative difference for prices measured on different pages.
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return scale > 0 && Math.abs(a - b) / scale <= 0.02;
  }
  return comparableValue(a) === comparableValue(b);
}

export interface VerificationOutcome {
  facts: ResearchFact[];
  conflicts: ResearchConflict[];
}

/**
 * Verify extracted facts against each other.
 *
 * Agreement raises confidence and marks the fact as corroborated. Disagreement
 * produces a conflict record and lowers confidence, but the fact is kept —
 * the user is better served by seeing that two sources differ than by
 * seeing one of them silently discarded.
 */
export function verifyFacts(raw: RawFact[], plan: ResearchPlan): VerificationOutcome {
  // Group by kind + key.
  const groups = new Map<string, RawFact[]>();
  for (const entry of raw) {
    const key = `${entry.extracted.kind}::${entry.extracted.key}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const facts: ResearchFact[] = [];
  const conflicts: ResearchConflict[] = [];

  for (const [groupKey, entries] of groups) {
    const [kind, key] = groupKey.split('::') as [ResearchFactKind, string];

    // The independent source count is by domain.
    const domains = new Set(entries.map((entry) => entry.domain));

    // Pick the best-supported value: highest method confidence, then most
    // corroborated. This is a *tie-break for presentation*, not a resolution
    // of a conflict — the conflict is still reported.
    const ranked = [...entries].sort((a, b) => {
      const aAgreement = countAgreeing(a, entries);
      const bAgreement = countAgreeing(b, entries);
      if (aAgreement !== bAgreement) return bAgreement - aAgreement;
      return b.extracted.confidence - a.extracted.confidence;
    });

    const winner = ranked[0];
    if (!winner) continue;

    const agreeing = entries.filter((entry) => valuesAgree(entry.extracted.value, winner.extracted.value));
    const disagreeing = entries.filter(
      (entry) => !valuesAgree(entry.extracted.value, winner.extracted.value),
    );

    // A disagreement from the same domain is not an independent conflict.
    const independentDisagreement = disagreeing.filter(
      (entry) => entry.domain !== winner.domain,
    );

    const corroboratingSources = new Set(agreeing.map((entry) => entry.domain)).size;

    // Confidence: method confidence, raised by corroboration, lowered by
    // independent disagreement.
    let confidence = winner.extracted.confidence;
    if (corroboratingSources >= 2) confidence = Math.min(0.98, confidence + 0.08);
    else if (corroboratingSources === 1 && agreeing.length > 1) confidence = Math.min(0.95, confidence + 0.03);
    if (independentDisagreement.length > 0) confidence = Math.max(0.1, confidence - 0.25);

    const verification: ResearchFact['verification'] =
      independentDisagreement.length > 0
        ? 'conflicting'
        : corroboratingSources >= 2
          ? 'corroborated'
          : domains.size === 1
            ? 'single_source'
            : 'unverifiable';

    facts.push({
      id: factId(plan.productId, plan.variantId, kind, key),
      productId: plan.productId,
      variantId: plan.variantId,
      kind,
      key,
      value: winner.extracted.value,
      unit: winner.extracted.unit ?? null,
      sourceUrl: winner.url,
      sourceDomain: winner.domain,
      retrievedAt: winner.retrievedAt,
      verifiedAt: winner.retrievedAt,
      evidence: winner.extracted.evidence,
      confidence: Number(confidence.toFixed(3)),
      origin: 'live',
      extractionMethod: winner.extracted.method,
      freshness: 'fresh',
      verification,
      corroboratingSources,
      conflictingSources: [...new Set(independentDisagreement.map((entry) => entry.domain))],
    });

    if (independentDisagreement.length > 0) {
      conflicts.push({
        factKind: kind,
        key,
        positions: entries.map((entry) => ({
          value: entry.extracted.value,
          sourceUrl: entry.url,
          sourceDomain: entry.domain,
          observedAt: entry.retrievedAt,
          confidence: entry.extracted.confidence,
        })),
        explanation: describeConflict(key, winner.extracted.value, independentDisagreement),
        resolution: 'shown_as_conflict',
      });
    }
  }

  return { facts, conflicts };
}

/** How many entries agree with a candidate. */
function countAgreeing(candidate: RawFact, entries: RawFact[]): number {
  return entries.filter((entry) => valuesAgree(entry.extracted.value, candidate.extracted.value)).length;
}

/** Plain-language description of a disagreement. */
function describeConflict(
  key: string,
  winningValue: string | number | boolean | null,
  others: RawFact[],
): string {
  const domains = [...new Set(others.map((entry) => entry.domain))];
  const label = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return `Sources disagree on ${label}: ${formatValue(winningValue)} against ${others
    .map((entry) => formatValue(entry.extracted.value))
    .join(', ')} (${domains.join(', ')}). The value shown is from the best-supported source, but the conflict is unresolved.`;
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return 'unknown';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return `"${value}"`;
}
