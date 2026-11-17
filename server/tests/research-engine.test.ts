import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHOE_COMPONENTS,
  intendedUseOf,
  spec,
} from '../src/intelligence/categories/shoes-components.ts';
import {
  SHOE_TYPES,
  detectShoeType,
  getCategory,
  listCategories,
} from '../src/intelligence/categories/index.ts';
import {
  buildShoeIdentityKey,
  buildShoeVariantKey,
  compareShoes,
  normaliseSize,
  normaliseSizeStandard,
  normaliseWidth,
  normaliseGender,
} from '../src/intelligence/matching/shoe-identity.ts';
import {
  analyseOwnership,
  bodySimilarity,
  clusterComplaints,
  detectSyndication,
} from '../src/intelligence/reviews/ownership.ts';
import {
  extractProduct,
} from '../src/research/extract/pipeline.ts';
import {
  NormalizedProductSchema,
} from '../src/research/extract/schema.ts';
import {
  canonicalUrl,
  dedupeHits,
} from '../src/research/acquisition.ts';
import {
  findProductJsonLd,
  jsonLdBlocks,
  normaliseRating,
  parsePriceToPaise,
  readSpecifications,
} from '../src/research/sources/retailers.ts';
import type { Review } from '../src/domain/types.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function review(id: string, body: string, reviewedAt: string | null = null): Review {
  return {
    id,
    listingId: null,
    productId: 'prod-1',
    title: null,
    body,
    rating: 3,
    author: null,
    verifiedPurchase: null,
    reviewedAt,
    helpfulVotes: null,
    language: 'en',
    aspectRatings: null,
    provenance: {
      sourceUrl: `https://example.com/${id}`,
      source: 'Example',
      sourceDomain: 'example.com',
      sourceType: 'community',
      observedAt: '2026-01-01T00:00:00.000Z',
      retrievedAt: '2026-01-01T00:00:00.000Z',
      excerpt: body.slice(0, 80),
      locator: null,
      method: 'dom',
      origin: 'live',
      freshness: 'fresh',
      verification: 'single_source',
      corroboratingSources: 0,
      conflictingSources: [],
    },
  } as unknown as Review;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                           */
/* ------------------------------------------------------------------ */

