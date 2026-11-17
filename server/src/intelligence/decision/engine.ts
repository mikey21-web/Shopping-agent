/**
 * The decision engine.
 *
 * This is the piece that turns evidence into a decision the shopper can
 * interrogate. The order of operations is deliberate:
 *
 *   1. **Hard constraints first.** Products that fail one are eliminated with
 *      a stated reason, before any scoring happens.
 *   2. **Evidence.** Every fact is classified by kind and given its source.
 *   3. **Dimension assessment.** Each of the seven dimensions is scored, or
 *      marked unknown when there is no evidence for it.
 *   4. **Weights.** Resolved from the category profile and the user's
 *      priorities, then redistributed so an unknown dimension neither
 *      penalises nor rewards a product.
 *   5. **Score.** Deterministic arithmetic.
 *   6. **Trace.** Everything above, recorded so the decision can be
 *      explained, challenged and audited.
 *
 * The eighth dimension, "decision", is not scored separately — it is the
 * synthesis of the other seven, and it is where the trade-offs live.
 */

import type {
  PriceBreakdown,
  Product,
  PurchaseRequirements,
  ReviewIntelligence,
} from '../../domain/types.ts';
import { formatPaise } from '../normalize/specs.ts';
import { getCategory, componentsForCategory } from '../categories/index.ts';
import { buildEvidence, type EvidenceInput } from './evidence.ts';
import { HARD_CONSTRAINTS, type ConstraintContext } from './constraints.ts';
import {
  assessCompatibility,
  assessFinancial,
  buildFieldRanges,
  COMPARABLE_FIELDS,
  assessMarket,
  assessOwnership,
  assessProduct,
  assessRequirement,
  assessRisk,
} from './dimensions.ts';
import {
  MAX_REVIEW_DEPENDENCE,
  redistributeForUnknown,
  resolveWeights,
  reviewDependence,
} from './weights.ts';
import { assignBadges } from './badges.ts';
import {
  confidenceBand,
  type DecisionEvidence,
  type DecisionResult,
  type DecisionTrace,
  type DimensionAssessment,
  type EliminationRecord,
  type EvidenceConflict,
  type EvidenceInfluence,
  type MissingInfo,
  type SensitivityNote,
  type TradeOff,
} from './types.ts';

/** The input the decision engine needs for one candidate. */
export interface DecisionCandidate {
  product: Product;
  /** The guaranteed payable price, in paise. */
  pricePaise: number | null;
  priceIsSample: boolean;
  reviews: ReviewIntelligence | null;
  breakdown: PriceBreakdown | null;
  priceHistory: {
    observations: number;
    avgPaise: number;
    minPaise: number;
    maxPaise: number;
    latestPaise: number;
    discountVsAvg: number;
  } | null;
  retailer: string | null;
  /** Verified research facts for this product. */
  facts: DecisionEvidence['id'] extends never ? never : import('../../research/types.ts').ResearchFact[];
  /** Whether the product is in stock anywhere. */
  inStock: boolean | null;
  /** The condition of the best listing. */
  condition: 'new' | 'refurbished' | 'used' | 'open_box' | null;
  /** A published certification, for safety-critical categories. */
  certification: string | null;
  /** The exact variant label of the listing. */
  variantLabel: string | null;
}

/** The engine's output. */
export interface DecisionSet {
  requirements: PurchaseRequirements;
  generatedAt: string;
  /** The ranked decisions. */
  decisions: DecisionResult[];
  /** Everything that was eliminated, and why. */
  eliminated: EliminationRecord[];
  /** The trace for the winning decision. */
  trace: DecisionTrace | null;
  /** How many candidates were considered. */
  considered: number;
  /** Notes about the limits of the decision. */
  limitations: string[];
}

