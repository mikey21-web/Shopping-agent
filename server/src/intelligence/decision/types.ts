/**
 * Decision intelligence: types.
 *
 * The central idea is that a buying decision is made from *evidence of
 * different kinds*, and that evidence must be distinguishable. A phone's
 * 16 GB of RAM is an objective fact. A manufacturer's "18 hours of battery
 * life" is a claim. A review site's measured screen brightness is an
 * independent test. An owner's "it gets hot after an hour" is an experience.
 * Our own inference that the phone is therefore a bad buy under a stated
 * requirement is an inference.
 *
 * Treating these as interchangeable is how recommendation engines end up
 * ranking on star ratings. This module keeps them apart all the way through
 * to the decision trace.
 *
 * Two rules are encoded here and enforced by the engine:
 *
 *  1. **Missing is not negative.** A dimension with no evidence scores
 *     `null`, not zero. A product is not penalised for something nobody
 *     measured — it is reported as unknown.
 *  2. **No fake precision.** Scores are 0..1 ratios computed from evidence
 *     counts, not percentages dressed up as probabilities.
 */

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/**
 * The kind of evidence.
 *
 * The distinction is not academic: a manufacturer's claim and an independent
 * test are not interchangeable, and the engine weights them differently.
 */
export type EvidenceClass =
  /** A measured or published specification: 16 GB, 5-star, 1.2 kg. */
  | 'objective_fact'
  /** A third party's own measurement: a benchmark, a lab test. */
  | 'independent_test'
  /** What the manufacturer asserts about their own product. */
  | 'manufacturer_claim'
  /** An owner's report of their experience. */
  | 'customer_experience'
  /** An observation about the market: price history, competitor position. */
  | 'market_observation'
  /** Our own reasoning from other evidence. Never treated as a fact. */
  | 'model_inference';

/**
 * How much a class of evidence can be trusted, relative to the others.
 *
 * These are *relative* weights for combining evidence within a dimension,
 * not probabilities. A manufacturer's claim is not worthless — it is simply
 * less reliable than a measurement, and an owner's experience is less
 * reliable than a specification but far more informative about comfort,
 * heat and durability than any spec sheet.
 */
export const EVIDENCE_CLASS_WEIGHT: Record<EvidenceClass, number> = {
  objective_fact: 1,
  independent_test: 0.95,
  manufacturer_claim: 0.6,
  customer_experience: 0.55,
  market_observation: 0.7,
  model_inference: 0.35,
};

/** How a piece of evidence was obtained. */
export type EvidenceOrigin = 'catalogue' | 'research' | 'derived' | 'review_analysis' | 'price_engine';

export interface EvidenceSource {
  /** The domain, when known. */
  domain: string | null;
  /** The URL, when known. */
  url: string | null;
  /** A short human-readable label for the UI. */
  label: string;
  /** Where in the system this came from. */
  origin: EvidenceOrigin;
}