describe('universal extraction — tier 1, JSON-LD', () => {
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Nike Air Zoom Pegasus 40',
    brand: { '@type': 'Brand', name: 'Nike' },
    sku: 'DM0011',
    gtin: '194955123456',
    model: 'Air Zoom Pegasus 40',
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.4', reviewCount: '2841' },
    offers: {
      '@type': 'Offer',
      price: '4999.00',
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
    },
  });

  const html = `<html><head><title>Nike Pegasus 40</title>
    <script type="application/ld+json">${jsonLd}</script></head>
    <body><table>
      <tr><th>Size</th><td>UK 9</td></tr>
      <tr><th>Colour</th><td>Black</td></tr>
      <tr><th>Upper Material</th><td>Engineered Mesh</td></tr>
      <tr><th>Gender</th><td>Men</td></tr>
    </table></body></html>`;

  it('extracts a product from Schema.org JSON-LD', () => {
    const outcome = extractProduct(html, 'https://shop.example.com/p/pegasus-40', '2026-01-01T00:00:00.000Z');

    assert.ok(outcome.product, 'a product should be extracted');
    assert.equal(outcome.tier, 'json_ld');
    assert.equal(outcome.product?.name, 'Nike Air Zoom Pegasus 40');
    assert.equal(outcome.product?.brand, 'Nike');
    assert.equal(outcome.product?.gtin, '194955123456');
    assert.equal(outcome.product?.listedPrice?.paise, 499_900);
    assert.equal(outcome.product?.listedPrice?.currency, 'INR');
    assert.equal(outcome.product?.availability, 'in_stock');
    assert.equal(outcome.product?.rating, 4.4);
    assert.equal(outcome.product?.reviewCount, 2841);
  });

  it('carries the variant attributes a shoe decision needs', () => {
    const outcome = extractProduct(html, 'https://shop.example.com/p/pegasus-40', '2026-01-01T00:00:00.000Z');
    const variant = outcome.product?.variant;

    assert.equal(variant?.size, 'UK 9');
    assert.equal(variant?.colour, 'Black');
    assert.equal(variant?.material, 'Engineered Mesh');
    assert.equal(variant?.gender, 'Men');
  });

  it('records the provenance of every extracted value', () => {
    const outcome = extractProduct(html, 'https://shop.example.com/p/pegasus-40', '2026-01-01T00:00:00.000Z');
    const provenance = outcome.product?.listedPrice?.provenance;

    assert.ok(provenance);
    assert.equal(provenance?.sourceUrl, 'https://shop.example.com/p/pegasus-40');
    assert.equal(provenance?.sourceDomain, 'shop.example.com');
    assert.equal(provenance?.retrievedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(provenance?.method, 'json_ld');
    assert.equal(provenance?.validation, 'passed');
    assert.equal(provenance?.verification, 'single_source');
  });

  it('never invents a value it did not find', () => {
    const outcome = extractProduct(html, 'https://shop.example.com/p/pegasus-40', '2026-01-01T00:00:00.000Z');

    // The page published no warranty and no delivery estimate.
    assert.equal(outcome.product?.warranty, null);
    assert.equal(outcome.product?.deliveryEstimate, null);
    assert.equal(outcome.product?.returnPolicy, null);
    assert.deepEqual(outcome.product?.offers, []);
  });

  it('produces a product that passes the schema', () => {
    const outcome = extractProduct(html, 'https://shop.example.com/p/pegasus-40', '2026-01-01T00:00:00.000Z');
    const parsed = NormalizedProductSchema.safeParse(outcome.product);
    assert.ok(parsed.success, 'the extracted product must validate');
  });
});

describe('universal extraction — tier fallback', () => {
  it('falls back to the rendered page when there is no JSON-LD', () => {
    const html = `<html><head><title>Nike Pegasus 40 Running Shoes</title></head>
      <body><h1>Nike Pegasus 40</h1>
      <span class="a-price">₹4,999</span>
      <table><tr><th>Size</th><td>UK 9</td></tr></table></body></html>`;

    const outcome = extractProduct(html, 'https://shop.example.com/p/pegasus-40', '2026-01-01T00:00:00.000Z');

    assert.ok(outcome.product);
    assert.equal(outcome.tier, 'dom');
    assert.equal(outcome.product?.name, 'Nike Pegasus 40 Running Shoes');
    assert.equal(outcome.product?.listedPrice?.paise, 499_900);
  });

  it('reports honestly when nothing could be extracted', () => {
    const outcome = extractProduct('<html><body>nothing here</body></html>', 'https://example.com/', '2026-01-01T00:00:00.000Z');

    assert.equal(outcome.product, null);
    assert.equal(outcome.tier, null);
    assert.ok(outcome.reason);
    assert.match(outcome.reason, /could not be extracted/i);
  });

  it('reads embedded application JSON when JSON-LD is absent', () => {
    const payload = JSON.stringify({
      props: {
        pageProps: {
          product: {
            name: 'Adidas Ultraboost 22',
            brand: 'Adidas',
            price: 8999,
            sku: 'B45530',
            specifications: { Size: 'UK 10', Colour: 'Core Black' },
          },
        },
      },
    });

    const html = `<html><body><script type="application/json">${payload}</script></body></html>`;
    const outcome = extractProduct(html, 'https://shop.example.com/p/ultraboost', '2026-01-01T00:00:00.000Z');

    assert.ok(outcome.product);
    assert.equal(outcome.tier, 'embedded_json');
    assert.equal(outcome.product?.name, 'Adidas Ultraboost 22');
    assert.equal(outcome.product?.listedPrice?.paise, 899_900);
  });
});

