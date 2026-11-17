/**
 * Decision weight resolution.
 *
 * Weights say how much each intelligence dimension contributes to a
 * decision. They are:
 *
 *  - **configurable per category**, because a washing machine's decision is
 *    dominated by ownership and running cost while a phone's is dominated by
 *    product and market intelligence;
 *  - **adapted to the user's stated priorities**, so someone who says
 *    "battery is what matters" shifts weight towards the evidence about
 *    battery;
 *  - **bounded**, so no single dimension — and in particular no single class
 *    of evidence such as customer reviews — can dominate the decision.
 *
 * The review cap is the important one. Reviews are one evidence source among
 * several. A product with excellent owner reviews but poor specifications
 * must not outrank one with better specifications and average reviews.
 */

import type { CategoryId, PurchaseRequirements } from '../../domain/types.ts';
import { getCategory } from '../categories/index.ts';
import type { IntelligenceDimensionId } from './types.ts';

/** How much each dimension contributes, before adaptation. */
export type DecisionWeights = Partial<Record<IntelligenceDimensionId, number>>;

/**
 * The default weights.
 *
 * `financial` and `product` lead because they are what a shopper most often
 * asks about. `ownership` and `market` follow. `risk` is small because it
 * should not move the ranking much — except in safety-critical categories,
 * where the profile raises it.
 */
export const DEFAULT_WEIGHTS: Record<IntelligenceDimensionId, number> = {
  requirement: 0.08,
  product: 0.22,
  ownership: 0.16,
  financial: 0.22,
  compatibility: 0.1,
  market: 0.12,
  risk: 0.1,
  decision: 0,
};

/**
 * The maximum share of a decision that customer-experience evidence may
 * carry, regardless of what the category profile says.
 *
 * This is a structural guarantee, not a tuning knob: no category can
 * accidentally configure itself into ranking on star ratings.
 */
export const MAX_REVIEW_DEPENDENCE = 0.25;

/**
 * Which dimension a stated priority feeds into.
 *
 * The user's words are mapped onto the dimensions that can actually speak to
 * them. A priority that maps nowhere is reported as a gap rather than
 * silently ignored.
 */
const PRIORITY_DIMENSIONS: Record<string, IntelligenceDimensionId> = {
  camera: 'product',
  battery: 'product',
  display: 'product',
  performance: 'product',
  processor: 'product',
  design: 'product',
  build_quality: 'product',
  comfort: 'product',
  fit: 'product',
  sound: 'product',
  audio: 'product',
  cleaning: 'product',
  capacity: 'product',
  ingredients: 'product',
  nutrition: 'product',
  fresh: 'product',

  durability: 'ownership',
  reliability: 'ownership',
  service: 'ownership',
  warranty: 'ownership',
  longevity: 'ownership',
  heating: 'ownership',
  repair: 'ownership',
  noise: 'ownership',

  value: 'financial',
  price: 'financial',
  running_cost: 'financial',
  running: 'financial',
  electricity: 'financial',
  maintenance: 'financial',
  emi: 'financial',

  compatibility: 'compatibility',
  fitment: 'compatibility',
  upgrade: 'compatibility',
  upgradeability: 'compatibility',

  timing: 'market',
  availability: 'market',
  stock: 'market',
  deal: 'market',

  safety: 'risk',
  authenticity: 'risk',
  genuine: 'risk',
  trust: 'risk',
};

/** The dimension a priority key feeds into, or null. */
export function dimensionForPriority(priority: string): IntelligenceDimensionId | null {
  const key = priority.toLowerCase().trim();
  if (key in PRIORITY_DIMENSIONS) return PRIORITY_DIMENSIONS[key] as IntelligenceDimensionId;
  for (const [needle, dimension] of Object.entries(PRIORITY_DIMENSIONS)) {
    if (key.includes(needle)) return dimension;
  }
  return null;
}

