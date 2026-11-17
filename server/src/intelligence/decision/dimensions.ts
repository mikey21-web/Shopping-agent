/**
 * The eight intelligence dimensions.
 *
 * Each dimension answers one question about a candidate, using the evidence
 * gathered for it. A dimension that has no evidence returns `score: null` —
 * *unknown*, never zero — and records what it would need to know.
 *
 * The dimensions deliberately overlap in the evidence they read: a warranty
 * length is an objective fact, but it is also ownership intelligence. The
 * dimension decides *what the fact means for the decision*, and the evidence
 * keeps its own class so the engine can weigh it correctly.
 *
 * All arithmetic is deterministic and integer/float paise where money is
 * involved. No model is asked to produce a number.
 */

import type {
  PriceBreakdown,
  Product,
  PurchaseRequirements,
  ReviewIntelligence,
} from '../../domain/types.ts';
import { formatPaise } from '../normalize/specs.ts';
import { getCategory } from '../categories/index.ts';
import type { ComponentDefinition, ComponentResult, ScoreInput } from '../categories/types.ts';
import type {
  DecisionEvidence,
  DimensionAssessment,
  EvidenceClass,
  IntelligenceDimensionId,
} from './types.ts';
import { EVIDENCE_CLASS_WEIGHT, confidenceBand } from './types.ts';
import { dimensionForFactKind } from './evidence.ts';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * How strong the evidence behind a dimension is.
 *
 * This is a *quality* measure — how trustworthy and how fresh the evidence
 * is — not a measure of how good the product is. A dimension's score comes
 * from comparing the product against the brief and against the alternatives;
 * the evidence quality only sets the confidence band.
 */
export function evidenceStrength(evidence: DecisionEvidence[]): number | null {
  if (evidence.length === 0) return null;

  let total = 0;
  for (const item of evidence) {
    const classWeight = EVIDENCE_CLASS_WEIGHT[item.class] ?? 0.5;
    // Expired evidence contributes less but is not discarded: the user is
    // better served by "this was true three weeks ago" than by silence.
    const freshnessFactor =
      item.freshness === 'fresh'
        ? 1
        : item.freshness === 'stale'
          ? 0.6
          : item.freshness === 'expired'
            ? 0.25
            : 0.8;
    total += classWeight * item.confidence * freshnessFactor;
  }

  return Number(Math.min(1, total).toFixed(3));
}

/**
 * The reference ranges for a comparable numeric field, taken from the
 * candidate set.
 *
 * "Capability" only means something relative to the alternatives. A 16 GB
 * laptop is not better than an 8 GB one in the abstract — it is better than
 * the other laptops in this comparison, and that is what we measure.
 */
export interface FieldRange {
  min: number;
  max: number;
  /** True when every candidate has the same value, so the field cannot rank. */
  flat: boolean;
}

/** Build the reference ranges from the candidates. */
export function buildFieldRanges(
  candidates: { product: Product }[],
  fields: { key: string; read: (product: Product) => number | null }[],
): Record<string, FieldRange> {
  const ranges: Record<string, FieldRange> = {};

  for (const field of fields) {
    const values = candidates
      .map((candidate) => field.read(candidate.product))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (values.length < 2) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    ranges[field.key] = { min, max, flat: max === min };
  }

  return ranges;
}

/**
 * Where a product sits within the candidate set for each comparable field.
 *
 * Returns null when the product cannot be placed, and the overall score is
 * the mean of the placements across the fields that could differentiate.
 */