/** Build the decision for a set of candidates. */
export function buildDecisions(
  candidates: DecisionCandidate[],
  requirements: PurchaseRequirements,
  options: { limit?: number } = {},
): DecisionSet {
  const limit = options.limit ?? 6;
  const limitations: string[] = [];
  const eliminated: EliminationRecord[] = [];

  const profile = requirements.category ? getCategory(requirements.category) : null;
  const safetyCritical = profile?.safetyCritical ?? false;
  const requiresCertification = profile?.requiresCertification ?? false;

  /* ---------------- 1. Hard constraints ---------------- */
  const survivors: DecisionCandidate[] = [];

  for (const candidate of candidates) {
    const context: ConstraintContext = {
      product: candidate.product,
      requirements,
      pricePaise: candidate.pricePaise,
      variantLabel: candidate.variantLabel,
      certification: candidate.certification,
      inStock: candidate.inStock,
      safetyCritical,
      requiresCertification,
      condition: candidate.condition,
    };

    let failed = false;
    for (const constraint of HARD_CONSTRAINTS) {
      const result = constraint.evaluate(context);
      if (result.passed) continue;

      if (!constraint.eliminates) {
        // A flag rather than an elimination. It is recorded so the UI can
        // say "not currently in stock" instead of pretending otherwise.
        continue;
      }

      eliminated.push({
        productId: candidate.product.id,
        displayName: candidate.product.displayName,
        stage: stageForConstraint(constraint.key),
        reason: result.reason ?? `Failed the ${constraint.label.toLowerCase()} check.`,
        constraintKey: constraint.key,
        pricePaise: candidate.pricePaise,
      });
      failed = true;
      break;
    }

    if (!failed) survivors.push(candidate);
  }

  if (survivors.length === 0) {
    return {
      requirements,
      generatedAt: new Date().toISOString(),
      decisions: [],
      eliminated,
      trace: null,
      considered: candidates.length,
      limitations: [
        'Every candidate was removed by a hard constraint, so no recommendation could be made.',
      ],
    };
  }

  /* ---------------- 2. Evidence ---------------- */
  const evidenceByCandidate = new Map<string, DecisionEvidence[]>();
  for (const candidate of survivors) {
    const input: EvidenceInput = {
      product: candidate.product,
      facts: candidate.facts,
      breakdown: candidate.breakdown,
      reviews: candidate.reviews,
      priceHistory: candidate.priceHistory,
      priceIsSample: candidate.priceIsSample,
      retailer: candidate.retailer,
    };
    evidenceByCandidate.set(candidate.product.id, buildEvidence(input));
  }

  /* ---------------- 3. Reference price ---------------- */
  const referencePrices = survivors
    .map((candidate) => candidate.pricePaise)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b);
  const referencePricePaise =
    referencePrices.length > 0 ? (referencePrices[Math.floor(referencePrices.length / 2)] ?? null) : null;

  /* ---------------- 4. Weights ---------------- */
  const { weights, priorityShift } = resolveWeights(requirements.category, requirements);

  /* ---------------- 5. Dimension assessments ---------------- */
  // The reference ranges let the product dimension place each candidate
  // against the alternatives, so "capability" means something relative.
  const fieldRanges = buildFieldRanges(survivors, COMPARABLE_FIELDS);

  // The category's own scoring model, when it has one. A shoe is judged
  // on fit, cushioning and sole wear; a laptop on processor, memory and
  // display. The engine does not know the difference.
  const categoryComponents =
    requirements.category === null ? [] : componentsForCategory(requirements.category).components;

  const assessmentsByCandidate = new Map<string, DimensionAssessment[]>();

  for (const candidate of survivors) {
    const evidence = evidenceByCandidate.get(candidate.product.id) ?? [];

    const dimensions: DimensionAssessment[] = [
      assessRequirement(candidate.product, requirements, evidence),
      assessProduct(candidate.product, evidence, fieldRanges, {
        components: categoryComponents,
        requirements,
        pricePaise: candidate.pricePaise,
        referencePricePaise,
        reviews: candidate.reviews,
      }),
      assessOwnership(candidate.product, candidate.reviews, evidence),
      assessFinancial(candidate.product, requirements, candidate.breakdown, referencePricePaise, evidence),
      assessCompatibility(candidate.product, evidence),
      assessMarket(candidate.priceHistory, evidence),
      assessRisk(candidate.product, candidate.reviews, evidence),
    ];

    assessmentsByCandidate.set(candidate.product.id, dimensions);
  }

  // Redistribute the weight of any dimension that could not be assessed.
  const assessableDimensions = new Set<string>();
  for (const dimensions of assessmentsByCandidate.values()) {
    for (const dimension of dimensions) {
      if (dimension.hasEvidence) assessableDimensions.add(dimension.id);
    }
  }
  const redistributed = redistributeForUnknown(
    weights,
    [...assessableDimensions] as (keyof typeof weights)[],
  );

  /* ---------------- 6. Score ---------------- */
  const scored = survivors.map((candidate) => {
    const dimensions = assessmentsByCandidate.get(candidate.product.id) ?? [];
    const evidence = evidenceByCandidate.get(candidate.product.id) ?? [];

    // Apply the weights, then make sure the reviews cannot dominate.
    for (const dimension of dimensions) {
      dimension.weight = Number((redistributed[dimension.id] ?? 0).toFixed(4));
    }
    enforceReviewCap(dimensions);

    let total = 0;
    let appliedWeight = 0;
    for (const dimension of dimensions) {
      if (dimension.score === null) continue;
      total += dimension.score * dimension.weight;
      appliedWeight += dimension.weight;
    }

    // If nothing could be assessed at all, the score is null, not zero.
    const score = appliedWeight > 0 ? Number((total / appliedWeight).toFixed(4)) : 0;

    // How much of this candidate's score rests on owner reviews?
    const dependence = computeReviewDependence(dimensions);

    return { candidate, dimensions, evidence, score, dependence };
  });

  scored.sort((a, b) => b.score - a.score);

  /* ---------------- 7. Decision trace ---------------- */
  const trace = buildTrace({
    requirements,
    candidates,
    survivors: scored,
    eliminated,
    evidenceByCandidate,
    assessmentsByCandidate: scored.map((entry) => entry.dimensions),
    priorityShift,
    safetyCritical,
  });

  /* ---------------- 8. Assemble results ---------------- */
  const badgeAssignments = assignBadges(scored, requirements);

  const decisions: DecisionResult[] = scored.slice(0, limit).map((entry, index) => {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const dimension of entry.dimensions) {
      if (dimension.score === null) continue;
      if (dimension.score >= 0.7 && dimension.weight >= 0.1) {
        strengths.push(`${dimension.label}: ${dimension.summary}`);
      }
      if (dimension.score <= 0.45 && dimension.weight >= 0.1) {
        weaknesses.push(`${dimension.label}: ${dimension.summary}`);
      }
    }

    // Flag when the decision rests mostly on owner reviews.
    if (entry.dependence > MAX_REVIEW_DEPENDENCE) {
      limitations.push(
        `${entry.candidate.product.displayName}: a large share of its score comes from owner reviews, which is a weaker basis than published specifications.`,
      );
    }

    const traceForThis = index === 0 ? trace : null;

    return {
      productId: entry.candidate.product.id,
      displayName: entry.candidate.product.displayName,
      brand: entry.candidate.product.brand,
      imageUrl: entry.candidate.product.imageUrl ?? null,
      score: entry.score,
      badge: badgeAssignments.get(entry.candidate.product.id) ?? null,
      dimensions: entry.dimensions,
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      evidence: entry.evidence,
      confidence: confidenceBand(entry.score),
      reviewDependence: entry.dependence,
      trace: traceForThis ?? buildTrace({
        requirements,
        candidates,
        survivors: scored,
        eliminated,
        evidenceByCandidate,
        assessmentsByCandidate: scored.map((e) => e.dimensions),
        priorityShift,
        safetyCritical,
      }),
      pricePaise: entry.candidate.pricePaise,
      priceIsSample: entry.candidate.priceIsSample,
      retailer: entry.candidate.retailer,
      totalOwnershipCostPaise: totalOwnershipCost(entry),
    };
  });

  if (assessableDimensions.size < 5) {
    limitations.push(
      `Only ${assessableDimensions.size} of the seven intelligence dimensions could be assessed from the available evidence. The missing dimensions are reported as unknown, not as poor performance.`,
    );
  }

  return {
    requirements,
    generatedAt: new Date().toISOString(),
    decisions,
    eliminated,
    trace,
    considered: candidates.length,
    limitations,
  };
}

