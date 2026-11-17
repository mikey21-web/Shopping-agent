/**
 * Assembling decision candidates.
 *
 * Bridges the stored catalogue and the research store into the shape the
 * decision engine consumes. Everything the engine needs — the payable price,
 * the offer breakdown, review intelligence, price history, research facts and
 * the exact variant under consideration — is gathered here so the engine
 * itself stays free of storage concerns.
 */

import type { Product } from '../../domain/types.ts';
import { listProducts, getProduct, getReviewIntelligence, listListings } from '../../db/repositories.ts';
import { computePriceBreakdown } from '../../intelligence/pricing/offers.ts';
import { computePriceStats } from '../../intelligence/pricehistory/stats.ts';
import { factsForProduct } from '../../research/store.ts';
import type { ResearchFact } from '../../research/types.ts';
import type { DecisionCandidate } from '../../intelligence/decision/engine.ts';

export interface DecisionCandidateOptions {
  /** The shopper's context, used to evaluate conditional offers. */
  shopper?: Record<string, unknown>;
  /** Include the research facts gathered from the open web. */
  includeResearch?: boolean;
  /** Restrict to one category. */
  category?: string | undefined;
}

/**
 * Build the decision candidates for a category.
 */
export function buildDecisionCandidates(
  options: DecisionCandidateOptions = {},
): DecisionCandidate[] {
  const shopper = (options.shopper ?? {}) as never;
  const includeResearch = options.includeResearch ?? true;

  const products = options.category
    ? listProducts(options.category)
    : uniqueProductsFromListings();

  const candidates: DecisionCandidate[] = [];

  for (const product of products) {
    const candidate = buildDecisionCandidate(product, { shopper, includeResearch });
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

/** Build the decision candidate for one product. */
export function buildDecisionCandidate(
  product: Product,
  options: { shopper?: unknown; includeResearch?: boolean } = {},
): DecisionCandidate | null {
  const shopper = (options.shopper ?? {}) as never;
  const listings = listListings(product.id);
  if (listings.length === 0) return null;

  let best: {
    listing: (typeof listings)[number];
    breakdown: ReturnType<typeof computePriceBreakdown>;
  } | null = null;

  for (const listing of listings) {
    const breakdown = computePriceBreakdown(listing, listOffersFor(listing.id), shopper);
    if (!best || breakdown.payablePaise < best.breakdown.payablePaise) {
      best = { listing, breakdown };
    }
  }

  if (!best) return null;

  const pricePoints = listPricePointsFor(best.listing.id);
  const stats = computePriceStats(pricePoints);

  const reviews = getReviewIntelligence(product.id) ?? null;

  const facts: ResearchFact[] = options.includeResearch === false ? [] : safeFacts(product.id);

  const variantLabel =
    listVariantLabels(product.id).find((entry) => entry.id === best.listing.variantId)?.label ?? null;

  return {
    product,
    pricePaise: best.breakdown.payablePaise,
    priceIsSample: best.listing.provenance.origin === 'sample',
    reviews,
    breakdown: best.breakdown,
    priceHistory: stats
      ? {
          observations: stats.observations,
          avgPaise: stats.avgPaise,
          minPaise: stats.minPaise,
          maxPaise: stats.maxPaise,
          latestPaise: stats.latestPaise,
          discountVsAvg: stats.discountVsAvg,
        }
      : null,
    retailer: best.listing.retailer,
    facts,
    inStock: listings.some((listing) => listing.inStock),
    condition: best.listing.condition,
    certification: readCertification(product),
    variantLabel: variantLabel ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

/* These are thin wrappers so this module has a single import surface for
 * storage, and so a missing table degrades instead of throwing. */

function listOffersFor(listingId: string): ReturnType<typeof listOffersTyped> {
  return listOffersTyped(listingId);
}

function listPricePointsFor(listingId: string): ReturnType<typeof listPricePointsTyped> {
  return listPricePointsTyped(listingId);
}

function listVariantLabels(productId: string): { id: string; label: string }[] {
  try {
    return listVariantsTyped(productId);
  } catch {
    return [];
  }
}

function safeFacts(productId: string): ResearchFact[] {
  try {
    return factsForProduct(productId);
  } catch {
    return [];
  }
}

function uniqueProductsFromListings(): Product[] {
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

/** Read a published certification, when the product has one. */
function readCertification(product: Product): string | null {
  const extra = product.specs.extra;
  for (const key of ['certification', 'Certification', 'certificationStandard', 'standard']) {
    const value = extra[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/* Imported lazily so the module graph stays acyclic and the storage
 * helpers above remain the only place the repository layer is touched. */
import {
  listOffers as listOffersTyped,
  listPricePoints as listPricePointsTyped,
  listVariants as listVariantsTyped,
} from '../../db/repositories.ts';