export function relativeCapability(
  product: Product,
  fields: { key: string; read: (product: Product) => number | null }[],
  ranges: Record<string, FieldRange>,
): { score: number | null; placed: string[]; unplaced: string[] } {
  const placed: string[] = [];
  const unplaced: string[] = [];
  let total = 0;

  for (const field of fields) {
    const range = ranges[field.key];
    if (!range || range.flat) {
      unplaced.push(field.key);
      continue;
    }
    const value = field.read(product);
    if (value === null || !Number.isFinite(value)) {
      unplaced.push(field.key);
      continue;
    }
    const position = (value - range.min) / (range.max - range.min);
    total += Math.max(0, Math.min(1, position));
    placed.push(field.key);
  }

  if (placed.length === 0) return { score: null, placed, unplaced };
  return { score: Number((total / placed.length).toFixed(3)), placed, unplaced };
}

/** The most useful statement from a set of evidence, for a summary. */
function leadStatement(evidence: DecisionEvidence[]): string | null {
  if (evidence.length === 0) return null;
  const best = [...evidence].sort(
    (a, b) =>
      (EVIDENCE_CLASS_WEIGHT[b.class] ?? 0) * b.confidence -
      (EVIDENCE_CLASS_WEIGHT[a.class] ?? 0) * a.confidence,
  )[0];
  return best?.statement ?? null;
}

/** The facts that disagree, grouped by subject. */
export function findConflicts(
  evidence: DecisionEvidence[],
  dimension: IntelligenceDimensionId,
): DimensionAssessment['conflicts'] {
  const disputed = evidence.filter((item) => item.disputed);
  if (disputed.length === 0) return [];

  const grouped = new Map<string, DecisionEvidence[]>();
  for (const item of disputed) {
    const subject = item.statement.split(':')[0]?.trim() ?? item.statement;
    const list = grouped.get(subject) ?? [];
    list.push(item);
    grouped.set(subject, list);
  }

  return [...grouped.entries()].map(([subject, items]) => ({
    dimension,
    subject,
    positions: items.map((item) => ({
      statement: item.statement,
      value: item.value ?? null,
      sourceLabel: item.source.label,
      sourceUrl: item.source.url,
      class: item.class,
      observedAt: item.observedAt,
    })),
    explanation: `Sources disagree about ${subject}. The conflict is reported rather than resolved by guessing.`,
    resolution: 'unresolved' as const,
  }));
}

/* ------------------------------------------------------------------ */
/* 1. Requirement intelligence                                          */
/* ------------------------------------------------------------------ */

/**
 * How well does the candidate actually meet what was asked for?
 *
 * This dimension is about *fit to the brief*, not about quality in the
 * abstract. A phone that is excellent but has the wrong storage size does
 * not meet the brief.
 */
export function assessRequirement(
  product: Product,
  requirements: PurchaseRequirements,
  evidence: DecisionEvidence[],
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'requirement');

  const missing: string[] = [];
  let satisfied = 0;
  let checked = 0;

  // Workloads: does the product meet the stated use?
  for (const workload of requirements.workloads ?? []) {
    const met = meetsWorkload(product, workload);
    // An unknown result is not a failure. It is recorded as a gap and left
    // out of the denominator, because a product must not be marked down for
    // something nobody measured.
    if (met === null) {
      missing.push(`Whether this suits ${workload.replace(/_/g, ' ')}`);
      continue;
    }
    checked += 1;
    if (met) satisfied += 1;
  }

  // Priorities: are the aspects the user cares about actually present?
  for (const [priority, strength] of Object.entries(requirements.priorities ?? {})) {
    if (strength <= 0.4) continue;
    const covered = coversPriority(product, priority);
    if (covered === null) {
      missing.push(`How this performs on ${priority}`);
      continue;
    }
    checked += 1;
    if (covered) satisfied += 1;
  }

  // The score is the share of *checkable* requirements that are met. It is
  // null when nothing could be checked at all.
  const score = checked > 0 ? Number((satisfied / checked).toFixed(3)) : null;

  const summary =
    score === null
      ? 'Nothing specific was requested that could be checked against this product.'
      : `${satisfied} of ${checked} checkable priorities and workloads are met.`;

  return {
    id: 'requirement',
    label: 'Requirement fit',
    score,
    weight: 0,
    hasEvidence: own.length > 0 || checked > 0,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'requirement'),
    summary,
    confidence: confidenceBand(score),
  };
}