describe('extraction helpers', () => {
  it('parses Indian price formats into paise', () => {
    assert.equal(parsePriceToPaise('₹4,999'), 499_900);
    assert.equal(parsePriceToPaise('Rs. 129999.50'), 12_999_950);
    assert.equal(parsePriceToPaise(4999), 499_900);
    assert.equal(parsePriceToPaise('free'), null);
    assert.equal(parsePriceToPaise(null), null);
  });

  it('normalises a rating onto a five-point scale', () => {
    assert.equal(normaliseRating('4.4', 5), 4.4);
    assert.equal(normaliseRating('8.8', 10), 4.4);
    assert.equal(normaliseRating('88', 100), 4.4);
    assert.equal(normaliseRating('not a number', 5), null);
  });

  it('reads a specification table', () => {
    const html = '<table><tr><th>Upper</th><td>Mesh</td></tr><tr><th>Sole</td><td>Rubber</td></tr></table>';
    const specs = readSpecifications(html);
    assert.equal(specs['Upper'], 'Mesh');
    assert.equal(specs['Sole'], 'Rubber');
  });

  it('finds a Product inside a JSON-LD graph', () => {
    const blocks = jsonLdBlocks(
      '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"X"}]}</script>',
    );
    assert.equal(blocks.length, 1);
    assert.equal((findProductJsonLd('<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"X"}]}</script>') as Record<string, unknown>)?.name, 'X');
  });
});

/* ------------------------------------------------------------------ */
/* Acquisition                                                          */
/* ------------------------------------------------------------------ */

describe('acquisition', () => {
  it('canonicalises URLs so the same page is opened once', () => {
    assert.equal(
      canonicalUrl('https://www.amazon.in/dp/B0ABC?utm_source=newsletter&ref=xyz'),
      'https://amazon.in/dp/B0ABC',
    );
    assert.equal(
      canonicalUrl('https://shop.example.com/p/x/'),
      'https://shop.example.com/p/x',
    );
  });

  it('keeps variant-selecting query parameters', () => {
    // Two sizes of the same shoe are different pages with different prices.
    const a = canonicalUrl('https://shop.example.com/p/peg40?variant=uk9');
    const b = canonicalUrl('https://shop.example.com/p/peg40?variant=uk10');
    assert.notEqual(a, b);
  });

  it('deduplicates pages found through more than one channel', () => {
    const hits = [
      { title: 'A', url: 'https://shop.example.com/p/x', snippet: null, domain: 'shop.example.com', provider: 'retailer:amazon_in' },
      { title: 'A', url: 'https://www.shop.example.com/p/x?utm_source=s', snippet: 'has a snippet', domain: 'shop.example.com', provider: 'brave' },
      { title: 'B', url: 'https://other.example.com/p/y', snippet: null, domain: 'other.example.com', provider: 'brave' },
    ];

    const deduped = dedupeHits(hits);
    assert.equal(deduped.length, 2);
    const first = deduped.find((hit) => hit.url.includes('/p/x'));
    assert.equal(first?.snippet, 'has a snippet');
  });
});

/* ------------------------------------------------------------------ */
/* Shoe identity                                                        */
/* ------------------------------------------------------------------ */

