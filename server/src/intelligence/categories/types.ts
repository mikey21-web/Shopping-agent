/**
 * Category intelligence framework.
 *
 * SahiPick is a universal shopping decision platform. Every category needs
 * its own specification schema, buying criteria, compatibility rules, review
 * taxonomy, reliability signals, ownership cost model and recommendation
 * evaluator — a smartphone scoring formula must never be applied to a
 * washing machine.
 *
 * A category is added by registering a `CategoryProfile`. Nothing else in the
 * platform needs to change: matching, pricing, review analysis and
 * recommendations all read from the profile.
 */

import type {
  CategoryId,
  NormalizedSpecs,
  PurchaseRequirements,
  ReviewAspect,
  ReviewIntelligence,
} from '../../domain/types.ts';
import { matchesTerm } from './term-matching.ts';

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface ScoreInput {
  specs: NormalizedSpecs;
  reviews: ReviewIntelligence | null;
  /** Guaranteed payable price in paise. */
  pricePaise: number | null;
  /** Median payable price of the candidate set, for value normalisation. */
  referencePricePaise: number | null;
  requirements: PurchaseRequirements;
  /** Category profile, so a component can read category-specific data. */
  category?: CategoryProfile | null;
}

export interface ComponentResult {
  score: number;
  evidence: string[];
}

export interface ComponentDefinition {
  key: string;
  label: string;
  /** Default weight before requirement priorities are applied. */
  baseWeight: number;
  /** Requirement priority key that boosts this component, e.g. 'camera'. */
  priorityKey?: string;
  /** Workload tags that activate this component, e.g. 'local_ai'. */
  workloads?: string[];
  compute(input: ScoreInput): ComponentResult;
}

export type SpecFieldType = 'number' | 'string' | 'boolean' | 'enum';

/** One normalised specification field for a category. */
export interface SpecField {
  key: string;
  label: string;
  type: SpecFieldType;
  /** Unit shown to the user, e.g. 'GB', 'L', 'kg'. */
  unit?: string;
  /** Aliases that map a retailer's raw label onto this field. */
  aliases: string[];
  /** Normalisation range for numeric fields. */
  range?: { min: number; max: number; ideal?: number };
  /** Allowed values for enum fields. */
  values?: string[];
  /**
   * True when a difference in this field means the two listings are a
   * different variant (a 5kg vs 7kg washing machine, a 256GB vs 512GB phone).
   */
  variantDefining: boolean;
  /**
   * True when the field must be known on both sides before two listings can
   * be declared the same item. "Missing data is not agreement."
   */
  requiredForMatch: boolean
}

/** A buying criterion the shopper cares about. */
export interface DecisionDimension {
  key: string;
  label: string;
  /** Terms in the user's request that indicate this dimension matters. */
  keywords: string[];
  /** Human-readable description used in explanations. */
  description: string
}

/** A category-specific risk the user should know about. */
export interface RiskRule {
  key: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  /** Returns a message when the rule fires, or null. */
  evaluate(input: RiskContext): string | null
}

export interface RiskContext {
  specs: Record<string, string | number | boolean | undefined>;
  extra: Record<string, string | number | boolean>;
  reviewComplaints: string[];
  warrantyMonths?: number | undefined;
  pricePaise?: number | null
}

/** Running cost of owning the product over its life. */
export interface OwnershipCostModel {
  label: string;
  /** Years the ownership horizon covers. */
  horizonYears: number;
  /**
   * Annual running cost in paise, computed from the specifications.
   * Returns null when the category has no meaningful running cost.
   */
  annualRunningCostPaise?(specs: Record<string, string | number | boolean | undefined>): number | null;
  /** Consumables or accessories a buyer should budget for, in paise. */
  typicalAccessoryCostPaise?: number;
  /** Human-readable note about what drives the running cost. */
  note: string
}

/* ------------------------------------------------------------------ */
/* The category profile itself                                           */
/* ------------------------------------------------------------------ */

/** The category profile itself. */
export interface CategoryProfile {
  id: CategoryId;
  label: string;
  /** Search aliases, including brand-agnostic terms and local-language terms. */
  aliases: string[];
  /** Extra terms that identify this category in a user request. */
  requestTerms: string[];

  /** The category's normalised specification schema. */
  specFields: SpecField[];
  /** Fields that define a distinct sellable variant. */
  variantFields: string[];
  /** Fields that must be present on both sides for a confident exact match. */
  requiredMatchFields: string[];

