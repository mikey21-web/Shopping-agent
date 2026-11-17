/**
 * Hard constraints.
 *
 * Constraints run *before* any scoring. A product that fails a hard
 * constraint is not ranked low — it is not ranked at all, and the reason is
 * recorded so the user can see what was excluded and why.
 *
 * Three properties matter:
 *
 *  1. **Deterministic.** Every check is arithmetic or string comparison in
 *     code. No model is asked whether a product "seems compatible".
 *  2. **Unevaluable is not a failure.** When the data needed to evaluate a
 *     constraint is missing, the constraint reports `unevaluable` and the
 *     candidate survives with the gap recorded. A missing specification is
 *     not a defect of the product.
 *  3. **Missing information is never a negative attribute.** The one
 *     exception is a safety-critical category where the absence of a
 *     required certification *is* disqualifying, and that is explicit.
 */

import type {
  ListingCondition,
  Product,
  PurchaseRequirements,
} from '../../domain/types.ts';
import { formatPaise } from '../normalize/specs.ts';
import { checkMustHaves } from '../recommendations/scoring.ts';
import type { ConstraintResult } from './types.ts';

/** The context a constraint is evaluated against. */
export interface ConstraintContext {
  product: Product;
  requirements: PurchaseRequirements;
  /** The guaranteed payable price, in paise, when known. */
  pricePaise: number | null;
  /** The exact variant label of the listing being considered. */
  variantLabel?: string | null;
  /** Whether the product has a published certification. */
  certification?: string | null;
  /** Whether the product is in stock at any retailer. */
  inStock?: boolean | null;
  /** Whether the product's category is safety-critical. */
  safetyCritical: boolean;
  /** Whether the category requires a published certification. */
  requiresCertification: boolean;
  /** The condition of the best listing. */
  condition?: ListingCondition | null;
}

export interface HardConstraint {
  key: string;
  label: string;
  /** True when a failure removes the candidate from the ranking. */
  eliminates: boolean;
  /** Why this constraint exists, for the trace. */
  rationale: string;
  evaluate(context: ConstraintContext): ConstraintResult;
}

function pass(key: string, label: string): ConstraintResult {
  return { key, label, passed: true, reason: null, unevaluable: false };
}

function fail(key: string, label: string, reason: string): ConstraintResult {
  return { key, label, passed: false, reason, unevaluable: false };
}

function unknown(key: string, label: string, reason: string): ConstraintResult {
  return { key, label, passed: true, reason, unevaluable: true };
}

/* ------------------------------------------------------------------ */
/* The constraints                                                     */
/* ------------------------------------------------------------------ */

/** The price must sit inside the stated budget. */
export const budgetConstraint: HardConstraint = {
  key: 'budget',
  label: 'Within the stated budget',
  eliminates: true,
  rationale:
    'A product outside the budget the user stated cannot be the answer, however good it is. It is listed separately so the user can override.',
  evaluate(context) {
    const budgetMinPaise = context.requirements.budgetMinPaise ?? null;
    const budgetMaxPaise = context.requirements.budgetMaxPaise ?? null;
    if (budgetMaxPaise === null && budgetMinPaise === null) {
      return unknown('budget', this.label, 'No budget was stated.');
    }
    if (context.pricePaise === null) {
      // An unknown price is not a budget failure. The product survives and
      // the gap is reported.
      return unknown('budget', this.label, 'No confirmed price is available, so the budget could not be checked.');
    }
    if (budgetMaxPaise !== null && context.pricePaise > budgetMaxPaise) {
      return fail(
        'budget',
        this.label,
        `The price of ${formatPaise(context.pricePaise)} is above the stated ceiling of ${formatPaise(budgetMaxPaise)}.`,
      );
    }
    if (budgetMinPaise !== null && context.pricePaise < budgetMinPaise) {
      return fail(
        'budget',
        this.label,
        `The price of ${formatPaise(context.pricePaise)} is below the stated floor of ${formatPaise(budgetMinPaise)}.`,
      );
    }
    return pass('budget', this.label);
  },
};

/** Every stated must-have must be satisfied. */
export const mustHaveConstraint: HardConstraint = {
  key: 'must_have',
  label: 'Meets the stated requirements',
  eliminates: true,
  rationale:
    'A must-have is something the user said they cannot compromise on. It is checked against the specification surface, deterministically.',
  evaluate(context) {
    const mustHaves = context.requirements.mustHaves ?? [];
    if (mustHaves.length === 0) {
      return unknown('must_have', this.label, 'No hard requirements were stated.');
    }
    const { violated } = checkMustHaves(context.product, mustHaves);
    if (violated.length > 0) {
      return fail(
        'must_have',
        this.label,
        `Does not meet the stated requirement${violated.length === 1 ? '' : 's'}: ${violated.join(', ')}.`,
      );
    }
    return pass('must_have', this.label);
  },
};