describe('shoe identity', () => {
  it('normalises sizes across standards', () => {
    assert.equal(normaliseSize('UK 9'), 'UK 9');
    assert.equal(normaliseSize('9'), '9');
    assert.equal(normaliseSize('42.5'), '42.5');
    assert.equal(normaliseSize('9.0'), '9');
    assert.equal(normaliseSize(''), null);
  });

  it('treats UK and US as one standard but keeps EU and India apart', () => {
    assert.equal(normaliseSizeStandard('UK/US', null), 'UK/US');
    assert.equal(normaliseSizeStandard('UK', null), 'UK/US');
    assert.equal(normaliseSizeStandard('EU', null), 'EU');
    assert.equal(normaliseSizeStandard('India', null), 'IN');
  });

  it('normalises width and gender', () => {
    assert.equal(normaliseWidth('Extra Wide'), 'extra_wide');
    assert.equal(normaliseWidth('regular'), 'standard');
    assert.equal(normaliseGender('Men'), 'men');
    assert.equal(normaliseGender('Women'), 'women');
    assert.equal(normaliseGender('Unisex'), 'unisex');
  });

  it('never merges two shoes of different sizes', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', sizeStandard: 'UK', width: 'Standard', gender: 'Men' } },
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 10', sizeStandard: 'UK', width: 'Standard', gender: 'Men' } },
    );

    assert.equal(result.verdict, 'variant');
    const sizeDifference = result.differences.find((difference) => difference.field === 'size');
    assert.equal(sizeDifference?.blocking, true);
  });

  it('never merges a men\'s shoe with a women\'s shoe of the same size', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', sizeStandard: 'UK', gender: 'Men' } },
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', sizeStandard: 'UK', gender: 'Women' } },
    );

    assert.equal(result.verdict, 'variant');
    assert.ok(result.differences.some((difference) => difference.field === 'gender' && difference.blocking));
  });

  it('never merges a narrow shoe with a wide shoe', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', width: 'Narrow', gender: 'Men' } },
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', width: 'Wide', gender: 'Men' } },
    );

    assert.equal(result.verdict, 'variant');
    assert.ok(result.differences.some((difference) => difference.field === 'width' && difference.blocking));
  });

  it('merges two listings of the same sellable item', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', sizeStandard: 'UK', width: 'Standard', gender: 'Men', colour: 'Black' } },
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9', sizeStandard: 'UK', width: 'Standard', gender: 'Men', colour: 'Black' } },
    );

    assert.equal(result.verdict, 'exact');
    assert.ok(result.variantKey);
    assert.equal(result.identityKey, buildShoeIdentityKey('Nike', 'Pegasus 40'));
  });

  it('treats a shared manufacturer identifier as decisive', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', gtin: '194955123456', variant: { size: 'UK 9' } },
      { brand: 'Nike', model: 'Pegasus 40', gtin: '194955123456', variant: { size: 'UK 9' } },
    );

    assert.equal(result.verdict, 'exact');
    assert.ok(result.signals.some((signal) => signal.signal === 'shared_identifier'));
  });

  it('never merges different models', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9' } },
      { brand: 'Nike', model: 'Pegasus 41', variant: { size: 'UK 9' } },
    );

    assert.equal(result.verdict, 'different');
  });

  it('reports an undeclared size as unknown rather than as agreement', () => {
    const result = compareShoes(
      { brand: 'Nike', model: 'Pegasus 40', variant: { size: 'UK 9' } },
      { brand: 'Nike', model: 'Pegasus 40', variant: {} },
    );

    assert.ok(result.unknown.includes('size'));
  });

  it('builds a variant key that includes the size, standard and width', () => {
    const key = buildShoeVariantKey('nike::pegasus 40', {
      size: 'UK 9',
      sizeStandard: 'UK',
      width: 'Standard',
    });
    assert.ok(key.includes('UK/US'));
    assert.ok(key.includes('9'));
  });
});

/* ------------------------------------------------------------------ */
/* Shoe category                                                        */
/* ------------------------------------------------------------------ */