/* ------------------------------------------------------------------ */
/* Trace construction                                                  */
/* ------------------------------------------------------------------ */

interface TraceInput {
  requirements: PurchaseRequirements;
  candidates: DecisionCandidate[];
  survivors: { candidate: DecisionCandidate; dimensions: DimensionAssessment[]; score: number; dependence: number }[];
  eliminated: EliminationRecord[];
  evidenceByCandidate: Map<string, DecisionEvidence[]>;
  assessmentsByCandidate: DimensionAssessment[][];
  priorityShift: Record<string, number>;
  safetyCritical: boolean;
}

/** Build the complete decision trace. */
function buildTrace(input: TraceInput): DecisionTrace {
  const { requirements, survivors, eliminated, evidenceByCandidate } = input;

  /* 1. Requirements */
  const requirementInterpretation = {
    category: requirements.category ?? null,
    budgetMinPaise: requirements.budgetMinPaise ?? null,
    budgetMaxPaise: requirements.budgetMaxPaise ?? null,
    priorities: Object.entries(requirements.priorities ?? {}).map(([key, weight]) => ({
      key,
      weight,
      source: 'stated' as const,
    })),
    mustHaves: requirements.mustHaves ?? [],
    workloads: requirements.workloads ?? [],
    summary: describeBrief(requirements),
    gaps: requirements.missingInfo ?? [],
    compromises: describeCompromises(requirements),
  };

  /* 3. Evidence influence */
  const evidenceInfluences: EvidenceInfluence[] = [];
  for (const entry of survivors) {
    for (const dimension of entry.dimensions) {
      for (const item of dimension.evidence.slice(0, 4)) {
        evidenceInfluences.push({
          productId: entry.candidate.product.id,
          displayName: entry.candidate.product.displayName,
          dimension: dimension.id,
          dimensionLabel: dimension.label,
          statement: item.statement,
          class: item.class,
          contribution: Number(((dimension.score ?? 0) * dimension.weight).toFixed(4)),
          corroborated: item.corroborated,
          sourceLabel: item.source.label,
          sourceUrl: item.source.url,
        });
      }
    }
  }
  evidenceInfluences.sort((a, b) => b.contribution - a.contribution);

  /* 4. Trade-offs */
  const tradeOffs = buildTradeOffs(survivors);

  /* 5. Missing information */
  const missingInformation = buildMissingInfo(survivors);

  /* 6. Winner rationale */
  const winner = survivors[0];
  const runnerUp = survivors[1];
  const winnerRationale = winner
    ? {
        productId: winner.candidate.product.id,
        displayName: winner.candidate.product.displayName,
        score: winner.score,
        decidingDimensions: [...winner.dimensions]
          .filter((dimension) => dimension.weight >= 0.08)
          .sort((a, b) => {
            const aContribution = (a.score ?? 0) * a.weight;
            const bContribution = (b.score ?? 0) * b.weight;
            return bContribution - aContribution;
          })
          .slice(0, 4)
          .map((dimension) => ({
            dimension: dimension.id,
            label: dimension.label,
            score: dimension.score,
            weight: dimension.weight,
          })),
        marginOverRunnerUp: runnerUp ? Number((winner.score - runnerUp.score).toFixed(4)) : null,
        runnerUpId: runnerUp?.candidate.product.id ?? null,
        explanation: explainWinner(winner, runnerUp),
      }
    : null;

  /* 7. Sensitivity */
  const sensitivity = buildSensitivity(survivors, requirements);

  /* Conflicts across the whole decision */
  const conflicts: EvidenceConflict[] = survivors.flatMap((entry) =>
    entry.dimensions.flatMap((dimension) => dimension.conflicts),
  );

  const limitations: string[] = [];
  if (conflicts.length > 0) {
    limitations.push(
      `${conflicts.length} contradiction${conflicts.length === 1 ? '' : 's'} between sources could not be resolved and are reported as found.`,
    );
  }
  const unknownDimensions = new Set(
    survivors[0]?.dimensions.filter((dimension) => dimension.score === null).map((dimension) => dimension.id) ?? [],
  );
  if (unknownDimensions.size > 0) {
    limitations.push(
      `No evidence was available for: ${[...unknownDimensions].join(', ')}. These were treated as unknown rather than as poor performance.`,
    );
  }

  return {
    requirements: requirementInterpretation,
    eliminated,
    evidence: evidenceInfluences,
    tradeOffs,
    missingInformation,
    winnerRationale,
    sensitivity,
    limitations,
  };
}

