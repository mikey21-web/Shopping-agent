/**
 * Recommendation engine.
 *
 * Produces ranked, explainable recommendations: best overall, best value,
 * best performance, best long-term choice, best budget option and best
 * alternative.
 *
 * Rules enforced here:
 *  - Affiliate commission never appears in the scoring input, so it cannot
 *    influence a recommendation.
 *  - A product with no verifiable price is never labelled "best value".
 *  - Every score decomposes into named components with their own evidence.
 *  - Products that violate a stated must-have are excluded, with the reason
 *    recorded rather than silently dropped.
 */

import type {
  Product,
  PurchaseRequirements,
  Recommendation,
  RecommendationBadge,
  RecommendationSet,
  ReviewIntelligence,
  ScoreComponent,
} from '../../domain/types.ts';
import {
  componentsForCategory,
  getCategory,
  type ComponentDefinition,
  type ScoreInput,
} from '../categories/index.ts';
import { formatPaise } from '../normalize/specs.ts';

export interface Candidate {
  product: Product;
  /** Guaranteed payable price in paise, or null when unknown. */
  pricePaise: number | null;
  /** True when the price came from bundled sample data. */
  priceIsSample: boolean;
  reviews: ReviewIntelligence | null;
  /** Best retailer for this product. */
  retailer: string | null;
}

/**
 * Apply the user's stated priorities to the base component weights.
 * A priority of 1.0 doubles the component's weight; 0 leaves it untouched.
 */
export function applyRequirementWeights(
  components: ComponentDefinition[],
  requirements: PurchaseRequirements,
): { component: ComponentDefinition; weight: number }[] {
  const workloads = new Set(requirements.workloads);

  const active = components.map((component) => {
    let weight = component.baseWeight;

    // Workload-tagged components only participate when the workload applies.
    if (component.workloads && component.workloads.length > 0) {
      const matches = component.workloads.some((tag) => workloads.has(tag));
      if (!matches) weight = 0;
    }

    const priority = component.priorityKey ? (requirements.priorities[component.priorityKey] ?? 0) : 0;
    if (priority > 0) weight *= 1 + priority;

    return { component, weight };
  });

  const total = active.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    // Nothing has weight — fall back to the base weights so we still score.
    const fallbackTotal = components.reduce((sum, component) => sum + component.baseWeight, 0) || 1;
    return components.map((component) => ({
      component,
      weight: component.baseWeight / fallbackTotal,
    }));
  }

  return active.map((entry) => ({ ...entry, weight: entry.weight / total }));
}

/**
 * Check hard requirements ("must have 5G", "at least 16GB RAM").
 * Returns the satisfied list and the violations.
 */
export function checkMustHaves(
  product: Product,
  mustHaves: string[],
): { satisfied: string[]; violated: string[] } {
  const satisfied: string[] = [];
  const violated: string[] = [];
  const specs = product.specs;
  const haystack = [
    specs.soc ?? '',
    specs.os ?? '',
    specs.network ?? '',
    specs.storageType ?? '',
    specs.displayPanel ?? '',
    String(specs.ramGb ?? ''),
    String(specs.storageGb ?? ''),
    String(specs.batteryMah ?? ''),
    String(specs.displaySizeIn ?? ''),
    ...Object.values(specs.extra).map(String),
    product.displayName,
  ]
    .join(' ')
    .toLowerCase();

  for (const requirement of mustHaves) {
    const text = requirement.trim().toLowerCase();
    if (!text) continue;

    let ok = false;
    let pattern: RegExp | null = null;

    const ramMatch = text.match(/(\d+)\s*gb\s*(ram|memory)/);
    if (ramMatch?.[1]) {
      ok = (specs.ramGb ?? 0) >= Number.parseInt(ramMatch[1], 10);
      pattern = /ram|memory/;
    } else if (/5g/.test(text)) {
      ok = specs.network === '5G' || haystack.includes('5g');
      pattern = /5g/;
    } else if (/4g/.test(text)) {
      ok = specs.network === '4G' || haystack.includes('4g');
      pattern = /4g/;
    } else if (/amoled/.test(text)) {
      ok = haystack.includes('amoled');
      pattern = /amoled/;
    } else if (/(\d+)\s*gb\s*(storage|ssd|rom)/.test(text)) {
      const need = Number.parseInt(text.match(/(\d+)\s*gb\s*(?:storage|ssd|rom)/)?.[1] ?? '0', 10);
      ok = (specs.storageGb ?? 0) >= need;
      pattern = /storage|ssd|rom/;
    } else if (/ssd/.test(text)) {
      ok = haystack.includes('ssd');
      pattern = /ssd/;
    } else if (/nvme/.test(text)) {
      ok = haystack.includes('nvme');
      pattern = /nvme/;
    } else {
      // Fall back to a literal phrase search over the spec surface.
      const words = text.split(/\s+/).filter((word) => word.length > 3);
      ok = words.length > 0 && words.every((word) => haystack.includes(word));
      pattern = null;
    }

    if (ok) satisfied.push(requirement);
    else violated.push(requirement);
  }

  return { satisfied, violated };
}