/**
 * The exact variant must match what the user asked about.
 *
 * This is the constraint that stops a 16 GB laptop being recommended to
 * someone who asked for 8 GB, or an 8 kg washer being recommended to
 * someone who asked for 7 kg.
 */
export const variantConstraint: HardConstraint = {
  key: 'variant',
  label: 'Is the exact configuration asked for',
  eliminates: true,
  rationale:
    'Comparisons are made between exact variants, never between product families. A different configuration is a different product.',
  evaluate(context) {
    const wanted = context.requirements.mustHaves.find((entry) =>
      /variant|configuration|exact model|part number|model number/i.test(entry),
    );
    if (!wanted) {
      return unknown('variant', this.label, 'No specific configuration was requested.');
    }
    const haystack = [
      context.product.displayName,
      context.product.model,
      context.variantLabel ?? '',
      ...Object.values(context.product.specs.extra).map(String),
    ]
      .join(' ')
      .toLowerCase();

    const tokens = wanted
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2 && !/variant|configuration|exact|model|number/.test(token));

    const missing = tokens.filter((token) => !haystack.includes(token));
    if (missing.length > 0) {
      return fail(
        'variant',
        this.label,
        `The available configuration does not match "${wanted}" (missing: ${missing.join(', ')}).`,
      );
    }
    return pass('variant', this.label);
  },
};

/**
 * Safety-critical categories require a certification.
 *
 * This is the one place where *missing* information excludes a product, and
 * it is deliberate: in a safety-sensitive category, an unverified part is
 * not a product we can recommend.
 */
export const safetyCertificationConstraint: HardConstraint = {
  key: 'safety_certification',
  label: 'Carries the required safety certification',
  eliminates: true,
  rationale:
    'In a safety-sensitive category, a part without a published certification cannot be recommended, even when everything else matches. The gap is stated rather than hidden.',
  evaluate(context) {
    if (!context.requiresCertification) {
      return unknown(
        'safety_certification',
        this.label,
        context.safetyCritical
          ? 'This category is safety-sensitive but does not require a published certification for every product.'
          : 'This category is not safety-sensitive.',
      );
    }
    if (context.certification && context.certification.trim().length > 0) {
      return pass('safety_certification', this.label);
    }
    return fail(
      'safety_certification',
      this.label,
      'No safety certification is published for this product. In this category that is disqualifying.',
    );
  },
};

/**
 * Out of stock is reported, not silently ranked as if it were buyable.
 *
 * It does not eliminate: the best model in the category is still worth
 * telling the user about, and a price drop may bring it back. The UI marks
 * it clearly.
 */
export const availabilityConstraint: HardConstraint = {
  key: 'availability',
  label: 'Currently buyable',
  eliminates: false,
  rationale:
    'An out-of-stock product is still the right answer for many shoppers, so it is flagged rather than removed. The UI marks it as not currently buyable.',
  evaluate(context) {
    if (context.inStock === null || context.inStock === undefined) {
      return unknown('availability', this.label, 'Availability was not confirmed.');
    }
    if (!context.inStock) {
      return {
        key: 'availability',
        label: this.label,
        passed: false,
        reason: 'Not currently in stock at any retailer.',
        unevaluable: false,
      };
    }
    return pass('availability', this.label);
  },
};

/** A refurbished or used unit is not the new product the user asked for. */
export const conditionConstraint: HardConstraint = {
  key: 'condition',
  label: 'Sold as a new item',
  eliminates: false,
  rationale:
    'A refurbished unit is a different product at a different price. It is flagged so the price comparison is not misleading.',
  evaluate(context) {
    if (!context.condition) {
      return unknown('condition', this.label, 'The condition was not stated.');
    }
    if (context.condition !== 'new') {
      return {
        key: 'condition',
        label: this.label,
        passed: false,
        reason: `The best available listing is ${context.condition.replace('_', ' ')}, not new.`,
        unevaluable: false,
      };
    }
    return pass('condition', this.label);
  },
};

/** Every hard constraint, in the order they are evaluated. */
export const HARD_CONSTRAINTS: HardConstraint[] = [
  budgetConstraint,
  mustHaveConstraint,
  variantConstraint,
  safetyCertificationConstraint,
  conditionConstraint,
  availabilityConstraint,
];