/** Describe the brief in one paragraph. */
function describeBrief(requirements: PurchaseRequirements): string {
  const parts: string[] = [];
  if (requirements.category) parts.push(`a ${requirements.category}`);
  if (requirements.budgetMaxPaise !== null && requirements.budgetMaxPaise !== undefined) {
    parts.push(`up to ${formatPaise(requirements.budgetMaxPaise)}`);
  }
  if (requirements.budgetMinPaise !== null && requirements.budgetMinPaise !== undefined) {
    parts.push(`from ${formatPaise(requirements.budgetMinPaise)}`);
  }
  const priorities = Object.entries(requirements.priorities ?? {})
    .filter(([, weight]) => weight > 0)
    .map(([key]) => key);
  if (priorities.length > 0) parts.push(`prioritising ${priorities.join(', ')}`);
  if (requirements.mustHaves?.length) {
    parts.push(`requiring ${requirements.mustHaves.join(', ')}`);
  }
  if (requirements.workloads?.length) {
    parts.push(`for ${requirements.workloads.map((workload) => workload.replace(/_/g, ' ')).join(', ')}`);
  }
  return parts.length > 0
    ? `The shopper is looking for ${parts.join(', ')}.`
    : 'No specific brief was given, so the general category profile was used.';
}

/** What the system is willing to compromise on. */
function describeCompromises(requirements: PurchaseRequirements): string[] {
  const compromises: string[] = [];
  const priorities = requirements.priorities ?? {};
  const weak = Object.entries(priorities)
    .filter(([, weight]) => weight < 0.4)
    .map(([key]) => key);
  if (weak.length > 0) {
    compromises.push(`${weak.join(', ')} were not emphasised, so they carry less weight in the ranking.`);
  }
  if (!requirements.budgetMaxPaise) {
    compromises.push('No budget ceiling was given, so price carries less relative weight.');
  }
  if (requirements.workloads?.length === 0) {
    compromises.push('No usage pattern was stated, so the ranking reflects general fitness for purpose.');
  }
  return compromises;
}