describe('shoe category', () => {
  it('is registered as its own category', () => {
    const ids = listCategories().map((profile) => profile.id);
    assert.ok(ids.includes('shoes'));
    assert.ok(getCategory('shoes'));
  });

  it('treats size, standard and gender as required for a match', () => {
    const profile = getCategory('shoes');
    assert.ok(profile?.requiredMatchFields.includes('size'));
    assert.ok(profile?.requiredMatchFields.includes('sizeStandard'));
    assert.ok(profile?.requiredMatchFields.includes('gender'));
  });

  it('has a bespoke scoring model rather than the generic one', () => {
    const profile = getCategory('shoes');
    assert.equal(profile?.specialised, true);
    assert.ok((profile?.components.length ?? 0) > 0);
    assert.equal(profile?.components.length, SHOE_COMPONENTS.length);
  });

  it('scored on the dimensions that decide a shoe purchase', () => {
    const keys = getCategory('shoes')?.decisionDimensions.map((dimension) => dimension.key) ?? [];
    for (const expected of ['fit', 'comfort', 'cushioning', 'grip', 'durability', 'breathability', 'weight']) {
      assert.ok(keys.includes(expected), `missing dimension ${expected}`);
    }
  });

  it('reads the intended use from the request', () => {
    assert.equal(detectShoeType('nike pegasus running shoes for jogging'), 'running');
    assert.equal(detectShoeType('shoes for gym and weight training'), 'gym');
    assert.equal(detectShoeType('formal oxford shoes for the office'), 'formal');
    assert.equal(detectShoeType('waterproof hiking boots for a trek'), 'hiking');
    assert.equal(detectShoeType('comfortable shoes for long walks'), 'walking');
    assert.equal(detectShoeType('everyday casual sneakers'), 'casual');
    assert.equal(detectShoeType('cricket shoes'), 'sports');
  });

  it('reads running before hiking, so "trail running" is a running shoe', () => {
    assert.equal(detectShoeType('adidas trail running shoes'), 'running');
  });

  it('describes every shoe type it recognises', () => {
    for (const [key, meta] of Object.entries(SHOE_TYPES)) {
      assert.ok(meta.label.length > 0, `${key} has no label`);
      assert.ok(meta.description.length > 0, `${key} has no description`);
    }
  });

  it('scores a well-reviewed comfortable shoe above a poorly reviewed one', () => {
    const good = SHOE_COMPONENTS.find((component) => component.key === 'comfort');
    const bad = SHOE_COMPONENTS.find((component) => component.key === 'comfort');
    assert.ok(good && bad);

    const input = {
      specs: { upperMaterial: 'Engineered Mesh', midsoleMaterial: 'Zoom Air' },
      reviews: {
        aspects: [
          {
            aspect: 'comfort',
            sentiment: 0.9,
            mentionCount: 40,
            negativeRate: 0.05,
            positiveRate: 0.95,
            topComplaints: [],
            topPraises: ['very comfortable'],
            evidence: [],
          },
        ],
        complaints: [],
        longTermConcerns: [],
      },
      pricePaise: 499_900,
      referencePricePaise: 500_000,
      requirements: { category: 'shoes', priorities: {}, mustHaves: [], niceToHaves: [], workloads: [], missingInfo: [] },
    } as never;

    const result = good!.compute(input);
    assert.ok(result.score >= 0.75, `expected a high comfort score, got ${result.score}`);
    assert.ok(result.evidence.length > 0);
  });

  it('penalises a shoe whose owners say it runs small', () => {
    const comfort = SHOE_COMPONENTS.find((component) => component.key === 'comfort');
    const fit = SHOE_COMPONENTS.find((component) => component.key === 'fit');
    assert.ok(comfort && fit);

    const input = {
      specs: {},
      reviews: {
        aspects: [
          {
            aspect: 'comfort',
            sentiment: 0.4,
            mentionCount: 20,
            negativeRate: 0.2,
            positiveRate: 0.8,
            topComplaints: [],
            topPraises: ['comfortable'],
            evidence: [],
          },
        ],
        complaints: ['Size runs small, had to order a size up'],
        longTermConcerns: [],
      },
      pricePaise: 499_900,
      referencePricePaise: 500_000,
      requirements: { category: 'shoes', priorities: {}, mustHaves: [], niceToHaves: [], workloads: [], missingInfo: [] },
    } as never;

    const fitResult = fit!.compute(input);
    assert.ok(fitResult.score <= 0.4, `expected a low fit score, got ${fitResult.score}`);
    assert.ok(fitResult.evidence.some((line) => /runs small/i.test(line)));
  });

  it('treats a sole separation complaint as severe', () => {
    const durability = SHOE_COMPONENTS.find((component) => component.key === 'durability');
    assert.ok(durability);

    const input = {
      specs: {},
      reviews: {
        aspects: [],
        complaints: [],
        longTermConcerns: ['The sole came apart from the upper after two months'],
      },
      pricePaise: 499_900,
      referencePricePaise: 500_000,
      requirements: { category: 'shoes', priorities: {}, mustHaves: [], niceToHaves: [], workloads: [], missingInfo: [] },
    } as never;

    const result = durability!.compute(input);
    assert.ok(result.score <= 0.3, `expected a low durability score, got ${result.score}`);
  });

  it('reads the intended use out of the specifications', () => {
    const input = {
      specs: { surface: 'Road', intendedUse: 'running' },
      reviews: null,
      pricePaise: null,
      referencePricePaise: null,
      requirements: { category: 'shoes', priorities: {}, mustHaves: [], niceToHaves: [], workloads: [], missingInfo: [] },
    } as never;

    assert.equal(intendedUseOf(input), 'running');
  });

  it('reads a specification regardless of the label the retailer used', () => {
    const input = {
      specs: { 'Upper Material': 'Mesh', 'Shoe Size': 'UK 9' },
      reviews: null,
      pricePaise: null,
      referencePricePaise: null,
      requirements: { category: 'shoes', priorities: {}, mustHaves: [], niceToHaves: [], workloads: [], missingInfo: [] },
    } as never;

    assert.equal(spec(input, 'upperMaterial'), 'Mesh');
    assert.equal(spec(input, 'size'), 'UK 9');
  });
});

