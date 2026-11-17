import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOfferCertainty,
  computePriceBreakdown,
  evaluateEligibility,
  type ShopperContext,
} from '../src/intelligence/pricing/offers.ts';
import { computeEmi } from '../src/intelligence/pricing/emi.ts';
import type { Offer, RetailerListing } from '../src/domain/types.ts';

const listing: RetailerListing = {
  id: 'listing-1',
  variantId: 'variant-1',
  productId: 'product-1',
  retailer: 'amazon_in',
  retailerProductId: 'B0TEST',
  title: 'Test product',
  url: 'https://example.test/p',
  listPricePaise: 10000000, // ₹1,00,000
  mrpPaise: 12000000,
  condition: 'new',
  inStock: true,
  deliveryFeePaise: 0,
  provenance: { origin: 'sample', source: 'test', observedAt: null, confidence: 1 },
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

function offer(partial: Partial<Offer> & { id: string; kind: Offer['kind']; title: string; listingId?: string }): Offer {
  return {
    listingId: 'listing-1',
    description: null,
    conditions: {},
    stackability: 'stackable',
    automatic: false,
    provenance: { origin: 'sample', source: 'test', observedAt: null, confidence: 1 },
    ...partial,
  };
}

describe('offer eligibility', () => {
  it('requires the right bank for a bank discount', () => {
    const bankOffer = offer({
      id: 'o-bank',
      kind: 'bank_discount',
      title: '10% off with HDFC',
      percentOff: 10,
      conditions: { bank: 'HDFC Bank', cardType: 'credit' },
    });

    const wrong = evaluateEligibility(bankOffer, 10000000, { bank: 'ICICI Bank', cardType: 'credit' });
    assert.equal(wrong.eligible, false);

    const right = evaluateEligibility(bankOffer, 10000000, { bank: 'HDFC Bank', cardType: 'credit' });
    assert.equal(right.eligible, true);
  });

  it('enforces a minimum spend', () => {
    const minSpend = offer({
      id: 'o-min',
      kind: 'coupon',
      title: '₹1000 off over ₹50,000',
      flatOffPaise: 100000,
      conditions: { minSpendPaise: 5000000 },
    });
    assert.equal(evaluateEligibility(minSpend, 4000000, {}).eligible, false);
    assert.equal(evaluateEligibility(minSpend, 6000000, {}).eligible, true);
  });

  it('requires membership for a membership-gated offer', () => {
    const memberOffer = offer({
      id: 'o-mem',
      kind: 'membership',
      title: 'Prime price',
      percentOff: 5,
      conditions: { membershipTier: 'Prime' },
    });
    assert.equal(evaluateEligibility(memberOffer, 10000000, {}).eligible, false);
    assert.equal(evaluateEligibility(memberOffer, 10000000, { membershipTier: 'Prime' }).eligible, true);
  });

  it('classifies certainty correctly', () => {
    const coupon = offer({ id: 'c', kind: 'coupon', title: 'coupon' });
    const bank = offer({
      id: 'b',
      kind: 'bank_discount',
      title: 'bank',
      conditions: { bank: 'HDFC Bank' },
    });
    assert.equal(classifyOfferCertainty(coupon), 'guaranteed');
    assert.equal(classifyOfferCertainty(bank), 'conditional');
  });
});

describe('price breakdown', () => {
  it('applies a stackable coupon to the payable price', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({
          id: 'o1',
          kind: 'coupon',
          title: '10% off',
          percentOff: 10,
          conditions: { couponCode: 'SAVE10' },
        }),
      ],
      {},
    );

    assert.equal(breakdown.guaranteedDiscountPaise, 1000000);
    assert.equal(breakdown.guaranteedPaise, 9000000);
    assert.equal(breakdown.payablePaise, 9000000);
    assert.equal(breakdown.bestCasePaise, 9000000);
  });

  it('caps a percentage discount at the stated maximum', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({
          id: 'o1',
          kind: 'coupon',
          title: '20% off max 5000',
          percentOff: 20,
          conditions: { maxDiscountPaise: 500000 },
        }),
      ],
      {},
    );
    assert.equal(breakdown.guaranteedDiscountPaise, 500000);
    assert.equal(breakdown.payablePaise, 9500000);
  });

  it('separates guaranteed and conditional discounts', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({ id: 'o1', kind: 'coupon', title: '5% site coupon', percentOff: 5 }),
        offer({
          id: 'o2',
          kind: 'bank_discount',
          title: '10% HDFC',
          percentOff: 10,
          conditions: { bank: 'HDFC Bank', cardType: 'credit' },
        }),
      ],
      { bank: 'HDFC Bank', cardType: 'credit' },
    );

    // Percentage discounts apply sequentially on the running price, which is
    // how retailers actually settle stacked offers: 5% of ₹1,00,000 is ₹5,000,
    // then 10% of the remaining ₹95,000 is ₹9,500.
    assert.equal(breakdown.guaranteedDiscountPaise, 500000);
    assert.equal(breakdown.conditionalDiscountPaise, 950000);
    assert.equal(breakdown.guaranteedPaise, 9500000);
    assert.equal(breakdown.bestCasePaise, 8550000);
    assert.equal(breakdown.payablePaise, 9500000);
    assert.equal(breakdown.bestCasePayablePaise, 8550000);
  });

  it('skips an ineligible bank offer and records the reason', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({
          id: 'o1',
          kind: 'bank_discount',
          title: '10% HDFC',
          percentOff: 10,
          conditions: { bank: 'HDFC Bank', cardType: 'credit' },
        }),
      ],
      { bank: 'ICICI Bank', cardType: 'debit' },
    );

    assert.equal(breakdown.conditionalDiscountPaise, 0);
    assert.equal(breakdown.skipped.length, 1);
    assert.match(breakdown.skipped[0]?.reason ?? '', /HDFC/);
  });

  it('never subtracts cashback from the payable amount', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [offer({ id: 'o1', kind: 'cashback', title: '₹500 cashback', cashbackPaise: 50000 })],
      {},
    );

    assert.equal(breakdown.cashbackPaise, 50000);
    assert.equal(breakdown.payablePaise, listing.listPricePaise);
  });

  it('never subtracts an exchange benefit from the payable amount', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({
          id: 'o1',
          kind: 'exchange',
          title: '₹3000 exchange bonus',
          conditions: { exchangeBonusPaise: 300000, requiresExchange: true },
        }),
      ],
      { exchangeEligible: true },
    );

    assert.equal(breakdown.exchangeBonusPaise, 300000);
    assert.equal(breakdown.payablePaise, listing.listPricePaise);
  });

  it('applies only one primary discount', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({
          id: 'o1',
          kind: 'bank_discount',
          title: '10% bank',
          percentOff: 10,
          stackability: 'primary_only',
          conditions: { bank: 'HDFC Bank' },
        }),
        offer({
          id: 'o2',
          kind: 'card_offer',
          title: '5% card',
          percentOff: 5,
          stackability: 'primary_only',
          conditions: { cardType: 'credit' },
        }),
      ],
      { bank: 'HDFC Bank', cardType: 'credit' },
    );

    assert.equal(breakdown.applied.filter((a) => a.kind !== 'cashback').length, 1);
    assert.ok(breakdown.skipped.some((s) => /primary discount/i.test(s.reason)));
  });

  it('reduces the delivery fee with a free-delivery offer', () => {
    const withDelivery: RetailerListing = { ...listing, deliveryFeePaise: 9900 };
    const breakdown = computePriceBreakdown(
      withDelivery,
      [offer({ id: 'o1', kind: 'delivery', title: 'Free delivery', conditions: { maxDiscountPaise: 9900 } })],
      {},
    );

    assert.equal(breakdown.deliveryFeePaise, 0);
    assert.equal(breakdown.payablePaise, listing.listPricePaise);
  });

  it('is deterministic regardless of the order offers are supplied in', () => {
    const offers = [
      offer({ id: 'o1', kind: 'coupon', title: '5%', percentOff: 5 }),
      offer({
        id: 'o2',
        kind: 'bank_discount',
        title: '10%',
        percentOff: 10,
        conditions: { bank: 'HDFC Bank' },
      }),
      offer({ id: 'o3', kind: 'cashback', title: 'cashback', cashbackPaise: 10000 }),
    ];
    const context: ShopperContext = { bank: 'HDFC Bank' };

    const first = computePriceBreakdown(listing, offers, context);
    const second = computePriceBreakdown(listing, [...offers].reverse(), context);

    assert.equal(first.payablePaise, second.payablePaise);
    assert.equal(first.bestCasePaise, second.bestCasePaise);
    assert.equal(first.cashbackPaise, second.cashbackPaise);
  });

  it('never produces a negative payable amount', () => {
    const breakdown = computePriceBreakdown(
      { ...listing, listPricePaise: 1000 },
      [offer({ id: 'o1', kind: 'coupon', title: 'huge', flatOffPaise: 999999 })],
      {},
    );
    assert.equal(breakdown.payablePaise, 0);
    assert.ok(breakdown.payablePaise >= 0);
  });

  it('excludes expired offers', () => {
    const breakdown = computePriceBreakdown(
      listing,
      [
        offer({
          id: 'o1',
          kind: 'coupon',
          title: 'expired',
          percentOff: 50,
          validityEnd: '2020-01-01T00:00:00.000Z',
        }),
      ],
      { now: new Date('2026-01-01T00:00:00.000Z') },
    );

    assert.equal(breakdown.guaranteedDiscountPaise, 0);
    assert.ok(breakdown.skipped.some((s) => /validity/i.test(s.reason)));
  });
});

describe('EMI arithmetic', () => {
  it('computes a zero-interest EMI as an exact split', () => {
    const quote = computeEmi(10000000, 10, 0);
    assert.ok(quote);
    assert.equal(quote.monthlyPaise, 1000000);
    assert.equal(quote.totalPaise, 10000000);
    assert.equal(quote.interestPaise, 0);
  });

  it('computes a standard reducing-balance EMI', () => {
    const quote = computeEmi(10000000, 12, 13);
    assert.ok(quote);
    // Sanity: total exceeds the principal and monthly is around the standard figure.
    assert.ok(quote.totalPaise > 10000000);
    assert.ok(quote.monthlyPaise > 800000 && quote.monthlyPaise < 900000);
    assert.equal(quote.interestPaise, quote.totalPaise - 10000000);
  });

  it('is deterministic', () => {
    const a = computeEmi(12345678, 9, 11.5);
    const b = computeEmi(12345678, 9, 11.5);
    assert.deepEqual(a, b);
  });
});