/**
 * Resolve the weights for a category and a brief.
 *
 * The category profile's weights override the defaults; the user's stated
 * priorities then shift weight towards the dimensions that speak to them.
 * The result is normalised so the weights sum to one.
 */
export function resolveWeights(
  category: CategoryId | null | undefined,
  requirements: PurchaseRequirements,
): { weights: Record<IntelligenceDimensionId, number>; priorityShift: Record<string, number> } {
  const profile = category ? getCategory(category) : null;
  const base: Record<IntelligenceDimensionId, number> = {
    ...DEFAULT_WEIGHTS,
    ...(profile?.decisionWeights ?? {}),
  };

  // A safety-critical category gives risk real weight.
  if (profile?.safetyCritical) {
    base.risk = Math.max(base.risk, 0.18);
    base.compatibility = Math.max(base.compatibility, 0.14);
  }

  // Apply the user's priorities.
  const shift: Record<string, number> = {};
  let totalShift = 0;

  for (const [priority, strength] of Object.entries(requirements.priorities ?? {})) {
    if (strength <= 0) continue;
    const dimension = dimensionForPriority(priority);
    if (!dimension) continue;
    const amount = strength * 0.5;
    shift[dimension] = (shift[dimension] ?? 0) + amount;
    totalShift += amount;
  }

  for (const [dimension, amount] of Object.entries(shift)) {
    const key = dimension as IntelligenceDimensionId;
    base[key] = base[key] + amount;
  }

  // Normalise.
  const total = Object.values(base).reduce((sum, value) => sum + value, 0) || 1;
  const weights = {} as Record<IntelligenceDimensionId, number>;
  for (const [key, value] of Object.entries(base)) {
    weights[key as IntelligenceDimensionId] = value / total;
  }

  return { weights, priorityShift: shift };
}

/**
 * Redistribute weight away from dimensions with no evidence.
 *
 * A dimension that could not be assessed must not drag a product's score
 * down. Its weight is shared among the dimensions that *could* be assessed,
 * proportionally.
 */
export function redistributeForUnknown(
  weights: Record<IntelligenceDimensionId, number>,
  assessable: IntelligenceDimensionId[],
): Record<IntelligenceDimensionId, number> {
  const assessableSet = new Set(assessable);
  const unknownWeight = Object.entries(weights)
    .filter(([key]) => !assessableSet.has(key as IntelligenceDimensionId))
    .reduce((sum, [, value]) => sum + value, 0);

  if (unknownWeight <= 0) return weights;

  const assessableWeight = Object.entries(weights)
    .filter(([key]) => assessableSet.has(key as IntelligenceDimensionId))
    .reduce((sum, [, value]) => sum + value, 0);

  if (assessableWeight <= 0) return weights;

  // Each assessable dimension keeps its share of the assessable weight and
  // absorbs the freed weight in proportion. The assessable weights end up
  // summing to the original total.
  const redistributed = { ...weights };
  for (const key of assessableSet) {
    const dimension = key as IntelligenceDimensionId;
    redistributed[dimension] = weights[dimension] / assessableWeight;
  }
  for (const key of Object.keys(redistributed)) {
    const dimension = key as IntelligenceDimensionId;
    if (!assessableSet.has(dimension)) redistributed[dimension] = 0;
  }

  return redistributed;
}

/**
 * How much of a candidate's score rests on customer-experience evidence.
 *
 * Used to report review dependence and to enforce the structural cap.
 */
export function reviewDependence(
  evidenceByDimension: Map<IntelligenceDimensionId, { class: string; weight: number }[]>,
): number {
  let total = 0;
  let fromReviews = 0;

  for (const [, entries] of evidenceByDimension) {
    for (const entry of entries) {
      total += entry.weight;
      if (entry.class === 'customer_experience') fromReviews += entry.weight;
    }
  }

  if (total <= 0) return 0;
  return Number((fromReviews / total).toFixed(3));
}