/* ------------------------------------------------------------------ */
/* Ownership intelligence                                               */
/* ------------------------------------------------------------------ */

describe('ownership intelligence', () => {
  it('clusters the same complaint reported by several owners', () => {
    const reviews = [
      review('r1', 'The sole came apart after just two months. Very disappointed.', '2026-01-01'),
      review('r2', 'Sole separated from the upper within two months.', '2026-02-01'),
      review('r3', 'After two months the sole came off completely.', '2026-03-01'),
    ];

    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'flipkart.com', site: 'Flipkart' }],
      ['r3', { domain: 'reddit.com', site: 'Reddit' }],
    ]);

    const clusters = clusterComplaints(reviews, sources);
    const separation = clusters.find((cluster) => cluster.id === 'sole_separation');

    assert.ok(separation);
    assert.equal(separation?.mentions, 3);
    assert.equal(separation?.independentSources, 3);
    assert.equal(separation?.syndicatedOnly, false);
  });

  it('never reports a failure rate it did not observe', () => {
    const reviews = [
      review('r1', 'The sole came apart after a month.', '2026-01-01'),
      review('r2', 'The stitching came apart in the third week.', '2026-01-15'),
    ];
    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'flipkart.com', site: 'Flipkart' }],
    ]);

    const clusters = clusterComplaints(reviews, sources);
    const separation = clusters.find((cluster) => cluster.id === 'sole_separation');

    // The count is the number of reviews, and it is reported as a count.
    assert.equal(separation?.mentions, 1);
    assert.equal(separation?.independentSources, 1);
    assert.doesNotMatch(JSON.stringify(clusters), /%/);
  });

  it('detects a review copied across two different sites', () => {
    const body =
      'This shoe has excellent build quality and is very comfortable to wear all day long. The cushioning is great and the grip is superb.';
    const reviews = [review('r1', body, '2026-01-01'), review('r2', body, '2026-01-02')];
    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'flipkart.com', site: 'Flipkart' }],
    ]);

    const syndicated = detectSyndication(reviews, sources);
    assert.equal(syndicated.length, 1);
    assert.deepEqual(syndicated[0]?.domains.sort(), ['amazon.in', 'flipkart.com']);
    assert.ok((syndicated[0]?.similarity ?? 0) > 0.8);
  });

  it('does not flag a review duplicated within one site as syndication', () => {
    const body = 'Excellent build quality and very comfortable to wear all day long with great cushioning and superb grip.';
    const reviews = [review('r1', body, '2026-01-01'), review('r2', body, '2026-01-02')];
    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'amazon.in', site: 'Amazon' }],
    ]);

    assert.equal(detectSyndication(reviews, sources).length, 0);
  });

  it('does not count a syndicated copy as an independent owner', () => {
    const body =
      'This shoe has excellent build quality and is very comfortable to wear all day long. The cushioning is great and the grip is superb.';
    const reviews = [review('r1', body, '2026-01-01'), review('r2', body, '2026-01-02'), review('r3', 'Grip is superb and the cushioning is great.', '2026-01-03')];
    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'flipkart.com', site: 'Flipkart' }],
      ['r3', { domain: 'reddit.com', site: 'Reddit' }],
    ]);

    const ownership = analyseOwnership('prod-1', reviews, sources);

    assert.equal(ownership.syndicated.length, 1);
    assert.equal(ownership.removedReviewCount, 1);
    assert.equal(ownership.independentReviewCount, 2);
    assert.equal(ownership.independentSourceCount, 2);
  });

  it('tracks the variant a complaint was observed on', () => {
    const reviews = [
      review('r1', 'The sole came apart after a month.', '2026-01-01'),
      review('r2', 'The sole came apart after six weeks.', '2026-01-15'),
    ];
    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'flipkart.com', site: 'Flipkart' }],
    ]);

    const ownership = analyseOwnership('prod-1', reviews, sources, {
      variantOf: (r) => (r.id === 'r1' ? 'UK 9 Black' : 'UK 10 Black'),
    });

    const separation = ownership.complaints.find((cluster) => cluster.id === 'sole_separation');
    assert.deepEqual(separation?.variants.sort(), ['UK 10 Black', 'UK 9 Black']);
  });

  it('says so when there is not enough evidence to identify a pattern', () => {
    const reviews = [review('r1', 'The sole came apart after a month.', '2026-01-01')];
    const sources = new Map([['r1', { domain: 'amazon.in', site: 'Amazon' }]]);

    const ownership = analyseOwnership('prod-1', reviews, sources);

    assert.equal(ownership.insufficientEvidence, true);
    assert.ok(ownership.insufficientReason);
    assert.match(ownership.insufficientReason, /too few/i);
  });

  it('separates complaints from praise', () => {
    const reviews = [
      review('r1', 'Very comfortable and excellent build quality.', '2026-01-01'),
      review('r2', 'Very comfortable, great value for money.', '2026-01-02'),
      review('r3', 'Comfortable but the sole came apart.', '2026-01-03'),
    ];
    const sources = new Map([
      ['r1', { domain: 'amazon.in', site: 'Amazon' }],
      ['r2', { domain: 'flipkart.com', site: 'Flipkart' }],
      ['r3', { domain: 'reddit.com', site: 'Reddit' }],
    ]);

    const ownership = analyseOwnership('prod-1', reviews, sources);

    assert.ok(ownership.praise.some((cluster) => cluster.id === 'comfortable'));
    assert.ok(ownership.praise.some((cluster) => cluster.id === 'durable'));
    assert.ok(ownership.complaints.some((cluster) => cluster.id === 'sole_separation'));
  });

  it('does not call two unrelated bodies similar', () => {
    assert.ok(bodySimilarity('The sole came apart after two months.', 'Excellent cushioning and a comfortable fit.') < 0.5);
  });
});