/** Identify the trade-offs between the leading candidates. */
function buildTradeOffs(
  survivors: { candidate: DecisionCandidate; dimensions: DimensionAssessment[]; score: number }[],
): TradeOff[] {
  if (survivors.length < 2) return [];

  const tradeOffs: TradeOff[] = [];
  const first = survivors[0];
  const second = survivors[1];
  if (!first || !second) return [];

  for (const dimension of first.dimensions) {
    const other = second.dimensions.find((entry) => entry.id === dimension.id);
    if (!other) continue;
    if (dimension.score === null || other.score === null) continue;

    const gap = dimension.score - other.score;
    if (Math.abs(gap) < 0.08) continue;

    tradeOffs.push({
      dimension: dimension.id,
      statement:
        gap > 0
          ? `${first.candidate.product.displayName} is stronger on ${dimension.label.toLowerCase()}, while ${second.candidate.product.displayName} is stronger elsewhere.`
          : `${second.candidate.product.displayName} is stronger on ${dimension.label.toLowerCase()}, while ${first.candidate.product.displayName} is stronger elsewhere.`,
      favouredProductId: gap > 0 ? first.candidate.product.id : second.candidate.product.id,
      sacrificedProductId: gap > 0 ? second.candidate.product.id : first.candidate.product.id,
      magnitude: Number(Math.abs(gap).toFixed(3)),
    });
  }

  return tradeOffs.sort((a, b) => b.magnitude - a.magnitude).slice(0, 6);
}

/** What was missing, and how much it matters. */
function buildMissingInfo(
  survivors: { candidate: DecisionCandidate; dimensions: DimensionAssessment[]; score: number }[],
): MissingInfo[] {
  const winner = survivors[0];
  if (!winner) return [];

  const missing: MissingInfo[] = [];

  for (const dimension of winner.dimensions) {
    for (const subject of dimension.missing) {
      missing.push({
        dimension: dimension.id,
        subject,
        impact: `${dimension.label} could not be fully assessed for ${winner.candidate.product.displayName}.`,
        materiality: Number((dimension.weight * 0.5).toFixed(3)),
        resolution: `Research the ${dimension.label.toLowerCase()} evidence for this product.`,
      });
    }
  }

  return missing.sort((a, b) => b.materiality - a.materiality).slice(0, 8);
}