  /** What the shopper is actually deciding. */
  decisionDimensions: DecisionDimension[];

  /** Review aspects mined for this category. */
  reviewAspects: ReviewAspect[];

  /** Category-specific risks. */
  risks: RiskRule[];

  /** Ownership cost model. */
  ownership: OwnershipCostModel;

  /**
   * True for categories where a mistake can harm the buyer (baby products,
   * helmets, electricals, food). These require stricter evidence handling
   * and never allow an AI estimate to stand in for a fact.
   */
  safetyCritical: boolean;

  /**
   * True when a product in this category must publish a safety certification
   * (BIS/ISI, ECE, FSSAI, and so on) before it can be recommended.
   *
   * This is deliberately narrower than `safetyCritical`. Food and cosmetics
   * are safety-sensitive, but a missing licence number on a retailer listing
   * is a gap to report, not a reason to refuse to recommend the product.
   * A brake pad without a certification is a different matter.
   */
  requiresCertification: boolean;

  /**
   * True when the category has a bespoke scoring model. Categories without
   * one fall back to the generic profile, and the UI says so.
   */
  specialised: boolean;

  /**
   * The scoring components for this category. An empty list means the
   * generic component set is used, and the UI says the category does not yet
   * have a specialised scoring model.
   */
  components: ComponentDefinition[];

  /**
   * How much each intelligence dimension contributes to a decision in this
   * category. Overrides the platform defaults in
   * `intelligence/decision/weights.ts`.
   *
   * Keys: requirement, product, ownership, financial, compatibility, market,
   * risk, decision. The values are relative, not percentages — they are
   * normalised before use.
   */
  decisionWeights?: Partial<
    Record<
      | 'requirement'
      | 'product'
      | 'ownership'
      | 'financial'
      | 'compatibility'
      | 'market'
      | 'risk'
      | 'decision',
      number
    >
  >
}

/* ------------------------------------------------------------------ */
/* Registry of category profiles                                         */
/* ------------------------------------------------------------------ */

/** Registry of category profiles. */
const profiles = new Map<CategoryId, CategoryProfile>();

/**
 * Register a category profile so the platform recognises the category
 * from user requests and can apply category-specific rules.
 */
export function registerCategory(profile: CategoryProfile): void {
  profiles.set(profile.id, profile);
}

/**
 * Look up a category profile by its ID.
 *
 * Returns the registered profile, or a generic fallback when no profile
 * is registered for the given ID. This ensures the platform can handle
 * any product category without requiring a profile for every possible
 * product type — the generic profile provides default dimensions,
 * weights, and evidence handling.
 */
export function getCategory(id: CategoryId | string | null | undefined): CategoryProfile | null {
  if (!id) return null;
  return profiles.get(id as CategoryId) ?? null
}

/**
 * Fallback category profile used when no explicit profile is registered.
 * The platform uses this for any category ID that has not been explicitly
 * registered, so the system works out of the box for any product type.
 */
function genericCategoryProfile(): CategoryProfile {
  return {
    id: "generic" as CategoryId,
    label: "Generic product category",
    aliases: [],
    requestTerms: [],
    specFields: [],
    variantFields: [],
    requiredMatchFields: [],
    decisionDimensions: [],
    reviewAspects: [],
    risks: [],
    ownership: {
      label: 'General ownership',
      horizonYears: 3,
      note: 'Cost per use is the honest measure for anything that wears out.',
    },
    safetyCritical: true,
    requiresCertification: false,
    specialised: false,
    components: [],
    decisionWeights: {
      requirement: 0.2,
      product: 0.2,
      ownership: 0.2,
      financial: 0.2,
      compatibility: 0.1,
      market: 0.1,
      risk: 0.1,
      decision: 0.1,
    },
  };
}

export function listCategories(): CategoryProfile[] {
  return [...profiles.values()];
}

export function categoryExists(id: string): boolean {
  return profiles.has(id as CategoryId)
}

/**
 * Detect a category from free text using the registered profiles' aliases and
 * request terms.
 */
export function detectCategoryFromText(text: string): CategoryId | null {
  const lower = text.toLowerCase();
  let best: { id: CategoryId; hits: number } | null = null;

  for (const profile of profiles.values()) {
    let hits = 0;
    for (const term of [...profile.aliases, ...profile.requestTerms]) {
      if (matchesTerm(lower, term.toLowerCase())) hits += 1;
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { id: profile.id, hits };
    }
  }

  return best?.id ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}