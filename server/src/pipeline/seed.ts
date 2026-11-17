/**
 * Sample data ingestion.
 *
 * Loads the bundled sample catalogue into SQLite so the application has a
 * complete, self-consistent dataset to work with. Everything written here is
 * marked `origin: 'sample'` and is labelled as sample data throughout the UI.
 *
 * Run with:  npm run seed
 */

import { applySchema, closeDb, run, transaction } from '../db/index.ts';
import {
  listListings,
  listReviews,
  saveReviewIntelligence,
  upsertListing,
  upsertOffer,
  upsertProduct,
  upsertReview,
  upsertVariant,
  insertPricePoint,
} from '../db/repositories.ts';
import type {
  Offer,
  PricePoint,
  Product,
  ProductVariant,
  Provenance,
  RetailerListing,
  Review,
} from '../domain/types.ts';
import { normalizeSpecs } from '../intelligence/normalize/specs.ts';
import { buildConfigSignature, buildIdentityKey } from '../intelligence/matching/identity.ts';
import { analyzeReviews, withOwnership } from '../intelligence/reviews/analysis.ts';
import {
  buildSamplePriceHistory,
  buildSampleReviews,
  SAMPLE_LISTINGS,
  SAMPLE_OFFERS,
  SAMPLE_PRODUCTS,
} from './sample-catalogue.ts';
import { SAMPLE_NON_ELECTRONICS } from './sample-catalogue-non-electronics.ts';
import {
  SAMPLE_SHOES,
  SAMPLE_SHOES_LISTINGS,
  SAMPLE_SHOES_OFFERS,
  SAMPLE_SHOES_REVIEWS,
} from './sample-catalogue-shoes.ts';
import {
  SAMPLE_NON_ELECTRONICS_LISTINGS,
  SAMPLE_NON_ELECTRONICS_OFFERS,
  buildNonElectronicsReviews,
} from './sample-catalogue-non-electronics-listings.ts';

const NOW = new Date('2026-11-13T09:00:00.000Z');

/** Product-level spec accumulator, used while merging variant specs. */
const productSpecsCache = new Map<string, Product['specs']>();

function sampleProvenance(source: string, note: string): Provenance {
  return {
    origin: 'sample',
    source,
    observedAt: NOW.toISOString(),
    confidence: 0.5,
    url: null,
    note,
  };
}

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

export interface SeedResult {
  products: number;
  variants: number;
  listings: number;
  offers: number;
  reviews: number;
  pricePoints: number;
}

