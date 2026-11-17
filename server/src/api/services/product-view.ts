/**
 * Product view assembly.
 *
 * Combines the stored records with the intelligence engines to produce the
 * payload the UI renders: every listing with its full offer breakdown, the
 * best payable price across retailers, the price history verdict, review
 * intelligence, and cross-retailer variant matches.
 */

import type {
  BuyWaitAssessment,
  PriceBreakdown,
  PriceStats,
  Product,
  PurchaseRequirements,
  ReviewIntelligence,
  RetailerListing,
} from '../../domain/types.ts';
import {
  getProduct,
  getReviewIntelligence,
  listListings,
  listOffers,
  listPricePoints,
  listVariants,
  listReviews,
} from '../../db/repositories.ts';
import { computePriceBreakdown, type ShopperContext } from '../../intelligence/pricing/offers.ts';
import { assessBuyWait, computePriceStats } from '../../intelligence/pricehistory/stats.ts';
import { analyzeReviews, withOwnership } from '../../intelligence/reviews/analysis.ts';
import {
  compareVariants,
  signatureFromVariant,
  toVariantSignature,
  verdictRank,
} from '../../intelligence/matching/identity.ts';
import { formatPaise } from '../../intelligence/normalize/specs.ts';

export interface ListingView {
  listing: RetailerListing;
  breakdown: PriceBreakdown;
  priceStats: PriceStats | null;
  buyWait: BuyWaitAssessment;
  /** True when this listing is the cheapest on its guaranteed payable price. */
  isBestPrice: boolean;
  /** Effective discount versus MRP, 0..1. */
  discountVsMrp: number;
}

export interface VariantMatchView {
  listingId: string;
  variantId: string;
  verdict: string;
  confidence: number;
  explanation: string;
  differences: string[];
}

export interface ProductView {
  product: Product;
  variants: { id: string; label: string; configSignature: string }[];
  listings: ListingView[];
  bestListingId: string | null;
  bestPayablePaise: number | null;
  bestPriceIsSample: boolean;
  reviewIntelligence: ReviewIntelligence | null;
  /** Matches between listings of this product on different retailers. */
  matches: VariantMatchView[];
  /** Prices seen across retailers, for the comparison table. */
  priceRange: { minPaise: number; maxPaise: number } | null;
  dataQualityNotes: string[];
}

export interface BuildProductViewOptions {
  /** The shopper's context, used to evaluate conditional offers. */
  shopper?: ShopperContext;
  /** Skip the price history computation (cheaper for list views). */
  includePriceHistory?: boolean;
}

/**
 * Build the full intelligence view for one product.
 */
export function buildProductView(productId: string, options: BuildProductViewOptions = {}): ProductView | null {
  const product = getProduct(productId);
  if (!product) return null;

  const includeHistory = options.includePriceHistory !== false;
  const shopper = options.shopper ?? {};
  const listings = listListings(productId);
  const variants = listVariants(productId);

  const views: ListingView[] = listings.map((listing) => {
    const offers = listOffers(listing.id);
    const breakdown = computePriceBreakdown(listing, offers, shopper);
    const points = includeHistory ? listPricePoints(listing.id) : [];
    const stats = computePriceStats(points);
    const buyWait = assessBuyWait(stats, {
      retailer: listing.retailer,
      isSample: listing.provenance.origin === 'sample',
      currentDiscountPaise: breakdown.potentialDiscountPaise,
    });
    const discountVsMrp =
      listing.mrpPaise && listing.mrpPaise > 0
        ? Math.max(0, (listing.mrpPaise - breakdown.payablePaise) / listing.mrpPaise)
        : 0;
    return {
      listing,
      breakdown,
      priceStats: stats,
      buyWait,
      isBestPrice: false,
      discountVsMrp,
    };
  });

  // The best price is the lowest *guaranteed* payable amount.
  const priced = views.filter((view) => view.listing.inStock && view.breakdown.payablePaise > 0);
  const best = priced.sort((a, b) => a.breakdown.payablePaise - b.breakdown.payablePaise)[0] ?? null;
  if (best) best.isBestPrice = true;

  // Review intelligence: prefer the stored analysis, recompute if missing.
  let intelligence = getReviewIntelligence(productId);
  if (!intelligence) {
    const reviews = listReviews(productId);
    intelligence = withOwnership(analyzeReviews(reviews), reviews);
    intelligence.productId = productId;
  }

  // Cross-retailer variant matching.
  const matches = buildMatches(listings);

  const prices = views.map((view) => view.breakdown.payablePaise).filter((price) => price > 0);

  const notes: string[] = [];
  if (views.some((view) => view.listing.provenance.origin === 'sample')) {
    notes.push(
      'Some listings in this product come from the bundled sample catalogue, not a live retailer feed. Prices from those listings are not live prices.',
    );
  }
  if (!intelligence || intelligence.reviewCount === 0) {
    notes.push('No customer review data is available for this product.');
  }

  return {
    product,
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      configSignature: variant.configSignature,
    })),
    listings: views,
    bestListingId: best?.listing.id ?? null,
    bestPayablePaise: best?.breakdown.payablePaise ?? null,
    bestPriceIsSample: best?.listing.provenance.origin === 'sample',
    reviewIntelligence: intelligence,
    matches,
    priceRange: prices.length > 0 ? { minPaise: Math.min(...prices), maxPaise: Math.max(...prices) } : null,
    dataQualityNotes: notes,
  };
}