/** Does the product meet a stated workload? null when it cannot be told. */
function meetsWorkload(product: Product, workload: string): boolean | null {
  const specs = product.specs;
  switch (workload) {
    case 'programming':
    case 'local_ai':
    case 'video_editing':
    case 'gaming': {
      // A discrete GPU with its own VRAM is what these need. An integrated
      // GPU cannot be assumed either way, so it stays unknown.
      const gpu = String(specs.extra.GPU ?? '').toLowerCase();
      const vram = numberOrNull(specs.extra.VRAM ?? specs.extra.Vram ?? specs.extra['VRAM']);
      if (vram !== null && gpu) return vram >= 4;
      return null;
    }
    case 'travel':
      return specs.batteryMah ? specs.batteryMah >= 4000 : null;
    case 'office':
    case 'study':
      return specs.ramGb ? specs.ramGb >= 8 : null;
    case 'photography':
      return specs.cameraMainMp ? specs.cameraMainMp >= 12 : null;
    case 'calls':
    case 'communication':
      return specs.network ? specs.network === '5G' : null;
    case 'fitness':
      return specs.batteryMah ? specs.batteryMah >= 3000 : null;
    default:
      return null;
  }
}

/** Does the product visibly cover a priority area? null when it cannot be told. */
function coversPriority(product: Product, priority: string): boolean | null {
  const specs = product.specs;
  switch (priority.toLowerCase()) {
    case 'battery':
      return specs.batteryMah !== undefined ? specs.batteryMah >= 4000 : null;
    case 'camera':
      return specs.cameraMainMp !== undefined ? specs.cameraMainMp >= 50 : null;
    case 'display':
      return specs.displaySizeIn !== undefined ? specs.displaySizeIn >= 6 : null;
    case 'performance':
      return specs.soc !== undefined ? true : null;
    case 'running_cost':
    case 'electricity':
      return specs.extra.powerWatts !== undefined ? true : null;
    case 'durability':
    case 'reliability':
      return specs.warrantyMonths !== undefined ? specs.warrantyMonths >= 12 : null;
    case 'capacity':
      return specs.extra.capacityKg !== undefined ? true : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. Product intelligence                                             */
/* ------------------------------------------------------------------ */

/**
 * The numeric fields that can differentiate a product within its category.
 *
 * These are the fields where "more" is plausibly "better" and where the
 * shopper would expect a difference to matter. Colour and weight are not
 * here: more colour is not better, and a heavier phone is not better.
 */
export const COMPARABLE_FIELDS: {
  key: string;
  read: (product: Product) => number | null;
}[] = [
  { key: 'ramGb', read: (product) => product.specs.ramGb ?? null },
  { key: 'storageGb', read: (product) => product.specs.storageGb ?? null },
  { key: 'cpuCores', read: (product) => product.specs.cpuCores ?? null },
  { key: 'displaySizeIn', read: (product) => product.specs.displaySizeIn ?? null },
  { key: 'refreshHz', read: (product) => numberOrNull(product.specs.extra.RefreshRate ?? product.specs.extra['Refresh Rate']) },
  { key: 'batteryMah', read: (product) => product.specs.batteryMah ?? null },
  { key: 'cameraMainMp', read: (product) => product.specs.cameraMainMp ?? null },
  { key: 'rearCameraCount', read: (product) => product.specs.rearCameraCount ?? null },
  { key: 'warrantyMonths', read: (product) => product.specs.warrantyMonths ?? null },
  { key: 'vramGb', read: (product) => numberOrNull(product.specs.extra.VRAM ?? product.specs.extra.Vram) },
  { key: 'capacityKg', read: (product) => numberOrNull(product.specs.extra.capacityKg ?? product.specs.extra.Capacity) },
  { key: 'packSizeKg', read: (product) => numberOrNull(product.specs.extra.packSize ?? product.specs.extra['Pack Size']) },
  { key: 'powerWatts', read: (product) => numberOrNull(product.specs.extra.powerWatts ?? product.specs.extra['Power Consumption']) },
];

/** Read a number out of a spec value that may carry a unit. */
export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How capable is the product, measured against the alternatives?
 *
 * "Capability" is relative: a laptop with more memory is more capable than
 * the other laptops in this comparison, not in the abstract. The score is the
 * mean position across the comparable fields, and fields where every
 * candidate is identical are ignored because they cannot rank anything.
 */
export function assessProduct(
  product: Product,
  evidence: DecisionEvidence[],
  ranges: Record<string, FieldRange>,
  context?: {
    /** The category's own scoring model, when it has one. */
    components?: ComponentDefinition[];
    /** The buyer's requirements. */
    requirements?: PurchaseRequirements;
    /** The price this product costs the buyer, in paise. */
    pricePaise?: number | null;
    /** The median price of the candidate set, in paise. */
    referencePricePaise?: number | null;
    /** The product's own review intelligence. */
    reviews?: ReviewIntelligence | null;
  },
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'product');

  const facts = own.filter((item) => item.class === 'objective_fact');
  const claims = own.filter((item) => item.class === 'manufacturer_claim');
  const tests = own.filter((item) => item.class === 'independent_test');

  // A category with its own scoring model is judged by it. This is what
  // makes the framework universal: a shoe is judged on fit, cushioning
  // and sole wear, and a laptop on processor, memory and display, without
  // the engine knowing which is which.
  if (context?.components && context.components.length > 0) {
    return assessProductByComponents(product, own, facts, {
      ...context,
      components: context.components,
    });
  }

  const capability = relativeCapability(product, COMPARABLE_FIELDS, ranges);

  const missing: string[] = [];
  if (capability.placed.length === 0) {
    missing.push(
      'No specification distinguishes this product from the alternatives, so its capability could not be placed.',
    );
  }
  if (facts.length < 4) missing.push('Published specifications are incomplete for this product.');
  if (tests.length === 0) missing.push('No independent test results were found.');

  // The score is the relative capability, damped when the evidence behind it
  // is thin. A capability figure built on four specifications is less
  // trustworthy than one built on twelve.
  const strength = evidenceStrength(own);
  const coverage = Math.min(1, facts.length / 8);
  const damping = 0.75 + coverage * 0.25;
  const score =
    capability.score === null ? null : Number((capability.score * damping).toFixed(3));

  const summary =
    capability.score === null
      ? own.length === 0
        ? 'No specification evidence is available for this product.'
        : `${facts.length} published specification${facts.length === 1 ? '' : 's'} are available, but none distinguishes this product from the alternatives.`
      : `Places above ${Math.round(capability.score * 100)}% of the alternatives on ${capability.placed.length} comparable specification${capability.placed.length === 1 ? '' : 's'}.`;

  void claims;
  void tests;

  return {
    id: 'product',
    label: 'Product capability',
    score,
    weight: 0,
    hasEvidence: own.length > 0 || capability.score !== null,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'product'),
    summary,
    confidence: confidenceBand(
      score === null ? null : score * (strength === null ? 0.6 : Math.min(1, 0.5 + strength)),
    ),
  };
}