/** Score one candidate. */
export function scoreCandidate(
  candidate: Candidate,
  requirements: PurchaseRequirements,
  referencePricePaise: number | null,
): { score: number; components: ScoreComponent[] } {
  const { components: profile } = componentsForCategory(candidate.product.category);

  const weighted = applyRequirementWeights(profile, requirements);

  const input: ScoreInput = {
    specs: candidate.product.specs,
    reviews: candidate.reviews,
    pricePaise: candidate.pricePaise,
    referencePricePaise,
    requirements,
    category: getCategory(candidate.product.category),
  };

  const components: ScoreComponent[] = [];
  let total = 0;

  for (const { component, weight } of weighted) {
    if (weight <= 0) continue;
    const result = component.compute(input);
    const score = Math.max(0, Math.min(1, result.score));
    total += score * weight;
    components.push({
      key: component.key,
      label: component.label,
      score: Number(score.toFixed(3)),
      weight: Number(weight.toFixed(3)),
      evidence: result.evidence,
    });
  }

  components.sort((a, b) => b.weight - a.weight);
  return { score: Number(total.toFixed(4)), components };
}

/** Build strength / weakness summaries from the component breakdown. */
function summarise(
  components: ScoreComponent[],
  reviews: ReviewIntelligence | null,
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const component of components) {
    if (component.score >= 0.7 && component.weight >= 0.1) {
      strengths.push(`${component.label} scores well (${Math.round(component.score * 100)}%)`);
    }
    if (component.score <= 0.4 && component.weight >= 0.1) {
      weaknesses.push(`${component.label} is a weakness (${Math.round(component.score * 100)}%)`);
    }
  }

  // Review-derived weaknesses are more informative than a bare number.
  if (reviews) {
    for (const complaint of reviews.complaints.slice(0, 3)) {
      weaknesses.push(`Recurring complaint: ${complaint}`);
    }
    for (const positive of reviews.positives.slice(0, 2)) {
      strengths.push(`Owners frequently praise: ${positive}`);
    }
  }

  return { strengths: strengths.slice(0, 6), weaknesses: weaknesses.slice(0, 6) };
}

export interface BuildRecommendationOptions {
  /** Maximum recommendations to return. */
  limit?: number;
  /** When true, products without a price cannot take a value badge. */
  requirePriceForValue?: boolean;
}

/**
 * Build the full recommendation set for a requirement set.
 */