/**
 * Compare every pair of listings for a product and report how they relate.
 */
export function buildMatches(listings: RetailerListing[]): VariantMatchView[] {
  const results: VariantMatchView[] = [];
  for (let i = 0; i < listings.length; i += 1) {
    for (let j = i + 1; j < listings.length; j += 1) {
      const left = listings[i];
      const right = listings[j];
      if (!left || !right) continue;

      const leftVariant = listVariants(left.productId).find((variant) => variant.id === left.variantId);
      const rightVariant = listVariants(right.productId).find((variant) => variant.id === right.variantId);
      if (!leftVariant || !rightVariant) continue;

      const leftSignature = signatureFromVariant(leftVariant);
      const rightSignature = signatureFromVariant(rightVariant);
      const result = compareVariants(leftSignature, rightSignature);

      results.push({
        listingId: left.id,
        variantId: right.id,
        verdict: result.verdict,
        confidence: result.confidence,
        explanation: result.explanation,
        differences: result.differences,
      });
    }
  }
  return results.sort(
    (a, b) => verdictRank(a.verdict as never) - verdictRank(b.verdict as never) || b.confidence - a.confidence,
  );
}

/**
 * Compare two or more products across specifications, price and reliability.
 */
export interface ComparisonRow {
  label: string;
  /** One entry per product; null means "not available". */
  values: (string | number | null)[];
  /** True when the values differ meaningfully across products. */
  differs: boolean;
}

export interface ComparisonResult {
  productIds: string[];
  rows: ComparisonRow[];
  highlights: string[];
  priceComparison: {
    productId: string;
    listingId: string | null;
    retailer: string | null;
    payablePaise: number | null;
    bestCasePaise: number | null;
    isSample: boolean;
  }[];
  reviewComparison: {
    productId: string;
    reviewCount: number;
    averageRating: number | null;
    authenticityRisk: number | null;
    topComplaints: string[];
  }[];
  notes: string[];
}

