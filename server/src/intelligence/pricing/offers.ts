/**
 * Offer application engine — the "real price" calculator.
 *
 * Contract (enforced by tests):
 *  - All arithmetic happens in integer paise. No floats for money.
 *  - The same inputs always produce the same breakdown, independent of the
 *    order in which offers are supplied (except for explicit tie-breaks).
 *  - Guaranteed reductions and conditional reductions are reported separately.
 *    The shopper can always rely on `guaranteedPayablePaise`; `bestCasePayablePaise`
 *    is only achievable if the stated conditions are met.
 *  - Cashback is never subtracted from the payable amount — it is money that
 *    arrives later and has conditions of its own.
 *  - Exchange benefits are never subtracted either: they depend on the value of
 *    a device the shopper owns, which we do not know.
 *
 * An LLM may *discover and describe* offers, but it never participates in this
 * calculation.
 */

import type {
  AppliedOffer,
  Offer,
  OfferKind,
  OfferStackability,
  PriceBreakdown,
  RetailerListing,
  SkippedOffer,
} from '../../domain/types.ts';
import { computeEmi, toEmiPlan } from './emi.ts';

/** What we know about the shopper, used to evaluate conditional offers. */
export interface ShopperContext {
  /** Bank the shopper will use, e.g. 'HDFC Bank'. */
  bank?: string | null;
  /** Card type the shopper will use. */
  cardType?: 'credit' | 'debit' | null;
  /** Membership tier, e.g. 'Prime'. */
  membershipTier?: string | null;
  /** Shopper has a device eligible for the exchange offer. */
  exchangeEligible?: boolean;
  /** Preferred EMI tenure in months. */
  emiTenureMonths?: number | null;
  /** Evaluation time; used for validity windows. */
  now?: Date;
}

const DEFAULT_NOW = new Date();

function offerWindowValid(offer: Offer, now: Date): boolean {
  if (offer.validityStart && new Date(offer.validityStart) > now) return false;
  if (offer.validityEnd && new Date(offer.validityEnd) < now) return false;
  return true;
}

/** Compute the price reduction an offer yields, before eligibility checks. */
function discountValue(offer: Offer, basePricePaise: number): number {
  let discount = 0;
  if (offer.percentOff && offer.percentOff > 0) {
    discount = Math.round((basePricePaise * offer.percentOff) / 100);
    if (offer.conditions.maxDiscountPaise != null) {
      discount = Math.min(discount, offer.conditions.maxDiscountPaise);
    }
  }
  if (offer.flatOffPaise && offer.flatOffPaise > 0) {
    discount = Math.max(discount, offer.flatOffPaise);
  }
  if (offer.conditions.minSpendPaise != null && basePricePaise < offer.conditions.minSpendPaise) {
    return 0;
  }
  return Math.max(0, discount);
}

/**
 * Classify an offer as guaranteed or conditional for a given shopper.
 *
 * Guaranteed  = no dependency on the shopper's card, bank, membership or
 *               trade-in. A coupon with a code still qualifies because entering
 *               a code is a deterministic step, not a qualification.
 * Conditional = depends on a payment method, membership tier or exchange.
 */
export function classifyOfferCertainty(offer: Offer): 'guaranteed' | 'conditional' {
  const c = offer.conditions;
  if (c.paymentMethods?.length || c.bank || c.cardType) return 'conditional';
  if (c.membershipTier) return 'conditional';
  if (c.requiresExchange) return 'conditional';
  if (offer.kind === 'exchange') return 'conditional';
  if (offer.kind === 'cashback' || offer.kind === 'emi' || offer.kind === 'no_cost_emi') {
    return 'conditional';
  }
  return 'guaranteed';
}

/** Check whether the shopper's context satisfies an offer's conditions. */
export function evaluateEligibility(
  offer: Offer,
  pricePaise: number,
  context: ShopperContext,
): { eligible: boolean; reason: string } {
  const c = offer.conditions;

  if (c.minSpendPaise != null && pricePaise < c.minSpendPaise) {
    return {
      eligible: false,
      reason: `Requires a minimum spend of ₹${(c.minSpendPaise / 100).toLocaleString('en-IN')}`,
    };
  }

  if (c.bank) {
    const shopperBank = context.bank?.toLowerCase().trim();
    const offerBank = c.bank.toLowerCase().trim();
    if (!shopperBank || !shopperBank.includes(offerBank) && !offerBank.includes(shopperBank)) {
      return { eligible: false, reason: `Requires ${c.bank} card` };
    }
  }

  if (c.paymentMethods?.length) {
    const methods = c.paymentMethods.map((m) => m.toLowerCase());
    const shopperMethod = [context.bank, context.cardType].filter(Boolean).join(' ').toLowerCase();
    const matches = methods.some((method) => shopperMethod.includes(method));
    if (!matches) {
      return { eligible: false, reason: `Requires payment via ${c.paymentMethods.join(' or ')}` };
    }
  }

  if (c.cardType && context.cardType !== c.cardType) {
    return { eligible: false, reason: `Requires a ${c.cardType} card` };
  }

  if (c.membershipTier) {
    const shopperTier = context.membershipTier?.toLowerCase().trim();
    const offerTier = c.membershipTier.toLowerCase().trim();
    if (!shopperTier || shopperTier !== offerTier) {
      return { eligible: false, reason: `Requires ${c.membershipTier} membership` };
    }
  }

  if (c.requiresExchange && !context.exchangeEligible) {
    return { eligible: false, reason: 'Requires exchanging a qualifying old device' };
  }

  if (offer.kind === 'no_cost_emi' && c.emiMinTenureMonths) {
    const tenure = context.emiTenureMonths ?? c.emiTenureMonths ?? 0;
    if (tenure < c.emiMinTenureMonths) {
      return {
        eligible: false,
        reason: `No-cost EMI requires at least ${c.emiMinTenureMonths} months`,
      };
    }
  }

  return { eligible: true, reason: 'Eligible' };
}