export function seedSampleData(): SeedResult {
  applySchema();

  // Reset content tables (schema itself is preserved).
  run('DELETE FROM review_intelligence');
  run('DELETE FROM price_points');
  run('DELETE FROM reviews');
  run('DELETE FROM offers');
  run('DELETE FROM retailer_listings');
  run('DELETE FROM product_variants');
  run('DELETE FROM products');

  const result: SeedResult = {
    products: 0,
    variants: 0,
    listings: 0,
    offers: 0,
    reviews: 0,
    pricePoints: 0,
  };

  const variantIdFor = new Map<string, string>();
  const productIdForListing = new Map<string, string>();

  transaction(() => {
    // --- Products and variants --------------------------------------------
    for (const seedProduct of [...SAMPLE_PRODUCTS, ...SAMPLE_NON_ELECTRONICS, ...SAMPLE_SHOES]) {
      const identityKey = buildIdentityKey(seedProduct.brand, seedProduct.model, seedProduct.generation);

      seedProduct.variants.forEach((variant, index) => {
        const specs = normalizeSpecs(variant.specs);
        const configSignature = buildConfigSignature(specs);
        const variantId = `${seedProduct.id}-v${index + 1}`;

        const product: Product = {
          id: seedProduct.id,
          brand: seedProduct.brand,
          model: seedProduct.model,
          displayName: seedProduct.displayName,
          category: seedProduct.category,
          identityKey,
          variantKey: null,
          // The product-level spec set is the union of its variants' specs.
          specs: index === 0 ? specs : mergeSpecs(productSpecsCache.get(seedProduct.id), specs),
          specsVerified: false,
          specSources: ['sample-catalogue'],
          highlights: seedProduct.highlights,
          imageUrl: seedProduct.imageUrl,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        };
        productSpecsCache.set(seedProduct.id, product.specs);

        upsertProduct(product);

        const variantRecord: ProductVariant = {
          id: variantId,
          productId: seedProduct.id,
          label: variant.label,
          configSignature,
          specs,
          partNumber: variant.partNumber ?? null,
          sku: variant.sku ?? null,
          gtin: variant.gtin ?? null,
          colour: variant.colour ?? null,
          imageUrl: seedProduct.imageUrl,
        };
        upsertVariant(variantRecord);
        variantIdFor.set(`${seedProduct.id}:${index}`, variantId);
        result.variants += 1;
      });

      result.products += 1;
    }

    // --- Listings ---------------------------------------------------------
    for (const seedListing of [...SAMPLE_LISTINGS, ...SAMPLE_NON_ELECTRONICS_LISTINGS, ...SAMPLE_SHOES_LISTINGS]) {
      const variantId = variantIdFor.get(`${seedListing.productId}:${seedListing.variantIndex}`);
      if (!variantId) continue;

      const listing: RetailerListing = {
        id: seedListing.id,
        variantId,
        productId: seedListing.productId,
        retailer: seedListing.retailer,
        retailerProductId: seedListing.retailerProductId,
        title: seedListing.title,
        url: seedListing.url,
        listPricePaise: seedListing.listPricePaise,
        mrpPaise: seedListing.mrpPaise,
        condition: seedListing.condition ?? 'new',
        inStock: seedListing.inStock ?? true,
        seller: seedListing.seller ?? null,
        rating: seedListing.rating,
        ratingCount: seedListing.ratingCount,
        reviewCount: seedListing.reviewCount,
        imageUrl: null,
        deliveryFeePaise: seedListing.deliveryFeePaise,
        provenance: sampleProvenance(
          seedListing.retailer,
          'Bundled sample listing for demonstration. Not a live retailer price.',
        ),
        firstSeenAt: daysAgoIso(120),
        lastSeenAt: NOW.toISOString(),
      };
      upsertListing(listing);
      productIdForListing.set(seedListing.id, seedListing.productId);
      result.listings += 1;
    }

    // --- Offers -----------------------------------------------------------
    for (const seedOffer of [...SAMPLE_OFFERS, ...SAMPLE_NON_ELECTRONICS_OFFERS, ...SAMPLE_SHOES_OFFERS]) {
      const conditions: Offer['conditions'] = {
        minSpendPaise: seedOffer.minSpendPaise ?? undefined,
        maxDiscountPaise: seedOffer.maxDiscountPaise ?? undefined,
        paymentMethods: seedOffer.bank ? [seedOffer.bank] : [],
        bank: seedOffer.bank ?? null,
        cardType: seedOffer.cardType ?? null,
        membershipTier: seedOffer.membershipTier ?? null,
        emiTenureMonths: seedOffer.emiTenureMonths ?? null,
        emiInterestRatePercent: seedOffer.emiInterestRatePercent ?? null,
        emiBank: seedOffer.emiBank ?? null,
        requiresExchange: seedOffer.requiresExchange ?? false,
        exchangeBonusPaise: seedOffer.exchangeBonusPaise ?? null,
        couponCode: seedOffer.couponCode ?? null,
        terms: seedOffer.description ?? null,
      };

      const offer: Offer = {
        id: `off-${seedOffer.listingId}-${seedOffer.kind}-${seedOffer.title.slice(0, 18).replace(/\W+/g, '-')}`,
        listingId: seedOffer.listingId,
        kind: seedOffer.kind,
        title: seedOffer.title,
        description: seedOffer.description ?? null,
        percentOff: seedOffer.percentOff ?? null,
        flatOffPaise: seedOffer.flatOffPaise ?? null,
        cashbackPaise: seedOffer.cashbackPaise ?? null,
        conditions,
        stackability: seedOffer.stackability ?? 'stackable',
        automatic: seedOffer.automatic ?? false,
        validityStart: null,
        validityEnd: null,
        provenance: sampleProvenance(
          seedOffer.listingId,
          'Bundled sample offer for demonstration. Not a live retailer offer.',
        ),
      };
      upsertOffer(offer);
      result.offers += 1;
    }

    // --- Reviews ----------------------------------------------------------
    const sampleReviews = [
      ...buildSampleReviews(),
      ...buildNonElectronicsReviews(),
      ...SAMPLE_SHOES_REVIEWS,
    ];
    for (const [index, seedReview] of sampleReviews.entries()) {
      const productId = productIdForListing.get(seedReview.listingId);
      if (!productId) continue;

      const review: Review = {
        id: `rev-${seedReview.listingId}-${index}`,
        listingId: seedReview.listingId,
        productId,
        title: seedReview.title ?? null,
        body: seedReview.body,
        rating: seedReview.rating,
        author: seedReview.author ?? null,
        verifiedPurchase: seedReview.verifiedPurchase,
        reviewedAt: daysAgoIso(seedReview.daysAgo),
        helpfulVotes: seedReview.helpfulVotes ?? null,
        language: seedReview.language,
        aspectRatings: null,
        provenance: sampleProvenance(
          seedReview.listingId,
          'Bundled sample review for demonstration. Not a real customer review.',
        ),
      };
      upsertReview(review);
      result.reviews += 1;
    }

    // --- Price history ----------------------------------------------------
    for (const seedListing of [...SAMPLE_LISTINGS, ...SAMPLE_NON_ELECTRONICS_LISTINGS, ...SAMPLE_SHOES_LISTINGS]) {
      const series = buildSamplePriceHistory(
        seedListing.id,
        seedListing.listPricePaise,
        seedListing.observedDiscountPaise ?? 0,
      );
      for (const point of series) {
        const pricePoint: PricePoint = {
          listingId: seedListing.id,
          pricePaise: point.pricePaise,
          recordedAt: daysAgoIso(point.daysAgo),
          provenance: sampleProvenance(
            seedListing.id,
            'Simulated sample price history for demonstration. Must not be used to time a real purchase.',
          ),
        };
        insertPricePoint(pricePoint);
        result.pricePoints += 1;
      }
    }
  });

  // --- Derived review intelligence ----------------------------------------
  const productIds = new Set(
    [...SAMPLE_LISTINGS, ...SAMPLE_NON_ELECTRONICS_LISTINGS, ...SAMPLE_SHOES_LISTINGS].map((listing) => listing.productId),
  );
  for (const productId of productIds) {
    const reviews = listReviews(productId);
    const intelligence = withOwnership(analyzeReviews(reviews), reviews);
    intelligence.productId = productId;
    saveReviewIntelligence(intelligence);
  }

  return result;
}

/** Merge two normalised spec objects, preferring defined values. */
function mergeSpecs(base: Product['specs'] | undefined, incoming: Product['specs']): Product['specs'] {
  if (!base) return incoming;
  const merged: Product['specs'] = { ...base, extra: { ...base.extra } };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'extra') continue;
    if (merged[key as keyof Product['specs']] === undefined || merged[key as keyof Product['specs']] === null) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  merged.extra = { ...merged.extra, ...incoming.extra };
  return merged;
}

/* ------------------------------------------------------------------ */
/* CLI entry point                                                     */
/* ------------------------------------------------------------------ */

const isDirectRun = process.argv[1]?.includes('seed');
if (isDirectRun) {
  const started = Date.now();
  const result = seedSampleData();
  console.log('[seed] sample catalogue loaded');
  console.log(`[seed] products=${result.products} variants=${result.variants} listings=${result.listings}`);
  console.log(`[seed] offers=${result.offers} reviews=${result.reviews} pricePoints=${result.pricePoints}`);
  console.log(`[seed] completed in ${Date.now() - started}ms`);
  console.log('[seed] all records are marked origin=sample');
  closeDb();
}