/**
 * Score a product with the category's own components.
 *
 * Each component returns a score and the evidence behind it. The product
 * dimension is the weighted average of the components, and the summary
 * names the components that decided it.
 */
function assessProductByComponents(
  product: Product,
  own: DecisionEvidence[],
  facts: DecisionEvidence[],
  context: {
    components: ComponentDefinition[];
    requirements?: PurchaseRequirements;
    pricePaise?: number | null;
    referencePricePaise?: number | null;
    reviews?: ReviewIntelligence | null;
  },
): DimensionAssessment {
  const input: ScoreInput = {
    specs: product.specs,
    reviews: context.reviews ?? null,
    pricePaise: context.pricePaise ?? null,
    referencePricePaise: context.referencePricePaise ?? null,
    requirements: context.requirements ?? {
      category: product.category,
      priorities: {},
      mustHaves: [],
      niceToHaves: [],
      workloads: [],
      missingInfo: [],
    },
    category: getCategory(product.category),
  };

  let weighted = 0;
  let appliedWeight = 0;
  const summaries: string[] = [];
  const missing: string[] = [];

  for (const component of context.components) {
    let result: ComponentResult;
    try {
      result = component.compute(input);
    } catch {
      missing.push(`${component.label} could not be assessed.`);
      continue;
    }

    const weight = component.baseWeight;
    weighted += result.score * weight;
    appliedWeight += weight;

    if (result.evidence.length > 0) {
      summaries.push(`${component.label}: ${result.evidence.join('; ')}`);
    } else {
      missing.push(`No evidence was available for ${component.label.toLowerCase()}.`);
    }
  }

  const score =
    appliedWeight > 0 ? Number((weighted / appliedWeight).toFixed(3)) : null;

  // The component evidence becomes the dimension's evidence, so the trace
  // shows the shopper *why* the product scored as it did.
  const componentEvidence: DecisionEvidence[] = [];
  for (const component of context.components) {
    let result: ComponentResult;
    try {
      result = component.compute(input);
    } catch {
      continue;
    }
    for (const line of result.evidence) {
      componentEvidence.push({
        id: `component:${component.key}:${componentEvidence.length}`,
        dimension: 'product',
        class: 'customer_experience',
        statement: `${component.label}: ${line}`,
        source: {
          label: 'Owner reports and published specifications',
          url: null,
          domain: null,
          origin: 'derived',
        },
        observedAt: null,
        freshness: 'fresh',
        confidence: 0.7,
        corroborated: false,
        disputed: false,
        excerpt: line,
      });
    }
  }

  const summary =
    score === null
      ? 'This category has no scoring model available for this product.'
      : summaries.length > 0
        ? summaries.slice(0, 3).join('. ') + '.'
        : `Scored ${Math.round(score * 100)}% on the ${context.components.length} criteria this category judges on.`;

  void facts;

  return {
    id: 'product',
    label: 'Product capability',
    score,
    weight: 0,
    hasEvidence: componentEvidence.length > 0 || own.length > 0,
    evidence: componentEvidence.length > 0 ? componentEvidence : own,
    missing,
    conflicts: findConflicts(own, 'product'),
    summary,
    confidence: confidenceBand(score),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Ownership intelligence                                           */
/* ------------------------------------------------------------------ */

/**
 * How will this hold up over years, and what will it cost to keep?
 *
 * Ownership is judged on two things: the warranty, which is a published
 * fact about support, and what owners actually report. Owner reports are
 * real evidence but they are one source, so they are combined with — never
 * substituted for — the objective facts.
 */
export function assessOwnership(
  product: Product,
  reviews: ReviewIntelligence | null,
  evidence: DecisionEvidence[],
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'ownership');

  const warrantyMonths = product.specs.warrantyMonths;
  const missing: string[] = [];

  if (warrantyMonths === undefined) missing.push('The warranty period is not published.');

  const experiences = own.filter((item) => item.class === 'customer_experience');
  const facts = own.filter((item) => item.class === 'objective_fact');

  // The experience component: the share of owner reports that are positive,
  // tempered by the aspect sentiment. A product with half its reviews
  // negative is not a good long-term bet however friendly the summary is.
  let experienceScore: number | null = null;
  if (reviews && reviews.reviewCount >= 5) {
    const negativeShare = Math.max(0, Math.min(1, reviews.negativeShare));
    const aspectSentiment =
      reviews.aspects.length > 0
        ? reviews.aspects.reduce((sum, aspect) => sum + aspect.sentiment, 0) / reviews.aspects.length
        : 0;
    // 0 when every review is negative, 1 when every review is positive.
    experienceScore = Number(
      Math.max(0, Math.min(1, (1 - negativeShare) * 0.6 + ((aspectSentiment + 1) / 2) * 0.4)).toFixed(3),
    );
  }

  if (experienceScore === null) {
    missing.push('No owner experience is available, so long-term reliability is unknown.');
  }

  // The warranty component.
  const warrantyScore = warrantyMonths === undefined ? null : Math.min(1, warrantyMonths / 36);

  const parts: { score: number; weight: number }[] = [];
  if (experienceScore !== null) parts.push({ score: experienceScore, weight: 0.7 });
  if (warrantyScore !== null) parts.push({ score: warrantyScore, weight: 0.3 });

  const score =
    parts.length === 0
      ? null
      : Number(
          (
            parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
            (parts.reduce((sum, part) => sum + part.weight, 0) || 1)
          ).toFixed(3),
        );

  const summary =
    score === null
      ? 'Long-term reliability is unknown — no owner experience and no published warranty.'
      : warrantyMonths !== undefined
        ? `Warranty is ${warrantyMonths} months, with ${experiences.length} reported owner experience${experiences.length === 1 ? '' : 's'}.`
        : `Based on ${experiences.length} reported owner experience${experiences.length === 1 ? '' : 's'}.`;

  void facts;

  return {
    id: 'ownership',
    label: 'Ownership & longevity',
    score,
    weight: 0,
    hasEvidence: own.length > 0,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'ownership'),
    summary,
    confidence: confidenceBand(
      score === null ? null : score * (reviews && reviews.reviewCount >= 20 ? 1 : 0.7),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Financial intelligence                                           */
/* ------------------------------------------------------------------ */

/**
 * What does it actually cost to own?
 *
 * The payable price is one part. Running cost, consumables and the cost of
 * a replacement over the ownership horizon are the others, and they are
 * where appliances, vehicles and consumables differ from electronics.
 */
export function assessFinancial(
  product: Product,
  requirements: PurchaseRequirements,
  breakdown: PriceBreakdown | null,
  referencePricePaise: number | null,
  evidence: DecisionEvidence[],
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'financial');
  const missing: string[] = [];

  if (!breakdown) {
    missing.push('No confirmed retailer price is available, so the financial picture is incomplete.');
  }

  const profile = getCategory(product.category);
  const annualRunningCostPaise =
    profile?.ownership.annualRunningCostPaise?.({
      ...product.specs.extra,
      pricePaise: breakdown?.payablePaise ?? undefined,
    }) ?? null;

  // Value against the candidate set, when a reference price exists.
  let valueScore: number | null = null;
  if (breakdown && referencePricePaise && referencePricePaise > 0) {
    // A product at half the reference price scores 1; at double, scores 0.
    const ratio = breakdown.payablePaise / referencePricePaise;
    valueScore = Number(Math.max(0, Math.min(1, 1 - (ratio - 0.5) / 1.5)).toFixed(3));
  }

  // Running cost as a share of the purchase price over the horizon.
  let costScore: number | null = null;
  if (annualRunningCostPaise !== null && breakdown && breakdown.payablePaise > 0) {
    const horizon = profile?.ownership.horizonYears ?? 3;
    const totalRunning = annualRunningCostPaise * horizon;
    const ratio = totalRunning / breakdown.payablePaise;
    // A running cost equal to the purchase price over the horizon scores 0.5.
    costScore = Number(Math.max(0, Math.min(1, 1 - ratio / 2)).toFixed(3));
  }

  const parts: { score: number; weight: number }[] = [];
  if (valueScore !== null) parts.push({ score: valueScore, weight: 0.7 });
  if (costScore !== null) parts.push({ score: costScore, weight: 0.3 });

  const combined =
    parts.length === 0
      ? null
      : Number(
          (
            parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
            (parts.reduce((sum, part) => sum + part.weight, 0) || 1)
          ).toFixed(3),
        );

  // Also weigh in the direct price evidence (offers, conditional discounts).
  // The evidence itself carries no goodness — "Payable ₹45,990" is a fact,
  // not a score — so it only sets the confidence, not the value.
  const directStrength = evidenceStrength(own);
  const score = combined;

  if (annualRunningCostPaise === null && profile?.ownership.annualRunningCostPaise) {
    missing.push('The running cost could not be estimated from the published specifications.');
  }

  const summary =
    score === null
      ? 'The financial position could not be assessed.'
      : breakdown
        ? `Payable ${formatPaise(breakdown.payablePaise)}${
            annualRunningCostPaise !== null
              ? `, plus about ${formatPaise(annualRunningCostPaise)} a year to run`
              : ''
          }.`
        : 'No confirmed price.';

  void requirements;

  return {
    id: 'financial',
    label: 'Financial position',
    score,
    weight: 0,
    hasEvidence: own.length > 0 || combined !== null,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'financial'),
    summary,
    confidence: confidenceBand(score === null ? null : score * (directStrength ?? 0.7)),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Compatibility intelligence                                       */
/* ------------------------------------------------------------------ */

/**
 * Does it actually fit the user's situation?
 *
 * For electronics this is about the ecosystem and upgradeability; for
 * automotive it is vehicle fitment; for appliances it is installation
 * requirements. The check is deterministic and never guessed.
 */
export function assessCompatibility(
  product: Product,
  evidence: DecisionEvidence[],
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'compatibility');
  const missing: string[] = [];

  const specs = product.specs;
  const extra = specs.extra;

  const checks: { label: string; ok: boolean | null; detail: string }[] = [];

  // Upgradeability: soldered memory is a permanent constraint.
  const upgradeable = extra.RAMSlots ?? extra['Number of RAM Slots'] ?? extra.upgradeable;
  if (upgradeable !== undefined) {
    const count = Number(upgradeable);
    checks.push({
      label: 'Memory upgradeability',
      ok: Number.isFinite(count) ? count > 0 : null,
      detail:
        Number.isFinite(count) && count > 0
          ? `${count} memory slot${count === 1 ? '' : 's'}`
          : 'No accessible memory slots',
    });
  }

  // Vehicle fitment for automotive.
  if (extra.vehicleFitment) {
    checks.push({
      label: 'Vehicle fitment',
      ok: true,
      detail: String(extra.vehicleFitment),
    });
  }

  const known = checks.filter((check) => check.ok !== null);
  if (known.length === 0) {
    missing.push('Compatibility with the shopper\'s own setup has not been established.');
  }

  const passed = known.filter((check) => check.ok === true).length;
  const score = known.length > 0 ? Number((passed / known.length).toFixed(3)) : null;

  const summary =
    score === null
      ? 'Compatibility could not be checked from the available evidence.'
      : known.map((check) => `${check.label}: ${check.detail}`).join('; ');

  return {
    id: 'compatibility',
    label: 'Compatibility',
    score,
    weight: 0,
    hasEvidence: own.length > 0 || known.length > 0,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'compatibility'),
    summary,
    confidence: confidenceBand(score),
  };
}

/* ------------------------------------------------------------------ */
/* 6. Market intelligence                                              */
/* ------------------------------------------------------------------ */

/**
 * Is now a good time to buy?
 */
export function assessMarket(
  priceHistory: {
    observations: number;
    avgPaise: number;
    minPaise: number;
    maxPaise: number;
    latestPaise: number;
    discountVsAvg: number;
  } | null,
  evidence: DecisionEvidence[],
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'market');
  const missing: string[] = [];

  if (!priceHistory || priceHistory.observations < 3) {
    missing.push('There is not enough price history to judge the timing.');
    return {
      id: 'market',
      label: 'Market timing',
      score: null,
      weight: 0,
      hasEvidence: own.length > 0,
      evidence: own,
      missing,
      conflicts: findConflicts(own, 'market'),
      summary: 'Market timing is unknown — there is not enough price history.',
      confidence: 'insufficient',
    };
  }

  // Being at or below the historical average is a good time to buy.
  const discount = priceHistory.discountVsAvg;
  const score = Number(Math.max(0, Math.min(1, 0.5 + discount * 2)).toFixed(3));

  const summary =
    discount > 0.05
      ? `The current price is ${Math.round(discount * 100)}% below the recorded average of ${formatPaise(priceHistory.avgPaise)}.`
      : discount < -0.05
        ? `The current price is ${Math.round(Math.abs(discount) * 100)}% above the recorded average of ${formatPaise(priceHistory.avgPaise)}.`
        : `The current price is close to the recorded average of ${formatPaise(priceHistory.avgPaise)}.`;

  return {
    id: 'market',
    label: 'Market timing',
    score,
    weight: 0,
    hasEvidence: true,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'market'),
    summary,
    confidence: confidenceBand(score),
  };
}

