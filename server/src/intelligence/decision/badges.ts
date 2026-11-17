/**
 * Badge assignment.
 *
 * The badges answer the questions a shopper actually asks when they compare
 * a shortlist: which one should I buy, which one is the best deal, and what
 * is my alternative if the first is unavailable?
 *
 * Each badge is earned by a *dimension*, not by a score threshold, so a
 * "best value" badge always means the same thing:
 *
 *  - **Best overall** — the highest total score.
 *  - **Best value** — the strongest capability per rupee among the priced
 *    candidates. A product with no confirmed price can never take it.
 *  - **Best alternative** — the strongest candidate that is *not* the best
 *    overall, and that differs from it on a dimension the winner is weak
 *    on. An alternative that is simply second-best is not an alternative.
 *  - **Best for <priority>** — the candidate that leads on the dimension the
 *    shopper said mattered most.
 */

import type { PurchaseRequirements } from '../../domain/types.ts';
import type { IntelligenceDimensionId } from './types.ts';

/** The badge names the decision engine can assign. */
export type DecisionBadge =
  | 'best_overall'
  | 'best_value'
  | 'best_alternative'
  | 'best_for_priority';

interface ScoredCandidate {
  candidate: { product: { id: string } };
  dimensions: {
    id: IntelligenceDimensionId;
    label: string;
    score: number | null;
    weight: number;
  }[];
  score: number;
}

/**
 * Assign the badges.
 */
export function assignBadges(
  scored: ScoredCandidate[],
  requirements: PurchaseRequirements,
): Map<string, DecisionBadge> {
  const badges = new Map<string, DecisionBadge>();
  if (scored.length === 0) return badges;

  const winner = scored[0];
  if (winner) badges.set(winner.candidate.product.id, 'best_overall');

  /* ---- Best value ---- */
  // Capability per rupee, measured against the candidate set's median price.
  const priced = scored.filter((entry) => entry.candidate.product.id);
  const prices = scored
    .map((entry) => priceOf(entry))
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b);
  const median = prices.length > 0 ? prices[Math.floor(prices.length / 2)] ?? null : null;

  if (prices.length >= 2 && median && median > 0) {
    let bestValue: ScoredCandidate | null = null;
    let bestValueRatio = -Infinity;

    for (const entry of priced) {
      const price = priceOf(entry);
      if (price === null || price <= 0) continue;
      // The capability is the product dimension, which is what the shopper
      // is paying for. A product with no product-dimension score cannot be
      // judged on value.
      const capability = entry.dimensions.find((dimension) => dimension.id === 'product')?.score;
      if (capability === null || capability === undefined) continue;

      const ratio = capability / (price / median);
      if (ratio > bestValueRatio) {
        bestValueRatio = ratio;
        bestValue = entry;
      }
    }

    if (bestValue && !badges.has(bestValue.candidate.product.id)) {
      badges.set(bestValue.candidate.product.id, 'best_value');
    }
  }

  /* ---- Best for the shopper's top priority ---- */
  const priorityDimension = dimensionForTopPriority(requirements);
  if (priorityDimension) {
    let bestForPriority: ScoredCandidate | null = null;
    let bestScore = -Infinity;

    for (const entry of scored) {
      const dimension = entry.dimensions.find((entry2) => entry2.id === priorityDimension.id);
      if (!dimension || dimension.score === null) continue;
      if (dimension.score > bestScore) {
        bestScore = dimension.score;
        bestForPriority = entry;
      }
    }

    if (
      bestForPriority &&
      !badges.has(bestForPriority.candidate.product.id) &&
      bestScore > 0.6
    ) {
      badges.set(bestForPriority.candidate.product.id, 'best_for_priority');
    }
  }

  /* ---- Best alternative ---- */
  // The alternative must differ from the winner on something. A candidate
  // that is weaker on every dimension is not an alternative, it is a
  // compromise.
  const alternatives = scored.filter((entry) => !badges.has(entry.candidate.product.id));
  let bestAlternative: ScoredCandidate | null = null;
  let bestAlternativeScore = -Infinity;

  for (const entry of alternatives) {
    if (!winner) break;
    // It must be stronger than the winner on at least one dimension.
    const beats = entry.dimensions.some((dimension) => {
      const winnerDimension = winner.dimensions.find((other) => other.id === dimension.id);
      if (!winnerDimension || dimension.score === null || winnerDimension.score === null) return false;
      return dimension.score > winnerDimension.score + 0.05;
    });
    if (!beats) continue;
    if (entry.score > bestAlternativeScore) {
      bestAlternativeScore = entry.score;
      bestAlternative = entry;
    }
  }

  if (bestAlternative) {
    badges.set(bestAlternative.candidate.product.id, 'best_alternative');
  }

  return badges;
}

/** The price of a scored candidate, when it is known. */
function priceOf(entry: ScoredCandidate): number | null {
  const candidate = entry.candidate as unknown as { pricePaise?: number | null };
  return typeof candidate.pricePaise === 'number' ? candidate.pricePaise : null;
}

/** The dimension the shopper's strongest stated priority maps to. */
function dimensionForTopPriority(
  requirements: PurchaseRequirements,
): { id: IntelligenceDimensionId; label: string } | null {
  const entries = Object.entries(requirements.priorities ?? {})
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [priority] of entries) {
    const dimension = dimensionForPriorityKey(priority);
    if (dimension) return dimension;
  }
  return null;
}

/** Map a priority key onto a dimension. */
function dimensionForPriorityKey(priority: string): { id: IntelligenceDimensionId; label: string } | null {
  const map: Record<string, { id: IntelligenceDimensionId; label: string }> = {
    battery: { id: 'product', label: 'Battery and endurance' },
    camera: { id: 'product', label: 'Camera capability' },
    performance: { id: 'product', label: 'Raw performance' },
    display: { id: 'product', label: 'Display quality' },
    durability: { id: 'ownership', label: 'Durability' },
    reliability: { id: 'ownership', label: 'Reliability' },
    service: { id: 'ownership', label: 'Service and warranty' },
    warranty: { id: 'ownership', label: 'Warranty' },
    value: { id: 'financial', label: 'Value for money' },
    price: { id: 'financial', label: 'Price' },
    running_cost: { id: 'financial', label: 'Running cost' },
    compatibility: { id: 'compatibility', label: 'Compatibility' },
    fitment: { id: 'compatibility', label: 'Fitment' },
    timing: { id: 'market', label: 'Market timing' },
    availability: { id: 'market', label: 'Availability' },
    safety: { id: 'risk', label: 'Safety' },
    authenticity: { id: 'risk', label: 'Authenticity' },
  };
  const key = priority.toLowerCase();
  if (map[key]) return map[key] as { id: IntelligenceDimensionId; label: string };
  for (const [needle, dimension] of Object.entries(map)) {
    if (key.includes(needle)) return dimension;
  }
  return null;
}