/** Offers that affect the cart price directly (cashback and exchange do not). */
const PRICE_REDUCING: readonly OfferKind[] = [
  'coupon',
  'bank_discount',
  'card_offer',
  'membership',
  'emi',
];

/**
 * Apply a set of offers to a listing and produce the full price breakdown.
 */
export function computePriceBreakdown(
  listing: RetailerListing,
  offers: Offer[],
  context: ShopperContext = {},
): PriceBreakdown {
  const now = context.now ?? DEFAULT_NOW;
  const applied: AppliedOffer[] = [];
  const skipped: SkippedOffer[] = [];

  let listPrice = listing.listPricePaise;
  let deliveryFee = listing.deliveryFeePaise ?? 0;
  let cashbackPaise = 0;
  let exchangeBonusPaise = 0;
  let guaranteedDiscount = 0;
  let conditionalDiscount = 0;

  // Deterministic ordering: group by kind so the result never depends on the
  // order in which the caller supplied offers.
  const ordered = [...offers].sort((a, b) => {
    const byKind = PRICE_REDUCING.indexOf(a.kind) - PRICE_REDUCING.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    const byId = a.id.localeCompare(b.id);
    return byId;
  });

  // Track which "primary" slot has been consumed so exclusive/primary_only
  // offers do not stack with each other.
  let primaryUsed = false;
  const exclusiveGroups = new Set<string>();

  for (const offer of ordered) {
    if (!offerWindowValid(offer, now)) {
      skipped.push({
        offerId: offer.id,
        kind: offer.kind,
        title: offer.title,
        reason: 'Offer validity window has closed',
      });
      continue;
    }

    // Delivery offers reduce the delivery fee, not the product price.
    if (offer.kind === 'delivery') {
      const eligibility = evaluateEligibility(offer, listPrice, context);
      if (!eligibility.eligible) {
        skipped.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          reason: eligibility.reason,
        });
        continue;
      }
      const free = offer.conditions.maxDiscountPaise ?? deliveryFee;
      const reduction = Math.min(deliveryFee, Math.max(0, free));
      if (reduction > 0) {
        deliveryFee -= reduction;
        applied.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          discountPaise: reduction,
          certainty: classifyOfferCertainty(offer),
          conditions: offer.conditions,
          stackability: offer.stackability,
        });
      } else {
        skipped.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          reason: 'No delivery fee to waive',
        });
      }
      continue;
    }

    // Cashback is reported, never subtracted.
    if (offer.kind === 'cashback') {
      const eligibility = evaluateEligibility(offer, listPrice, context);
      if (!eligibility.eligible) {
        skipped.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          reason: eligibility.reason,
        });
        continue;
      }
      const amount = offer.cashbackPaise ?? 0;
      if (amount > 0) {
        cashbackPaise += amount;
        applied.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          discountPaise: 0,
          certainty: 'conditional',
          conditions: offer.conditions,
          stackability: offer.stackability,
        });
      }
      continue;
    }

    // Exchange benefit is informational only.
    if (offer.kind === 'exchange') {
      const eligibility = evaluateEligibility(offer, listPrice, context);
      if (!eligibility.eligible) {
        skipped.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          reason: eligibility.reason,
        });
        continue;
      }
      const bonus = offer.conditions.exchangeBonusPaise ?? offer.flatOffPaise ?? 0;
      exchangeBonusPaise += bonus;
      applied.push({
        offerId: offer.id,
        kind: offer.kind,
        title: offer.title,
        discountPaise: 0,
        certainty: 'conditional',
        conditions: offer.conditions,
        stackability: offer.stackability,
      });
      continue;
    }

    // No-cost EMI does not change the cash price, but it changes the plan.
    if (offer.kind === 'no_cost_emi') {
      const eligibility = evaluateEligibility(offer, listPrice, context);
      if (!eligibility.eligible) {
        skipped.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          reason: eligibility.reason,
        });
        continue;
      }
      applied.push({
        offerId: offer.id,
        kind: offer.kind,
        title: offer.title,
        discountPaise: 0,
        certainty: 'conditional',
        conditions: offer.conditions,
        stackability: offer.stackability,
      });
      continue;
    }

    if (!PRICE_REDUCING.includes(offer.kind)) continue;

    // Stackability gates for price-reducing offers.
    if (offer.stackability === 'primary_only' && primaryUsed) {
      skipped.push({
        offerId: offer.id,
        kind: offer.kind,
        title: offer.title,
        reason: 'Another primary discount was already applied',
      });
      continue;
    }
    if (offer.stackability === 'exclusive') {
      const group = offer.conditions.bank ?? offer.conditions.membershipTier ?? 'generic';
      if (exclusiveGroups.has(group)) {
        skipped.push({
          offerId: offer.id,
          kind: offer.kind,
          title: offer.title,
          reason: 'Conflicts with another exclusive offer of the same kind',
        });
        continue;
      }
    }

    const eligibility = evaluateEligibility(offer, listPrice, context);
    if (!eligibility.eligible) {
      skipped.push({
        offerId: offer.id,
        kind: offer.kind,
        title: offer.title,
        reason: eligibility.reason,
      });
      continue;
    }

    const discount = discountValue(offer, listPrice);
    if (discount <= 0) {
      skipped.push({
        offerId: offer.id,
        kind: offer.kind,
        title: offer.title,
        reason:
          offer.conditions.minSpendPaise != null && listPrice < offer.conditions.minSpendPaise
            ? `Requires a minimum spend of ₹${(offer.conditions.minSpendPaise / 100).toLocaleString('en-IN')}`
            : 'No discount value on this order',
      });
      continue;
    }

    const certainty = classifyOfferCertainty(offer);
    listPrice = Math.max(0, listPrice - discount);
    if (certainty === 'guaranteed') guaranteedDiscount += discount;
    else conditionalDiscount += discount;

    applied.push({
      offerId: offer.id,
      kind: offer.kind,
      title: offer.title,
      discountPaise: discount,
      certainty,
      conditions: offer.conditions,
      stackability: offer.stackability,
    });

    if (offer.stackability === 'primary_only') primaryUsed = true;
    if (offer.stackability === 'exclusive') {
      exclusiveGroups.add(offer.conditions.bank ?? offer.conditions.membershipTier ?? 'generic');
    }
  }

  const originalPricePaise = listing.listPricePaise;
  const guaranteedPaise = Math.max(0, originalPricePaise - guaranteedDiscount);
  const bestCasePaise = Math.max(
    0,
    originalPricePaise - guaranteedDiscount - conditionalDiscount,
  );

  // EMI plan (informational) — derived from the guaranteed price.
  let emi: PriceBreakdown['emi'] = null;
  const emiOffer = offers.find((o) => o.kind === 'emi' || o.kind === 'no_cost_emi');
  const tenure = context.emiTenureMonths ?? emiOffer?.conditions.emiTenureMonths ?? 6;
  const rate = emiOffer?.conditions.emiInterestRatePercent ?? 13;
  const processing = emiOffer?.conditions.emiProcessingFeePaise ?? 0;
  const quote = computeEmi(guaranteedPaise, tenure, rate, processing);
  if (quote) emi = toEmiPlan(quote);

  return {
    listingId: listing.id,
    productId: listing.productId,
    variantId: listing.variantId,
    retailer: listing.retailer,
    listPricePaise: listing.listPricePaise,
    mrpPaise: listing.mrpPaise ?? null,
    guaranteedDiscountPaise: guaranteedDiscount,
    conditionalDiscountPaise: conditionalDiscount,
    potentialDiscountPaise: guaranteedDiscount + conditionalDiscount,
    bestCasePaise,
    guaranteedPaise,
    cashbackPaise,
    exchangeBonusPaise,
    deliveryFeePaise: deliveryFee,
    payablePaise: guaranteedPaise + deliveryFee,
    bestCasePayablePaise: bestCasePaise + deliveryFee,
    applied,
    skipped,
    emi,
    offerCount: offers.length,
  };
}

/**
 * Effective price used for ranking.
 *
 * We rank on the *guaranteed* payable amount so a recommendation never depends
 * on a discount the shopper may not qualify for. The best-case price is carried
 * alongside for display.
 */
export function effectivePricePaise(breakdown: PriceBreakdown): number {
  return breakdown.payablePaise;
}

/** Total discount versus the listed price, as a ratio (0..1). */
export function discountRatio(breakdown: PriceBreakdown): number {
  if (breakdown.listPricePaise <= 0) return 0;
  return breakdown.potentialDiscountPaise / breakdown.listPricePaise;
}

/** Human-readable label for an offer kind. */
export const OFFER_KIND_LABELS: Record<OfferKind, string> = {
  coupon: 'Coupon',
  bank_discount: 'Bank discount',
  card_offer: 'Card offer',
  cashback: 'Cashback',
  emi: 'EMI',
  no_cost_emi: 'No-cost EMI',
  exchange: 'Exchange',
  delivery: 'Delivery',
  membership: 'Membership',
};

/** Stackability label for the UI. */
export const STACKABILITY_LABELS: Record<OfferStackability, string> = {
  stackable: 'Combines with other offers',
  exclusive: 'Does not combine with other offers of the same type',
  primary_only: 'One primary discount per order',
};
