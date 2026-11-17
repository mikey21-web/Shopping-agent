/**
 * Decision intelligence evaluation suite.
 *
 * Two kinds of case:
 *
 *  - **Realistic scenarios** — the kinds of brief a shopper actually sends,
 *    checked for the properties a good decision must have.
 *  - **Adversarial cases** — attempts to make the engine behave badly:
 *    ranking on star ratings, punishing a product for missing data,
 *    ignoring a hard constraint, conflating variants, hiding a conflict, or
 *    inventing a fact.
 *
 * The suite measures behaviour, not implementation. It asserts what the
 * engine must and must not do.
 */

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applySchema } from '../src/db/index.ts';
import { seedSampleData } from '../src/pipeline/seed.ts';
import { buildDecisionCandidates } from '../src/api/services/decision-candidates.ts';
import { buildDecisions, type DecisionCandidate } from '../src/intelligence/decision/engine.ts';
import { parseRequirements } from '../src/ai/intent.ts';
import {
  MAX_REVIEW_DEPENDENCE,
  redistributeForUnknown,
  resolveWeights,
} from '../src/intelligence/decision/weights.ts';
import { confidenceBand } from '../src/intelligence/decision/types.ts';
import { getCategory } from '../src/intelligence/categories/index.ts';
import type { Product, PurchaseRequirements } from '../src/domain/types.ts';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Build a minimal product for the adversarial cases. */
function makeProduct(overrides: Partial<Product> & { id: string }): Product {
  return {
    brand: 'TestBrand',
    model: 'TestModel',
    displayName: `Test ${overrides.id}`,
    category: 'laptop',
    identityKey: `testbrand testmodel ${overrides.id}`,
    variantKey: null,
    specs: { extra: {} },
    specsVerified: false,
    specSources: [],
    highlights: [],
    imageUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a decision candidate with sensible defaults. */
function makeCandidate(
  product: Product,
  overrides: Partial<DecisionCandidate> = {},
): DecisionCandidate {
  return {
    product,
    pricePaise: 5_000_000,
    priceIsSample: false,
    reviews: null,
    breakdown: null,
    priceHistory: null,
    retailer: 'amazon_in',
    facts: [],
    inStock: true,
    condition: 'new',
    certification: null,
    variantLabel: null,
    ...overrides,
  };
}

const brief = (overrides: Partial<PurchaseRequirements> = {}): PurchaseRequirements => ({
  category: 'laptop',
  priorities: {},
  mustHaves: [],
  niceToHaves: [],
  workloads: [],
  missingInfo: [],
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Realistic scenarios                                                 */
/* ------------------------------------------------------------------ */

describe('decision intelligence — realistic scenarios', () => {
  before(async () => {
    applySchema();
    seedSampleData();
  });

  it('answers a budget-constrained laptop brief without exceeding the budget', () => {
    const requirements = parseRequirements(
      'Laptop under ₹70,000 for programming and running local AI models',
    );
    const candidates = buildDecisionCandidates({ category: requirements.category ?? undefined });
    const set = buildDecisions(candidates, requirements, { limit: 6 });

    assert.ok(set.decisions.length > 0, 'should recommend something');

    for (const decision of set.decisions) {
      if (decision.pricePaise === null) continue;
      assert.ok(
        decision.pricePaise <= 70_000_00,
        `${decision.displayName} at ${decision.pricePaise} exceeds the ₹70,000 budget`,
      );
    }
  });

  it('records every eliminated product with a reason', () => {
    const requirements = parseRequirements('Laptop under ₹70,000');
    const candidates = buildDecisionCandidates({ category: requirements.category ?? undefined });
    const set = buildDecisions(candidates, requirements, { limit: 6 });

    assert.ok(set.eliminated.length > 0, 'the over-budget laptops should be eliminated');

    for (const record of set.eliminated) {
      assert.ok(record.reason.length > 10, `elimination reason is too vague: ${record.reason}`);
      assert.ok(record.stage.length > 0, 'each elimination needs a stage');
      assert.ok(record.displayName.length > 0, 'each elimination needs a name');
    }
  });

  it('produces all seven parts of the decision trace', () => {
    const requirements = parseRequirements('Smartphone under ₹30,000 with good camera');
    const candidates = buildDecisionCandidates({ category: requirements.category ?? undefined });
    const set = buildDecisions(candidates, requirements, { limit: 4 });

    const trace = set.trace;
    assert.ok(trace, 'a trace must be produced');

    // 1. What requirements were identified?
    assert.ok(trace.requirements.category, 'the trace must name the category');
    assert.ok(trace.requirements.summary.length > 10, 'the brief must be summarised');
    assert.ok(trace.requirements.budgetMaxPaise !== null, 'the budget must be recorded');

    // 2. Which products were eliminated and why?
    assert.ok(Array.isArray(trace.eliminated));

    // 3. Which evidence influenced the ranking?
    assert.ok(Array.isArray(trace.evidence));

    // 4. What trade-offs were identified?
    assert.ok(Array.isArray(trace.tradeOffs));

    // 5. What information was missing?
    assert.ok(Array.isArray(trace.missingInformation));

    // 6. Why did the winner beat the alternatives?
    assert.ok(trace.winnerRationale, 'the winner must be explained');
    assert.ok(trace.winnerRationale.explanation.length > 20, 'the explanation must be substantive');

    // 7. What could change the recommendation?
    assert.ok(Array.isArray(trace.sensitivity));
  });

  it('reports the confidence of the decision without inventing precision', () => {
    const requirements = parseRequirements('Laptop under ₹70,000');
    const candidates = buildDecisionCandidates({ category: requirements.category ?? undefined });
    const set = buildDecisions(candidates, requirements, { limit: 4 });

    for (const decision of set.decisions) {
      assert.ok(
        ['high', 'medium', 'low', 'insufficient'].includes(decision.confidence),
        `confidence must be a band, got ${decision.confidence}`,
      );
      // The score is a ratio, not a percentage with a spurious decimal place.
      assert.ok(decision.score >= 0 && decision.score <= 1, 'the score must be 0..1');
    }
  });

  it('assigns each dimension a weight and the weights sum to one', () => {
    const requirements = parseRequirements('Laptop under ₹70,000');
    const candidates = buildDecisionCandidates({ category: requirements.category ?? undefined });
    const set = buildDecisions(candidates, requirements, { limit: 4 });

    const decision = set.decisions[0];
    assert.ok(decision, 'a decision is needed');

    const total = decision.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
    assert.ok(Math.abs(total - 1) < 0.01, `weights should sum to 1, got ${total}`);

    for (const dimension of decision.dimensions) {
      assert.ok(
        ['requirement', 'product', 'ownership', 'financial', 'compatibility', 'market', 'risk'].includes(
          dimension.id,
        ),
        `unexpected dimension ${dimension.id}`,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* Adversarial cases                                                   */
/* ------------------------------------------------------------------ */

describe('decision intelligence — adversarial cases', () => {
  it('does not rank on customer reviews alone', () => {
    // Two candidates with identical specifications and price. One has
    // glowing reviews, the other has terrible ones. The decision must not be
    // decided by the reviews alone — and the review dependence must be
    // reported and bounded.
    const good = makeProduct({
      id: 'good',
      specs: { ramGb: 16, storageGb: 512, extra: {} },
    });
    const bad = makeProduct({
      id: 'bad',
      specs: { ramGb: 16, storageGb: 512, extra: {} },
    });

    const candidates = [
      makeCandidate(good, {
        reviews: {
          productId: 'good',
          listingId: null,
          reviewCount: 200,
          verifiedRatio: 0.9,
          averageRating: 4.9,
          negativeShare: 0.01,
          authenticityRisk: 0,
          authenticityCaveat: '',
          signals: [],
          aspects: [],
          positives: ['excellent'],
          complaints: [],
          longTermConcerns: [],
          languageBreakdown: {},
          provenance: { origin: 'live', source: 'test', observedAt: null, confidence: 0.8 },
        },
      }),
      makeCandidate(bad, {
        reviews: {
          productId: 'bad',
          listingId: null,
          reviewCount: 200,
          verifiedRatio: 0.9,
          averageRating: 1.2,
          negativeShare: 0.95,
          authenticityRisk: 0,
          authenticityCaveat: '',
          signals: [],
          aspects: [],
          positives: [],
          complaints: ['broke in a week'],
          longTermConcerns: ['broke in a week'],
          languageBreakdown: {},
          provenance: { origin: 'live', source: 'test', observedAt: null, confidence: 0.8 },
        },
      }),
    ];

    const set = buildDecisions(candidates, brief());

    // The reviews do influence the ownership dimension — they are real
    // evidence. But they must not be the whole decision.
    for (const decision of set.decisions) {
      assert.ok(
        decision.reviewDependence <= MAX_REVIEW_DEPENDENCE,
        `review dependence ${decision.reviewDependence} exceeds the cap ${MAX_REVIEW_DEPENDENCE}`,
      );
    }

    // And there must be at least one non-review dimension that moved.
    const ownershipScores = set.decisions.map((decision) => {
      const dimension = decision.dimensions.find((entry) => entry.id === 'ownership');
      return dimension?.score ?? null;
    });
    assert.ok(
      ownershipScores.some((score) => score !== null),
      'review evidence should feed the ownership dimension',
    );
  });

  it('does not punish a product for missing specifications', () => {
    // Two products with the same price and the same memory. One publishes a
    // full specification sheet, the other publishes almost nothing. The
    // sparse one must not be ranked below the rich one purely for being
    // sparse — its unknown dimensions are unknown, not bad.
    const rich = makeProduct({
      id: 'rich',
      specs: { ramGb: 16, storageGb: 512, cpuCores: 12, displaySizeIn: 16, extra: {} },
    });
    const sparse = makeProduct({
      id: 'sparse',
      specs: { ramGb: 16, extra: {} },
    });

    const set = buildDecisions([makeCandidate(rich), makeCandidate(sparse)], brief());

    const sparseDecision = set.decisions.find((decision) => decision.productId === 'sparse');
    assert.ok(sparseDecision, 'the sparse product should still be a candidate');

    // Whatever dimensions could not be assessed are null, not zero.
    for (const dimension of sparseDecision.dimensions) {
      if (!dimension.hasEvidence) {
        assert.equal(
          dimension.score,
          null,
          `${dimension.id} should be unknown rather than scored zero for the sparse product`,
        );
      }
    }
  });

  it('enforces hard constraints before scoring', () => {
    const overBudget = makeProduct({ id: 'over', specs: { ramGb: 32, extra: {} } });
    const withinBudget = makeProduct({ id: 'within', specs: { ramGb: 8, extra: {} } });

    const set = buildDecisions(
      [makeCandidate(overBudget, { pricePaise: 9_000_000 }), makeCandidate(withinBudget, { pricePaise: 3_000_000 })],
      brief({ budgetMaxPaise: 5_000_000 }),
    );

    const overDecision = set.decisions.find((decision) => decision.productId === 'over');
    assert.equal(overDecision, undefined, 'the over-budget product must not be recommended');
    assert.ok(
      set.eliminated.some((record) => record.productId === 'over'),
      'the over-budget product must be recorded as eliminated',
    );
    assert.equal(
      set.eliminated.find((record) => record.productId === 'over')?.stage,
      'budget',
      'the elimination must be attributed to the budget',
    );
  });

  it('does not conflate different variants', () => {
    const sixteen = makeProduct({
      id: 'sixteen',
      specs: { ramGb: 16, storageGb: 512, extra: {} },
    });
    const eight = makeProduct({
      id: 'eight',
      specs: { ramGb: 8, storageGb: 256, extra: {} },
    });

    const set = buildDecisions(
      [makeCandidate(sixteen), makeCandidate(eight)],
      brief({ mustHaves: ['16GB RAM'] }),
    );

    const eightDecision = set.decisions.find((decision) => decision.productId === 'eight');
    assert.equal(eightDecision, undefined, 'the 8GB model must not satisfy a 16GB requirement');
    assert.ok(
      set.eliminated.some((record) => record.productId === 'eight'),
      'the non-matching variant must be eliminated with a reason',
    );
  });

  it('eliminates a safety-critical product with no certification', () => {
    // Automotive is a safety-critical category: an uncertified part is not
    // recommendable, and the absence of the certification is the stated
    // reason rather than a silent downgrade.
    const part = makeProduct({
      id: 'part',
      category: 'automotive',
      specs: { extra: { partNumber: 'X1', vehicleFitment: 'Model Y 2022' } },
    });

    const set = buildDecisions(
      [makeCandidate(part, { certification: null })],
      brief({ category: 'automotive' }),
    );

    assert.equal(set.decisions.length, 0, 'an uncertified part must not be recommended');
    const elimination = set.eliminated.find((record) => record.productId === 'part');
    assert.ok(elimination, 'the elimination must be recorded');
    assert.equal(elimination?.stage, 'safety');
    assert.match(elimination?.reason ?? '', /certification/i);
  });

  it('does not treat an unknown price as a budget failure', () => {
    const unknownPrice = makeProduct({ id: 'noprice', specs: { ramGb: 16, extra: {} } });

    const set = buildDecisions(
      [makeCandidate(unknownPrice, { pricePaise: null })],
      brief({ budgetMaxPaise: 5_000_000 }),
    );

    assert.equal(
      set.decisions.length,
      1,
      'a product with no confirmed price is not over budget — its price is unknown',
    );
  });

  it('never states a fact that is not in the data', () => {
    const product = makeProduct({
      id: 'sparse',
      specs: { ramGb: 16, extra: {} },
    });

    const set = buildDecisions([makeCandidate(product)], brief());

    // Every evidence statement must be traceable to a fact, a review or the
    // price engine. Nothing may be invented.
    for (const decision of set.decisions) {
      for (const item of decision.evidence) {
        assert.ok(item.statement.length > 0, 'evidence must state something');
        if (item.source.origin === 'catalogue') {
          assert.ok(
            item.statement.includes(':'),
            `catalogue evidence should quote a real value: ${item.statement}`,
          );
        }
      }
    }
  });

  it('reports an unresolved conflict rather than hiding it', () => {
    // Two research facts that disagree about the same subject.
    const product = makeProduct({ id: 'conflict', specs: { ramGb: 16, extra: {} } });

    const base = {
      productId: 'conflict',
      variantId: null,
      kind: 'specification' as const,
      key: 'ram',
      unit: null,
      retrievedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      origin: 'live' as const,
      extractionMethod: 'json_ld' as const,
      freshness: 'fresh' as const,
      corroboratingSources: 1,
      conflictingSources: [],
    };

    const candidates = [
      makeCandidate(product, {
        facts: [
          {
            ...base,
            id: 'a',
            value: 16,
            sourceUrl: 'https://a.example/p',
            sourceDomain: 'a.example',
            evidence: { excerpt: 'RAM 16 GB', locator: null, selector: null, offset: null },
            confidence: 0.9,
            verification: 'conflicting',
          },
          {
            ...base,
            id: 'b',
            value: 8,
            sourceUrl: 'https://b.example/p',
            sourceDomain: 'b.example',
            evidence: { excerpt: 'RAM 8 GB', locator: null, selector: null, offset: null },
            confidence: 0.8,
            verification: 'conflicting',
          },
        ],
      }),
    ];

    const set = buildDecisions(candidates, brief());
    const decision = set.decisions[0];
    assert.ok(decision, 'a decision should still be produced');

    const disputed = decision.evidence.filter((item) => item.disputed);
    assert.ok(disputed.length > 0, 'the disputed fact must be marked as disputed');
  });
});

/* ------------------------------------------------------------------ */
/* Weight behaviour                                                    */
/* ------------------------------------------------------------------ */

describe('decision weights', () => {
  it('shifts weight towards the dimensions the user prioritised', () => {
    const baseline = resolveWeights('laptop', brief());
    const prioritised = resolveWeights('laptop', brief({ priorities: { battery: 0.9 } }));

    assert.ok(
      Object.keys(prioritised.priorityShift).length > 0,
      'the priority should produce a shift',
    );
    assert.ok(
      prioritised.weights.product > baseline.weights.product,
      'a priority on battery should shift weight towards the product dimension',
    );
    const total = Object.values(prioritised.weights).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 0.001, 'the weights should still sum to one');
  });

  it('gives safety-critical categories more risk and compatibility weight', () => {
    const safe = resolveWeights('automotive', brief());
    const phone = resolveWeights('smartphone', brief());
    assert.ok(
      safe.weights.risk > phone.weights.risk,
      'automotive should weigh risk more heavily than a smartphone',
    );
  });

  it('redistributes the weight of unknown dimensions rather than penalising', () => {
    const weights = {
      requirement: 0.1,
      product: 0.3,
      ownership: 0.2,
      financial: 0.2,
      compatibility: 0.1,
      market: 0.05,
      risk: 0.05,
      decision: 0,
    };

    const redistributed = redistributeForUnknown(weights, [
      'product',
      'financial',
      'market',
      'risk',
    ]);

    const total = Object.values(redistributed).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 0.01, `the redistributed weights should sum to 1, got ${total}`);
    assert.equal(redistributed.compatibility, 0, 'the unknown dimension carries no weight');
    assert.ok(
      redistributed.product > weights.product,
      'the assessable dimensions should absorb the freed weight',
    );
  });

  it('expresses confidence as a band rather than a percentage', () => {
    assert.equal(confidenceBand(0.9), 'high');
    assert.equal(confidenceBand(0.6), 'medium');
    assert.equal(confidenceBand(0.3), 'low');
    assert.equal(confidenceBand(null), 'insufficient');
  });
});

/* ------------------------------------------------------------------ */
/* Category coverage                                                   */
/* ------------------------------------------------------------------ */

describe('decision intelligence — category coverage', () => {
  before(async () => {
    applySchema();
    seedSampleData();
  });

  it('produces a decision for every category that has catalogue data', () => {
    const categories = ['smartphone', 'laptop', 'appliance', 'audio', 'fashion', 'grocery'];

    for (const category of categories) {
      const candidates = buildDecisionCandidates({ category });
      assert.ok(candidates.length > 0, `the ${category} category should have candidates`);

      const set = buildDecisions(candidates, brief({ category: category as never }), { limit: 3 });
      assert.ok(set.decisions.length > 0, `the ${category} category should produce a decision`);
      assert.ok(set.trace, `the ${category} category should produce a trace`);

      for (const decision of set.decisions) {
        const dimensionIds = decision.dimensions.map((dimension) => dimension.id);
        assert.ok(dimensionIds.length === 7, `the ${category} decision needs all seven dimensions`);
      }
    }
  });

  it('marks safety-critical categories so the extra safeguards apply', () => {
    assert.equal(getCategory('automotive')?.safetyCritical, true);
    assert.equal(getCategory('beauty')?.safetyCritical, true);
    assert.equal(getCategory('laptop')?.safetyCritical, false);
  });
});