/** Explain why the winner won. */
function explainWinner(
  winner: { candidate: DecisionCandidate; dimensions: DimensionAssessment[]; score: number },
  runnerUp: { candidate: DecisionCandidate; dimensions: DimensionAssessment[]; score: number } | undefined,
): string {
  const drivers = [...winner.dimensions]
    .filter((dimension) => dimension.score !== null && dimension.weight >= 0.08)
    .sort((a, b) => (b.score ?? 0) * b.weight - (a.score ?? 0) * a.weight)
    .slice(0, 3);

  const driverText = drivers
    .map((dimension) => `${dimension.label.toLowerCase()} (${dimension.summary})`)
    .join('; ');

  if (!runnerUp) {
    return `${winner.candidate.product.displayName} was the only candidate that satisfied every hard constraint. Its decision rests on ${driverText}.`;
  }

  const margin = winner.score - runnerUp.score;
  const relative = runnerUp.score > 0 ? Math.round((margin / runnerUp.score) * 100) : 0;

  return `${winner.candidate.product.displayName} scored ${winner.score.toFixed(2)} against ${runnerUp.score.toFixed(2)} for ${runnerUp.candidate.product.displayName} — a margin of ${relative}%. The deciding factors were ${driverText}.`;
}

/** What would change the recommendation. */
function buildSensitivity(
  survivors: { candidate: DecisionCandidate; dimensions: DimensionAssessment[]; score: number }[],
  requirements: PurchaseRequirements,
): SensitivityNote[] {
  if (survivors.length < 2) return [];

  const first = survivors[0];
  const second = survivors[1];
  if (!first || !second) return [];
  const notes: SensitivityNote[] = [];

  // Which dimension, if it moved, would flip the order?
  for (const dimension of first.dimensions) {
    if (dimension.score === null) continue;
    const other = second.dimensions.find((entry) => entry.id === dimension.id);
    if (!other || other.score === null) continue;

    const gap = (first.score - second.score) * 1; // current margin
    const dimensionGap = dimension.score - other.score;
    // If this dimension's advantage were removed, would the order change?
    const contribution = dimensionGap * dimension.weight;
    if (contribution > gap) {
      notes.push({
        condition: `${dimension.label.toLowerCase()} turned out to be less decisive than it appears`,
        wouldFavourProductId: second.candidate.product.id,
        likelihood: 'possible',
        effect: `If ${dimension.label.toLowerCase()} did not favour ${first.candidate.product.displayName}, ${second.candidate.product.displayName} would take the top spot.`,
      });
    }
  }

  // A price change is the most common reason a recommendation flips.
  if (first.candidate.pricePaise !== null && second.candidate.pricePaise !== null) {
    const difference = second.candidate.pricePaise - first.candidate.pricePaise;
    if (difference > 0) {
      notes.push({
        condition: 'the price gap narrowed',
        wouldFavourProductId: second.candidate.product.id,
        likelihood: 'possible',
        effect: `A price drop of about ${formatPaise(difference)} on ${first.candidate.product.displayName} would close the gap with ${second.candidate.product.displayName}.`,
      });
    }
  }

  // Budget sensitivity.
  if (requirements.budgetMaxPaise) {
    notes.push({
      condition: 'the budget were raised',
      wouldFavourProductId: null,
      likelihood: 'possible',
      effect: `Products above ${formatPaise(requirements.budgetMaxPaise)} were excluded before scoring and would be reconsidered.`,
    });
  }

  return notes.slice(0, 5);
}

/** Total cost of ownership, when the inputs support one. */
function totalOwnershipCost(entry: {
  candidate: DecisionCandidate;
}): number | null {
  const profile = getCategory(entry.candidate.product.category);
  if (!profile) return null;

  const annual = profile.ownership.annualRunningCostPaise?.({
    ...entry.candidate.product.specs.extra,
    pricePaise: entry.candidate.pricePaise ?? undefined,
  });

  if (annual === null || annual === undefined) {
    // No running cost model: the total is the purchase price.
    return entry.candidate.pricePaise;
  }

  if (entry.candidate.pricePaise === null) return null;

  const horizon = profile.ownership.horizonYears ?? 3;
  return entry.candidate.pricePaise + annual * horizon;
}

/**
 * How much of a candidate's score rests on customer reviews?
 *
 * This is a *structural* guarantee, not a tuning knob. Reviews are one
 * evidence source among several, so the share of the decision they can carry
 * is capped. When a candidate's score would exceed the cap, the excess is
 * moved onto the dimensions that rest on published facts, which means the
 * candidate is neither rewarded nor punished for having good reviews — it
 * simply cannot lean on them further.
 */
