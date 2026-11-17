import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGuardrails,
  citationGate,
  enforceBudget,
  extractPriceClaims,
  redactUnverifiedClaims,
  sampleDataWarning,
  stockGuard,
  stripNonPriceClaims,
  verifyClaims,
} from '../src/ai/guardrails.ts';
import type { PurchaseRequirements } from '../src/domain/types.ts';
import type { Citation } from '../src/ai/tools.ts';

const known = {
  pricesPaise: [6299000, 4699000, 2399000, 200000, 100000],
  ratings: [4.1, 3.8],
  discountPercents: [10, 5],
};

const requirements: PurchaseRequirements = {
  category: 'laptop',
  budgetMinPaise: null,
  budgetMaxPaise: 7000000,
  priorities: {},
  mustHaves: [],
  niceToHaves: [],
  workloads: [],
  rawQuery: 'laptop under ₹70,000',
  missingInfo: [],
};

describe('claim verification (adapted from Aria, Apache-2.0)', () => {
  it('accepts a price we actually hold', () => {
    const result = verifyClaims('The Vivobook costs ₹62,990 at Amazon.in.', known);
    assert.equal(result.violations.length, 0);
  });

  it('flags a fabricated price', () => {
    const result = verifyClaims('It costs ₹9,999.', known);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.kind, 'price_mismatch');
  });

  it('does not treat the user\'s own budget as a price claim', () => {
    // "under ₹70,000" is a limit echo, not a product price.
    const text = 'I found options under ₹70,000.';
    const stripped = stripNonPriceClaims(text);
    assert.equal(extractPriceClaims(stripped).length, 0);
    assert.equal(verifyClaims(text, known).violations.length, 0);
  });

  it('does not treat a price band as a price claim', () => {
    const text = 'Prices sit in the ₹20,000-25,000 range.';
    assert.equal(verifyClaims(text, known).violations.length, 0);
  });

  it('accepts a derived difference between two known prices', () => {
    const text = 'The first is ₹16,000 more than the second.';
    // 6299000 - 4699000 = 1600000 paise = ₹16,000
    assert.equal(verifyClaims(text, known).violations.length, 0);
  });

  it('accepts an approximate price', () => {
    const text = 'It costs around ₹62,990.';
    assert.equal(verifyClaims(text, known).violations.length, 0);
  });

  it('flags a rating we do not hold', () => {
    const result = verifyClaims('It is rated 4.9★.', known);
    assert.equal(result.violations.some((v) => v.kind === 'rating_mismatch'), true);
  });

  it('flags a discount percentage we do not hold', () => {
    const result = verifyClaims('It is 40% off.', known);
    assert.equal(result.violations.some((v) => v.kind === 'discount_mismatch'), true);
  });

  it('redacts an unverifiable price from the text', () => {
    const redacted = redactUnverifiedClaims('It costs ₹9,999 today.', known);
    assert.equal(redacted.includes('₹9,999'), false);
    assert.equal(redacted.includes('[price unavailable]'), true);
  });

  it('leaves a verified price intact when redacting', () => {
    const redacted = redactUnverifiedClaims('It costs ₹62,990 today.', known);
    assert.equal(redacted.includes('₹62,990'), true);
  });
});

describe('citation gate', () => {
  it('rejects a factual answer with no citations', () => {
    const violation = citationGate('It costs ₹62,990 and has 16GB RAM.', []);
    assert.ok(violation);
    assert.equal(violation?.kind, 'missing_citation');
  });

  it('accepts a factual answer with citations', () => {
    const citations: Citation[] = [
      { id: 'l1', kind: 'listing', label: 'Vivobook', origin: 'live' },
    ];
    assert.equal(citationGate('It costs ₹62,990.', citations), null);
  });

  it('accepts an answer with no factual claims and no citations', () => {
    assert.equal(citationGate('I could not find anything matching that.', []), null);
  });
});

describe('budget guard', () => {
  it('removes a recommendation above the budget', () => {
    const items = [
      { productId: 'cheap', bestPricePaise: 4000000 },
      { productId: 'pricey', bestPricePaise: 9000000 },
    ];
    const result = enforceBudget(items, requirements);
    assert.equal(result.kept.length, 1);
    assert.equal(result.removed.length, 1);
    assert.equal(result.violations[0]?.kind, 'budget');
  });

  it('keeps everything when no budget was stated', () => {
    const items = [{ productId: 'a', bestPricePaise: 9000000 }];
    const result = enforceBudget(items, { ...requirements, budgetMaxPaise: null });
    assert.equal(result.kept.length, 1);
    assert.equal(result.violations.length, 0);
  });
});

describe('stock guard', () => {
  it('flags an out-of-stock product presented without a caveat', () => {
    const violation = stockGuard({ outOfStockProductIds: ['p1'], reply: 'Buy the Widget today.' });
    assert.ok(violation);
  });

  it('does not flag a truthful out-of-stock statement', () => {
    const violation = stockGuard({
      outOfStockProductIds: ['p1'],
      reply: 'The Widget is out of stock on that retailer right now.',
    });
    assert.equal(violation, null);
  });
});

describe('sample data warning', () => {
  it('warns when supporting records are sample data', () => {
    const warning = sampleDataWarning([
      { id: 'l1', kind: 'listing', label: 'x', origin: 'sample' },
    ]);
    assert.ok(warning);
    assert.equal(warning?.kind, 'sample_price');
  });

  it('does not warn when everything is live', () => {
    assert.equal(sampleDataWarning([{ id: 'l1', kind: 'listing', label: 'x', origin: 'live' }]), null);
  });
});

describe('guardrail application', () => {
  it('reports the sample-data warning but still returns the answer', () => {
    const result = applyGuardrails({
      reply: 'The Vivobook costs ₹62,990.',
      citations: [{ id: 'l1', kind: 'listing', label: 'x', origin: 'sample' }],
      requirements,
      known,
      hasSampleData: true,
      redact: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.violations.some((v) => v.kind === 'sample_price'), true);
  });

  it('withholds an answer that fails the citation gate', () => {
    const result = applyGuardrails({
      reply: 'It costs ₹62,990 with 16GB RAM.',
      citations: [],
      requirements,
      known,
      hasSampleData: false,
    });
    assert.equal(result.ok, false);
  });
});