export function buildRecommendationSet(
  candidates: Candidate[],
  requirements: PurchaseRequirements,
  options: BuildRecommendationOptions = {},
): RecommendationSet {
  const limit = options.limit ?? 6;
  const notes: string[] = [];

  if (candidates.length === 0) {
    return {
      requirements,
      generatedAt: new Date().toISOString(),
      recommendations: [],
      considered: 0,
      excluded: [],
      degraded: true,
      dataQualityNotes: ['No products matched the requested category or budget.'],
    };
  }

  // --- Budget filtering ----------------------------------------------------
  const budgetFiltered = candidates.filter((candidate) => {
    if (candidate.pricePaise === null) return true; // unknown price: keep, flag later
    if (requirements.budgetMinPaise != null && candidate.pricePaise < requirements.budgetMinPaise) {
      return false;
    }
    if (requirements.budgetMaxPaise != null && candidate.pricePaise > requirements.budgetMaxPaise) {
      return false;
    }
    return true;
  });

  const excluded: { productId: string; reason: string }[] = [];
  for (const candidate of candidates) {
    if (budgetFiltered.includes(candidate)) continue;
    excluded.push({
      productId: candidate.product.id,
      reason: `Outside the stated budget of ${formatPaise(requirements.budgetMinPaise ?? null)} – ${formatPaise(requirements.budgetMaxPaise ?? null)}`,
    });
  }

  // --- Must-have filtering -------------------------------------------------
  const eligible: Candidate[] = [];
  for (const candidate of budgetFiltered) {
    const { violated } = checkMustHaves(candidate.product, requirements.mustHaves);
    if (violated.length > 0) {
      excluded.push({
        productId: candidate.product.id,
        reason: `Does not meet required feature(s): ${violated.join(', ')}`,
      });
      continue;
    }
    eligible.push(candidate);
  }

  if (eligible.length === 0) {
    return {
      requirements,
      generatedAt: new Date().toISOString(),
      recommendations: [],
      considered: candidates.length,
      excluded,
      degraded: true,
      dataQualityNotes: [
        'Every candidate was filtered out by the budget or required-feature constraints.',
      ],
    };
  }

  // --- Reference price for value normalisation -----------------------------
  const priced = eligible
    .map((candidate) => candidate.pricePaise)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b);
  const referencePricePaise =
    priced.length > 0 ? priced[Math.floor(priced.length / 2)] ?? null : null;

  // --- Scoring -------------------------------------------------------------
  const scored = eligible.map((candidate) => {
    const { score, components } = scoreCandidate(candidate, requirements, referencePricePaise);
    const { strengths, weaknesses } = summarise(components, candidate.reviews);
    const evidence: string[] = [];
    for (const component of components) {
      evidence.push(`${component.label}: ${Math.round(component.score * 100)}% (weight ${Math.round(component.weight * 100)}%)`);
    }
    if (candidate.priceIsSample) {
      evidence.push('Price shown is bundled sample data, not a live retailer price');
    }
    if (!candidate.reviews || candidate.reviews.reviewCount === 0) {
      evidence.push('No customer reviews available — review-based components are neutral');
    }

    const recommendation: Recommendation = {
      productId: candidate.product.id,
      displayName: candidate.product.displayName,
      brand: candidate.product.brand,
      imageUrl: candidate.product.imageUrl ?? null,
      badge: null,
      score,
      components,
      summary: '',
      strengths,
      weaknesses,
      evidence,
      reviewConfidence: candidate.reviews ? candidate.reviews.provenance.confidence : 0,
      bestPricePaise: candidate.pricePaise,
      bestRetailer: candidate.retailer as Recommendation['bestRetailer'],
      priceIsSample: candidate.priceIsSample,
    };
    return { candidate, recommendation };
  });

  scored.sort((a, b) => b.recommendation.score - a.recommendation.score);

  const [best, ...rest] = scored;

  // --- Badges --------------------------------------------------------------
  const badgeAssignments = new Map<string, RecommendationBadge>();

  if (best) badgeAssignments.set(best.candidate.product.id, 'best_overall');

  // Best value: strongest capability per rupee among priced candidates.
  const valueCandidates = scored.filter((entry) => entry.candidate.pricePaise !== null);
  if (valueCandidates.length >= 2) {
    const bestValue = valueCandidates.reduce((bestEntry, entry) => {
      const valueOf = (e: (typeof valueCandidates)[number]): number => {
        const price = e.candidate.pricePaise ?? Infinity;
        return e.recommendation.score / Math.max(0.0001, price / 1_000_000);
      };
      return valueOf(entry) > valueOf(bestEntry) ? entry : bestEntry;
    });
    if (!badgeAssignments.has(bestValue.candidate.product.id)) {
      badgeAssignments.set(bestValue.candidate.product.id, 'best_value');
    }
  }

  // Best performance: highest score on performance-weighted components.
  const performanceCandidates = scored.filter((entry) =>
    entry.recommendation.components.some((component) =>
      ['performance', 'cpu', 'gpu'].includes(component.key),
    ),
  );
  if (performanceCandidates.length >= 2) {
    const performanceOf = (entry: (typeof performanceCandidates)[number]): number => {
      const relevant = entry.recommendation.components.filter((component) =>
        ['performance', 'cpu', 'gpu'].includes(component.key),
      );
      if (relevant.length === 0) return 0;
      const weight = relevant.reduce((sum, component) => sum + component.weight, 0) || 1;
      return relevant.reduce((sum, component) => sum + component.score * component.weight, 0) / weight;
    };
    const bestPerformance = performanceCandidates.reduce((a, b) => (performanceOf(a) > performanceOf(b) ? a : b));
    if (!badgeAssignments.has(bestPerformance.candidate.product.id)) {
      badgeAssignments.set(bestPerformance.candidate.product.id, 'best_performance');
    }
  }

  // Best long-term: reliability signals weighted, ignoring raw spec ceiling.
  if (scored.length >= 3) {
    const longTermOf = (entry: (typeof scored)[number]): number => {
      const reliability = entry.recommendation.components.filter((component) =>
        ['build_quality', 'durability', 'software_support', 'thermals', 'service'].includes(component.key),
      );
      if (reliability.length === 0) return 0;
      const weight = reliability.reduce((sum, component) => sum + component.weight, 0) || 1;
      const base = reliability.reduce((sum, component) => sum + component.score * component.weight, 0) / weight;
      // Penalty when review authenticity risk is high.
      const risk = entry.candidate.reviews?.authenticityRisk ?? 0;
      return base * (1 - risk * 0.5);
    };
    const bestLongTerm = scored.reduce((a, b) => (longTermOf(a) > longTermOf(b) ? a : b));
    if (!badgeAssignments.has(bestLongTerm.candidate.product.id)) {
      badgeAssignments.set(bestLongTerm.candidate.product.id, 'best_long_term');
    }
  }

  // Best budget: cheapest eligible candidate that clears a quality bar.
  const budgetCandidates = scored
    .filter((entry) => entry.candidate.pricePaise !== null)
    .sort((a, b) => (a.candidate.pricePaise ?? 0) - (b.candidate.pricePaise ?? 0));
  const qualityBar = 0.45;
  const bestBudget = budgetCandidates.find((entry) => entry.recommendation.score >= qualityBar) ?? budgetCandidates[0];
  if (bestBudget && !badgeAssignments.has(bestBudget.candidate.product.id)) {
    badgeAssignments.set(bestBudget.candidate.product.id, 'best_budget');
  }

  // Best alternative: a strong second choice that differs from the winner.
  const alternative = scored.find((entry) => !badgeAssignments.has(entry.candidate.product.id));
  if (alternative) badgeAssignments.set(alternative.candidate.product.id, 'best_alternative');

  // --- Finalise ------------------------------------------------------------
  const recommendations = scored.slice(0, limit).map((entry) => {
    const recommendation = { ...entry.recommendation };
    recommendation.badge = badgeAssignments.get(entry.candidate.product.id) ?? null;
    recommendation.summary = buildSummary(recommendation, entry.candidate);
    return recommendation;
  });

  // --- Data quality notes --------------------------------------------------
  const samplePrices = recommendations.filter((r) => r.priceIsSample).length;
  if (samplePrices > 0) {
    notes.push(
      `${samplePrices} of ${recommendations.length} recommendations use bundled sample pricing. Verify the price on the retailer page before buying.`,
    );
  }
  const noReviews = recommendations.filter((r) => r.reviewConfidence === 0).length;
  if (noReviews > 0) {
    notes.push(`${noReviews} recommendations have no customer review data.`);
  }
  if (requirements.category && !componentsForCategory(requirements.category).specialised) {
    notes.push(
      `The "${requirements.category}" category does not yet have a specialised scoring profile; a generic profile was used.`,
    );
  }
  const missingPrice = recommendations.filter((r) => r.bestPricePaise === null).length;
  if (missingPrice > 0) {
    notes.push(`${missingPrice} recommendations have no confirmed retailer price.`);
  }

  return {
    requirements,
    generatedAt: new Date().toISOString(),
    recommendations,
    considered: candidates.length,
    excluded,
    degraded: notes.length > 0,
    dataQualityNotes: notes,
  };
}

function buildSummary(recommendation: Recommendation, candidate: Candidate): string {
  const top = recommendation.components[0];
  const parts: string[] = [];
  if (top) parts.push(`Strongest on ${top.label.toLowerCase()} (${Math.round(top.score * 100)}%)`);
  const pricePart = candidate.pricePaise !== null ? `at ${formatPaise(candidate.pricePaise)}` : 'at an unconfirmed price';
  const weakest = [...recommendation.components]
    .filter((component) => component.weight >= 0.1)
    .sort((a, b) => a.score - b.score)[0];
  if (weakest) parts.push(`weakest on ${weakest.label.toLowerCase()}`);
  return `${parts.join(', ')} ${pricePart}.`;
}