/** One piece of evidence. */
export interface DecisionEvidence {
  id: string;
  /** Which intelligence dimension this supports. */
  dimension: IntelligenceDimensionId;
  /** What kind of evidence it is. */
  class: EvidenceClass;
  /** What the evidence says, in one sentence. */
  statement: string;
  /** The structured value, when there is one. */
  value?: string | number | boolean | null;
  /** Where it came from. */
  source: EvidenceSource;
  /** When it was observed. */
  observedAt: string | null;
  /** Freshness against the fact kind's policy. */
  freshness: 'fresh' | 'stale' | 'expired' | 'unknown';
  /** 0..1 — how much we trust this specific piece. */
  confidence: number;
  /** True when another independent source agreed. */
  corroborated: boolean;
  /** True when another source disagreed. */
  disputed: boolean;
  /** The verbatim excerpt supporting it. */
  excerpt: string | null;
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

/** The eight intelligence dimensions. */
export type IntelligenceDimensionId =
  | 'requirement'
  | 'product'
  | 'ownership'
  | 'financial'
  | 'compatibility'
  | 'market'
  | 'risk'
  | 'decision';

export const DIMENSION_IDS: readonly IntelligenceDimensionId[] = [
  'requirement',
  'product',
  'ownership',
  'financial',
  'compatibility',
  'market',
  'risk',
  'decision',
];

/** How confident we are, expressed without fake precision. */
export type ConfidenceBand = 'high' | 'medium' | 'low' | 'insufficient';

/** Convert a 0..1 value into a band. */
export function confidenceBand(value: number | null): ConfidenceBand {
  if (value === null) return 'insufficient';
  if (value >= 0.75) return 'high';
  if (value >= 0.5) return 'medium';
  if (value >= 0.25) return 'low';
  return 'insufficient';
}

/** A contradiction between two pieces of evidence. */
export interface EvidenceConflict {
  dimension: IntelligenceDimensionId;
  /** What the value is about. */
  subject: string;
  /** The competing statements. */
  positions: {
    statement: string;
    value: string | number | boolean | null;
    sourceLabel: string;
    sourceUrl: string | null;
    class: EvidenceClass;
    observedAt: string | null;
  }[];
  /** Plain-language description. */
  explanation: string;
  /** We never resolve these silently. */
  resolution: 'unresolved' | 'higher_confidence_wins';
}

/** The assessment of one dimension for one product. */
export interface DimensionAssessment {
  id: IntelligenceDimensionId;
  label: string;
  /**
   * 0..1, or null when there is no evidence at all.
   *
   * Null means *unknown*. It is never treated as zero.
   */
  score: number | null;
  /** The weight actually applied, after redistribution for unknown dimensions. */
  weight: number;
  /** Whether this dimension had any evidence. */
  hasEvidence: boolean;
  /** The evidence that drove the assessment. */
  evidence: DecisionEvidence[];
  /** What we would need to know but do not. */
  missing: string[];
  /** Contradictions found inside this dimension. */
  conflicts: EvidenceConflict[];
  /** One-line summary for the UI. */
  summary: string;
  /** The confidence band for this assessment. */
  confidence: ConfidenceBand;
}

/* ------------------------------------------------------------------ */
/* Hard constraints                                                    */
/* ------------------------------------------------------------------ */

/**
 * A hard constraint is a rule that excludes a product before any scoring.
 *
 * Constraints are deterministic and never "soft". A product that violates one
 * is not ranked; it is eliminated with a stated reason.
 */
export interface ConstraintResult {
  /** The constraint's key. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Whether the product passed. */
  passed: boolean;
  /** Why it failed, when it failed. */
  reason: string | null;
  /** True when the constraint could not be evaluated (missing data). */
  unevaluable: boolean;
}

/* ------------------------------------------------------------------ */
/* Decision trace                                                      */
/* ------------------------------------------------------------------ */

/** How the brief was understood. */
export interface RequirementInterpretation {
  /** The category that was inferred. */
  category: string | null;
  /** The budget, in paise. */
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  /** The user's stated priorities, with weights. */
  priorities: { key: string; weight: number; source: 'stated' | 'inferred' }[];
  /** Hard requirements. */
  mustHaves: string[];
  /** Workloads the brief implies. */
  workloads: string[];
  /** The brief as understood, in one paragraph. */
  summary: string;
  /** What the brief did not say, and that we would need. */
  gaps: string[];
  /** Acceptable compromises the system is willing to make. */
  compromises: string[];
}

/** A product that was removed before scoring. */
export interface EliminationRecord {
  productId: string;
  displayName: string;
  /** Which stage removed it. */
  stage: 'budget' | 'must_have' | 'compatibility' | 'safety' | 'risk' | 'insufficient_evidence';
  /** The plain-language reason. */
  reason: string;
  /** The specific constraint that failed, when there was one. */
  constraintKey: string | null;
  /** The product's price, when known. */
  pricePaise: number | null;
}

/** A piece of evidence and how much it moved the ranking. */
export interface EvidenceInfluence {
  productId: string;
  displayName: string;
  dimension: IntelligenceDimensionId;
  dimensionLabel: string;
  statement: string;
  class: EvidenceClass;
  /** How much this dimension contributed to this product's score. */
  contribution: number;
  /** Whether the evidence was corroborated by another source. */
  corroborated: boolean;
  sourceLabel: string;
  sourceUrl: string | null;
}

/** A trade-off between two candidates. */
export interface TradeOff {
  /** The dimension on which the candidates differ. */
  dimension: IntelligenceDimensionId;
  /** Plain-language description of the choice. */
  statement: string;
  /** The product that wins on this dimension. */
  favouredProductId: string;
  /** The product that gives something up here. */
  sacrificedProductId: string;
  /** How large the gap is, 0..1. */
  magnitude: number;
}

/** Something we did not know. */
export interface MissingInfo {
  dimension: IntelligenceDimensionId;
  /** What is missing. */
  subject: string;
  /** Why it matters to this decision. */
  impact: string;
  /** How much of the decision it affects, 0..1. */
  materiality: number;
  /** What would resolve it. */
  resolution: string;
}

/** Why the winner won. */
export interface WinnerRationale {
  productId: string;
  displayName: string;
  score: number;
  /** The dimensions that carried the decision. */
  decidingDimensions: { dimension: IntelligenceDimensionId; label: string; score: number | null; weight: number }[];
  /** The runner-up and the margin. */
  marginOverRunnerUp: number | null;
  runnerUpId: string | null;
  /** A one-paragraph explanation. */
  explanation: string;
}

/** Something that would change the recommendation. */
export interface SensitivityNote {
  /** What would change. */
  condition: string;
  /** Which product would then be preferred. */
  wouldFavourProductId: string | null;
  /** How likely that condition is to hold. */
  likelihood: 'likely' | 'possible' | 'unlikely';
  /** The effect on the recommendation. */
  effect: string;
}

/** The complete decision trace. */
export interface DecisionTrace {
  /** 1. What requirements were identified? */
  requirements: RequirementInterpretation;
  /** 2. Which products were eliminated and why? */
  eliminated: EliminationRecord[];
  /** 3. Which evidence influenced the ranking? */
  evidence: EvidenceInfluence[];
  /** 4. What trade-offs were identified? */
  tradeOffs: TradeOff[];
  /** 5. What information was missing? */
  missingInformation: MissingInfo[];
  /** 6. Why did the winner beat the alternatives? */
  winnerRationale: WinnerRationale | null;
  /** 7. What could change the recommendation? */
  sensitivity: SensitivityNote[];
  /** A note on the limits of this decision. */
  limitations: string[];
}

/* ------------------------------------------------------------------ */
/* The decision                                                        */
/* ------------------------------------------------------------------ */

/** A ranked recommendation with its full decision trace. */
export interface DecisionResult {
  productId: string;
  displayName: string;
  brand: string;
  imageUrl: string | null;
  /** The overall score, 0..1. */
  score: number;
  /** The badge, if any. */
  badge: string | null;
  /** Per-dimension assessments. */
  dimensions: DimensionAssessment[];
  /** The headline strengths. */
  strengths: string[];
  /** The headline weaknesses. */
  weaknesses: string[];
  /** Evidence references. */
  evidence: DecisionEvidence[];
  /** The confidence band for the whole decision. */
  confidence: ConfidenceBand;
  /** How much of the score rested on customer reviews, 0..1. */
  reviewDependence: number;
  /** The trace. */
  trace: DecisionTrace;
  /** The payable price, in paise. */
  pricePaise: number | null;
  /** Whether the price was sample data. */
  priceIsSample: boolean;
  /** The retailer. */
  retailer: string | null;
  /** Total ownership cost, when the inputs support one. */
  totalOwnershipCostPaise: number | null;
}