export function buildComparison(productIds: string[], shopper: ShopperContext = {}): ComparisonResult {
  const views = productIds
    .map((id) => buildProductView(id, { shopper, includePriceHistory: false }))
    .filter((view): view is ProductView => view !== null);

  const notes: string[] = [];

  const rows: ComparisonRow[] = [];

  const addRow = (label: string, values: (string | number | null)[]): void => {
    const present = values.filter((value) => value !== null && value !== undefined);
    const distinct = new Set(present.map((value) => String(value)));
    rows.push({ label, values, differs: distinct.size > 1 });
  };

  const specRows: { key: Exclude<keyof Product['specs'], 'extra'>; label: string }[] = [
    { key: 'soc', label: 'Processor' },
    { key: 'ramGb', label: 'RAM' },
    { key: 'storageGb', label: 'Storage' },
    { key: 'storageType', label: 'Storage type' },
    { key: 'displaySizeIn', label: 'Display size' },
    { key: 'displayPanel', label: 'Panel' },
    { key: 'refreshHz', label: 'Refresh rate' },
    { key: 'batteryMah', label: 'Battery' },
    { key: 'cameraMainMp', label: 'Main camera' },
    { key: 'network', label: 'Network' },
    { key: 'os', label: 'Operating system' },
    { key: 'warrantyMonths', label: 'Warranty (months)' },
  ];

  for (const specRow of specRows) {
    const values = views.map((view) => {
      const value = view.product.specs[specRow.key];
      if (value === undefined || value === null) return null;
      if (typeof value === 'number') {
        if (specRow.key === 'ramGb') return `${value}GB`;
        if (specRow.key === 'storageGb') return `${value}GB`;
        if (specRow.key === 'displaySizeIn') return `${value}"`;
        if (specRow.key === 'refreshHz') return `${value}Hz`;
        if (specRow.key === 'batteryMah') return `${value}mAh`;
        if (specRow.key === 'cameraMainMp') return `${value}MP`;
        if (specRow.key === 'warrantyMonths') return `${value}`;
        return value;
      }
      return value;
    });
    addRow(specRow.label, values);
  }

  // Price row.
  addRow(
    'Best payable price',
    views.map((view) => (view.bestPayablePaise !== null ? formatPaise(view.bestPayablePaise) : null)),
  );

  // Reliability row.
  addRow(
    'Owner rating (reviews)',
    views.map((view) =>
      view.reviewIntelligence && view.reviewIntelligence.reviewCount > 0
        ? `${view.reviewIntelligence.averageRating.toFixed(1)} ★ (${view.reviewIntelligence.reviewCount})`
        : null,
    ),
  );

  const highlights = rows.filter((row) => row.differs).map((row) => row.label);

  const priceComparison = views.map((view) => {
    const bestListing =
      view.listings.find((listing) => listing.listing.id === view.bestListingId) ?? view.listings[0] ?? null;
    return {
      productId: view.product.id,
      listingId: bestListing?.listing.id ?? null,
      retailer: bestListing?.listing.retailer ?? null,
      payablePaise: bestListing?.breakdown.payablePaise ?? null,
      bestCasePaise: bestListing?.breakdown.bestCasePayablePaise ?? null,
      isSample: bestListing?.listing.provenance.origin === 'sample',
    };
  });

  const reviewComparison = views.map((view) => ({
    productId: view.product.id,
    reviewCount: view.reviewIntelligence?.reviewCount ?? 0,
    averageRating: view.reviewIntelligence?.averageRating ?? null,
    authenticityRisk: view.reviewIntelligence?.authenticityRisk ?? null,
    topComplaints: view.reviewIntelligence?.complaints.slice(0, 3) ?? [],
  }));

  if (views.length < productIds.length) {
    notes.push('Some products could not be loaded and are omitted from this comparison.');
  }
  if (priceComparison.some((entry) => entry.isSample)) {
    notes.push('At least one price in this comparison comes from the bundled sample catalogue, not a live retailer feed.');
  }

  return {
    productIds: views.map((view) => view.product.id),
    rows,
    highlights,
    priceComparison,
    reviewComparison,
    notes,
  };
}

/**
 * Build a candidate list for the recommendation engine.
 */
export function buildCandidates(
  category: string | undefined,
  requirements: PurchaseRequirements,
  shopper: ShopperContext = {},
): {
  candidates: {
    product: Product;
    pricePaise: number | null;
    priceIsSample: boolean;
    reviews: ReviewIntelligence | null;
    retailer: string | null;
  }[];
  notes: string[];
} {
  const notes: string[] = [];
  const allProducts = listListings().length > 0 ? uniqueProducts() : [];
  const scoped = category ? allProducts.filter((product) => product.category === category) : allProducts;

  const candidates = scoped.map((product) => {
    const view = buildProductView(product.id, { shopper, includePriceHistory: false });
    if (!view) {
      return {
        product,
        pricePaise: null,
        priceIsSample: false,
        reviews: null,
        retailer: null,
      };
    }
    const best = view.listings.find((listing) => listing.listing.id === view.bestListingId) ?? view.listings[0] ?? null;
    return {
      product,
      pricePaise: best?.breakdown.payablePaise ?? null,
      priceIsSample: best?.listing.provenance.origin === 'sample',
      reviews: view.reviewIntelligence,
      retailer: best?.listing.retailer ?? null,
    };
  });

  if (scoped.length === 0) {
    notes.push(
      category
        ? `No products are available in the "${category}" category yet.`
        : 'No products are available in the catalogue yet.',
    );
  }

  return { candidates, notes };
}

function uniqueProducts(): Product[] {
  const seen = new Set<string>();
  const products: Product[] = [];
  for (const listing of listListings()) {
    if (seen.has(listing.productId)) continue;
    seen.add(listing.productId);
    const product = getProduct(listing.productId);
    if (product) products.push(product);
  }
  return products;
}

export { toVariantSignature };