/* ------------------------------------------------------------------ */
/* 7. Risk intelligence                                                 */
/* ------------------------------------------------------------------ */

/**
 * What could go wrong?
 *
 * Risk is scored from *published* risk rules and from evidence quality.
 * Absence of a risk signal is not proof of safety; it is recorded as
 * unknown when the evidence needed to judge is absent.
 */
export function assessRisk(
  product: Product,
  reviews: ReviewIntelligence | null,
  evidence: DecisionEvidence[],
): DimensionAssessment {
  const own = evidence.filter((item) => item.dimension === 'risk');
  const missing: string[] = [];

  const profile = getCategory(product.category);
  const specMap: Record<string, string | number | boolean | undefined> = {
    ...product.specs.extra,
    warrantyMonths: product.specs.warrantyMonths,
  };

  const categoryRisks = profile?.risks ?? [];
  const firedRisks = (categoryRisks)
    .map((rule) => {
      const message = rule.evaluate({
        specs: specMap,
        extra: product.specs.extra,
        reviewComplaints: reviews?.complaints ?? [],
        warrantyMonths: product.specs.warrantyMonths,
      });
      return message ? { rule, message } : null;
    })
    .filter((entry): entry is { rule: (typeof categoryRisks)[number]; message: string } => entry !== null);

  // Risk score: start at 1, subtract the severity of each fired rule.
  let score = 1;
  for (const fired of firedRisks) {
    const severity = fired.rule.severity === 'critical' ? 0.45 : fired.rule.severity === 'warning' ? 0.2 : 0.07;
    score -= severity;
  }

  // Review authenticity risk is itself a risk signal.
  if (reviews && reviews.authenticityRisk > 0.4) {
    score -= 0.1;
    missing.push('The owner reviews carry authenticity signals, so their weight is reduced.');
  }

  // Evidence quality: a decision built on thin evidence is riskier.
  const evidenceCount = own.length;
  if (evidenceCount === 0 && firedRisks.length === 0) {
    missing.push('No risk evidence could be gathered for this product.');
  }

  const finalScore = Number(Math.max(0, Math.min(1, score)).toFixed(3));

  const summary =
    firedRisks.length === 0
      ? 'No category-specific risk rule was triggered, but the evidence for risk is limited.'
      : firedRisks.map((fired) => fired.message).join(' ');

  return {
    id: 'risk',
    label: 'Risk',
    score,
    weight: 0,
    hasEvidence: own.length > 0 || firedRisks.length > 0,
    evidence: own,
    missing,
    conflicts: findConflicts(own, 'risk'),
    summary,
    confidence: confidenceBand(finalScore),
  };
}

export { dimensionForFactKind };
export type { EvidenceClass };