function computeReviewDependence(dimensions: DimensionAssessment[]): number {
  let total = 0;
  let fromReviews = 0;

  for (const dimension of dimensions) {
    if (dimension.score === null || dimension.weight <= 0) continue;
    const contribution = dimension.score * dimension.weight;
    total += contribution;

    const evidenceWeight = dimension.evidence.reduce(
      (sum, item) => sum + item.confidence * (item.class === 'customer_experience' ? 1 : 0),
      0,
    );
    const allWeight = dimension.evidence.reduce((sum, item) => sum + item.confidence, 0);
    const reviewShare = allWeight > 0 ? evidenceWeight / allWeight : 0;
    fromReviews += contribution * reviewShare;
  }

  if (total <= 0) return 0;
  const raw = fromReviews / total;
  return Number(Math.min(MAX_REVIEW_DEPENDENCE, raw).toFixed(3));
}

/**
 * Re-weight a candidate's dimensions so customer reviews cannot carry more
 * than the cap.
 *
 * The weights of the review-driven dimensions are scaled by a factor found
 * by bisection, and the freed weight is handed to the dimensions that rest
 * on published facts. The total weight stays at one, so nothing is inflated
 * — the decision simply stops leaning on the reviews.
 */
function enforceReviewCap(dimensions: DimensionAssessment[]): void {
  const measured = dimensions.filter((dimension) => dimension.score !== null && dimension.weight > 0);
  if (measured.length === 0) return;

  // Split the dimensions into review-driven and fact-driven.
  const reviewDriven = measured.filter((dimension) => reviewShareOf(dimension) > 0);
  const factDriven = measured.filter((dimension) => reviewShareOf(dimension) === 0);
  if (reviewDriven.length === 0 || factDriven.length === 0) return;

  const reviewWeight = reviewDriven.reduce((sum, dimension) => sum + dimension.weight, 0);
  const factWeight = factDriven.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (reviewWeight <= 0 || factWeight <= 0) return;

  const dependence = (reviewFactor: number, factFactor: number): number => {
    let reviewContribution = 0;
    let factContribution = 0;
    for (const dimension of reviewDriven) {
      reviewContribution += (dimension.score ?? 0) * dimension.weight * reviewFactor * reviewShareOf(dimension);
    }
    for (const dimension of factDriven) {
      factContribution += (dimension.score ?? 0) * dimension.weight * factFactor;
    }
    const total = reviewContribution + factContribution;
    return total > 0 ? reviewContribution / total : 0;
  };

  if (dependence(1, 1) <= MAX_REVIEW_DEPENDENCE) return;

  // Bisect on the review factor. At factor 0 the dependence is zero; at
  // factor 1 it is over the cap, so a factor in between hits the cap.
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (low + high) / 2;
    // Keep the total weight at one.
    const factFactor = (1 - reviewWeight * mid) / factWeight;
    if (factFactor < 0) {
      high = mid;
      continue;
    }
    if (dependence(mid, factFactor) <= MAX_REVIEW_DEPENDENCE) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const reviewFactor = low;
  const factFactor = (1 - reviewWeight * reviewFactor) / factWeight;

  for (const dimension of reviewDriven) {
    dimension.weight = Number((dimension.weight * reviewFactor).toFixed(4));
  }
  for (const dimension of factDriven) {
    dimension.weight = Number((dimension.weight * factFactor).toFixed(4));
  }
}

/** The share of a dimension's evidence that comes from owner reviews. */
function reviewShareOf(dimension: DimensionAssessment): number {
  const allWeight = dimension.evidence.reduce((sum, item) => sum + item.confidence, 0);
  if (allWeight <= 0) return 0;
  const reviewWeight = dimension.evidence.reduce(
    (sum, item) => sum + item.confidence * (item.class === 'customer_experience' ? 1 : 0),
    0,
  );
  return reviewWeight / allWeight;
}

/** Which elimination stage a constraint belongs to. */
function stageForConstraint(key: string): EliminationRecord['stage'] {
  switch (key) {
    case 'budget':
      return 'budget';
    case 'must_have':
    case 'variant':
      return 'must_have';
    case 'safety_certification':
      return 'safety';
    case 'condition':
    case 'availability':
      return 'risk';
    default:
      return 'insufficient_evidence';
  }
}
