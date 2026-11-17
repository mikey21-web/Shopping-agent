/**
 * Repository layer.
 *
 * All SQL lives here; the rest of the application works with domain objects.
 * Row mapping is centralised so that JSON columns are parsed in exactly one
 * place and provenance is never lost on the way in or out.
 */

import type {
  Offer,
  PricePoint,
  Product,
  ProductVariant,
  Provenance,
  RetailerListing,
  Review,
  ReviewIntelligence,
} from '../domain/types.ts';
import { run, select, selectOne } from './index.ts';

/* ------------------------------------------------------------------ */
/* JSON helpers                                                        */
/* ------------------------------------------------------------------ */

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toProvenance(value: unknown): Provenance {
  const record = parseJson<Partial<Provenance>>(value, {});
  return {
    origin: record.origin ?? 'unknown',
    source: record.source ?? 'unknown',
    observedAt: record.observedAt ?? null,
    confidence: typeof record.confidence === 'number' ? record.confidence : 0.5,
    url: record.url ?? null,
    note: record.note ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

interface ProductRow {
  id: string;
  brand: string;
  model: string;
  display_name: string;
  category: string;
  identity_key: string;
  variant_key: string | null;
  specs_json: string;
  highlights_json: string;
  image_url: string | null;
  specs_verified: number;
  spec_sources_json: string;
  created_at: string;
  updated_at: string;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    displayName: row.display_name,
    category: row.category as Product['category'],
    identityKey: row.identity_key,
    variantKey: row.variant_key,
    specs: parseJson(row.specs_json, {} as Product['specs']),
    specsVerified: row.specs_verified === 1,
    specSources: parseJson<string[]>(row.spec_sources_json, []),
    highlights: parseJson<string[]>(row.highlights_json, []),
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertProduct(product: Product): void {
  run(
    `INSERT INTO products (
       id, brand, model, display_name, category, identity_key, variant_key,
       specs_json, highlights_json, image_url, specs_verified, spec_sources_json,
       created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       model = excluded.model,
       display_name = excluded.display_name,
       identity_key = excluded.identity_key,
       specs_json = excluded.specs_json,
       highlights_json = excluded.highlights_json,
       image_url = excluded.image_url,
       specs_verified = excluded.specs_verified,
       spec_sources_json = excluded.spec_sources_json,
       updated_at = excluded.updated_at`,
    product.id,
    product.brand,
    product.model,
    product.displayName,
    product.category,
    product.identityKey,
    product.variantKey ?? null,
    JSON.stringify(product.specs),
    JSON.stringify(product.highlights),
    product.imageUrl ?? null,
    product.specsVerified ? 1 : 0,
    JSON.stringify(product.specSources),
    product.createdAt,
    product.updatedAt,
  );
}

export function getProduct(id: string): Product | null {
  const row = selectOne<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  return row ? mapProduct(row) : null;
}

export function listProducts(category?: string): Product[] {
  const rows = category
    ? select<ProductRow>('SELECT * FROM products WHERE category = ? ORDER BY display_name', category)
    : select<ProductRow>('SELECT * FROM products ORDER BY display_name');
  return rows.map(mapProduct);
}

export function searchProducts(term: string, category?: string): Product[] {
  const like = `%${term.toLowerCase()}%`;
  const rows = category
    ? select<ProductRow>(
        `SELECT * FROM products
         WHERE category = ? AND (LOWER(display_name) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(model) LIKE ?)
         ORDER BY display_name`,
        category,
        like,
        like,
        like,
      )
    : select<ProductRow>(
        `SELECT * FROM products
         WHERE LOWER(display_name) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(model) LIKE ?
         ORDER BY display_name`,
        like,
        like,
        like,
      );
  return rows.map(mapProduct);
}

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

interface VariantRow {
  id: string;
  product_id: string;
  label: string;
  config_signature: string;
  specs_json: string;
  part_number: string | null;
  sku: string | null;
  gtin: string | null;
  colour: string | null;
  image_url: string | null;
}

function mapVariant(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    label: row.label,
    configSignature: row.config_signature,
    specs: parseJson(row.specs_json, {} as ProductVariant['specs']),
    partNumber: row.part_number,
    sku: row.sku,
    gtin: row.gtin,
    colour: row.colour,
    imageUrl: row.image_url,
  };
}

export function upsertVariant(variant: ProductVariant): void {
  run(
    `INSERT INTO product_variants (
       id, product_id, label, config_signature, specs_json, part_number, sku, gtin, colour, image_url
     ) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       config_signature = excluded.config_signature,
       specs_json = excluded.specs_json,
       part_number = excluded.part_number,
       sku = excluded.sku,
       gtin = excluded.gtin,
       colour = excluded.colour,
       image_url = excluded.image_url`,
    variant.id,
    variant.productId,
    variant.label,
    variant.configSignature,
    JSON.stringify(variant.specs),
    variant.partNumber ?? null,
    variant.sku ?? null,
    variant.gtin ?? null,
    variant.colour ?? null,
    variant.imageUrl ?? null,
  );
}

export function listVariants(productId: string): ProductVariant[] {
  return select<VariantRow>('SELECT * FROM product_variants WHERE product_id = ? ORDER BY label', productId).map(
    mapVariant,
  );
}

export function getVariant(id: string): ProductVariant | null {
  const row = selectOne<VariantRow>('SELECT * FROM product_variants WHERE id = ?', id);
  return row ? mapVariant(row) : null;
}

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

interface ListingRow {
  id: string;
  variant_id: string;
  product_id: string;
  retailer: string;
  retailer_product_id: string;
  title: string;
  url: string;
  list_price_paise: number;
  mrp_paise: number | null;
  condition: string;
  in_stock: number;
  seller: string | null;
  rating: number | null;
  rating_count: number | null;
  review_count: number | null;
  image_url: string | null;
  delivery_fee_paise: number;
  provenance_json: string;
  first_seen_at: string;
  last_seen_at: string;
}

function mapListing(row: ListingRow): RetailerListing {
  return {
    id: row.id,
    variantId: row.variant_id,
    productId: row.product_id,
    retailer: row.retailer as RetailerListing['retailer'],
    retailerProductId: row.retailer_product_id,
    title: row.title,
    url: row.url,
    listPricePaise: row.list_price_paise,
    mrpPaise: row.mrp_paise,
    condition: row.condition as RetailerListing['condition'],
    inStock: row.in_stock === 1,
    seller: row.seller,
    rating: row.rating,
    ratingCount: row.rating_count,
    reviewCount: row.review_count,
    imageUrl: row.image_url,
    deliveryFeePaise: row.delivery_fee_paise,
    provenance: toProvenance(row.provenance_json),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function upsertListing(listing: RetailerListing): void {
  run(
    `INSERT INTO retailer_listings (
       id, variant_id, product_id, retailer, retailer_product_id, title, url,
       list_price_paise, mrp_paise, condition, in_stock, seller, rating,
       rating_count, review_count, image_url, delivery_fee_paise, provenance_json,
       first_seen_at, last_seen_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       variant_id = excluded.variant_id,
       product_id = excluded.product_id,
       title = excluded.title,
       url = excluded.url,
       list_price_paise = excluded.list_price_paise,
       mrp_paise = excluded.mrp_paise,
       condition = excluded.condition,
       in_stock = excluded.in_stock,
       seller = excluded.seller,
       rating = excluded.rating,
       rating_count = excluded.rating_count,
       review_count = excluded.review_count,
       image_url = excluded.image_url,
       delivery_fee_paise = excluded.delivery_fee_paise,
       provenance_json = excluded.provenance_json,
       last_seen_at = excluded.last_seen_at`,
    listing.id,
    listing.variantId,
    listing.productId,
    listing.retailer,
    listing.retailerProductId,
    listing.title,
    listing.url,
    listing.listPricePaise,
    listing.mrpPaise ?? null,
    listing.condition,
    listing.inStock ? 1 : 0,
    listing.seller ?? null,
    listing.rating ?? null,
    listing.ratingCount ?? null,
    listing.reviewCount ?? null,
    listing.imageUrl ?? null,
    listing.deliveryFeePaise ?? 0,
    JSON.stringify(listing.provenance),
    listing.firstSeenAt,
    listing.lastSeenAt,
  );
}

export function getListing(id: string): RetailerListing | null {
  const row = selectOne<ListingRow>('SELECT * FROM retailer_listings WHERE id = ?', id);
  return row ? mapListing(row) : null;
}

export function listListings(productId?: string): RetailerListing[] {
  const rows = productId
    ? select<ListingRow>(
        'SELECT * FROM retailer_listings WHERE product_id = ? ORDER BY list_price_paise',
        productId,
      )
    : select<ListingRow>('SELECT * FROM retailer_listings ORDER BY list_price_paise');
  return rows.map(mapListing);
}

export function listListingsByVariant(variantId: string): RetailerListing[] {
  return select<ListingRow>(
    'SELECT * FROM retailer_listings WHERE variant_id = ? ORDER BY list_price_paise',
    variantId,
  ).map(mapListing);
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

interface OfferRow {
  id: string;
  listing_id: string;
  kind: string;
  title: string;
  description: string | null;
  percent_off: number | null;
  flat_off_paise: number | null;
  cashback_paise: number | null;
  conditions_json: string;
  stackability: string;
  automatic: number;
  validity_start: string | null;
  validity_end: string | null;
  provenance_json: string;
}

function mapOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    listingId: row.listing_id,
    kind: row.kind as Offer['kind'],
    title: row.title,
    description: row.description,
    percentOff: row.percent_off,
    flatOffPaise: row.flat_off_paise,
    cashbackPaise: row.cashback_paise,
    conditions: parseJson(row.conditions_json, {}),
    stackability: row.stackability as Offer['stackability'],
    automatic: row.automatic === 1,
    validityStart: row.validity_start,
    validityEnd: row.validity_end,
    provenance: toProvenance(row.provenance_json),
  };
}

export function upsertOffer(offer: Offer): void {
  run(
    `INSERT INTO offers (
       id, listing_id, kind, title, description, percent_off, flat_off_paise,
       cashback_paise, conditions_json, stackability, automatic, validity_start,
       validity_end, provenance_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       description = excluded.description,
       percent_off = excluded.percent_off,
       flat_off_paise = excluded.flat_off_paise,
       cashback_paise = excluded.cashback_paise,
       conditions_json = excluded.conditions_json,
       stackability = excluded.stackability,
       automatic = excluded.automatic,
       validity_start = excluded.validity_start,
       validity_end = excluded.validity_end,
       provenance_json = excluded.provenance_json`,
    offer.id,
    offer.listingId,
    offer.kind,
    offer.title,
    offer.description ?? null,
    offer.percentOff ?? null,
    offer.flatOffPaise ?? null,
    offer.cashbackPaise ?? null,
    JSON.stringify(offer.conditions),
    offer.stackability,
    offer.automatic ? 1 : 0,
    offer.validityStart ?? null,
    offer.validityEnd ?? null,
    JSON.stringify(offer.provenance),
  );
}

export function listOffers(listingId: string): Offer[] {
  return select<OfferRow>('SELECT * FROM offers WHERE listing_id = ? ORDER BY id', listingId).map(mapOffer);
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

interface ReviewRow {
  id: string;
  listing_id: string | null;
  product_id: string;
  title: string | null;
  body: string;
  rating: number;
  author: string | null;
  verified_purchase: number | null;
  reviewed_at: string | null;
  helpful_votes: number | null;
  language: string;
  aspect_ratings_json: string | null;
  provenance_json: string;
}

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    listingId: row.listing_id,
    productId: row.product_id,
    title: row.title,
    body: row.body,
    rating: row.rating,
    author: row.author,
    verifiedPurchase: row.verified_purchase === null ? null : row.verified_purchase === 1,
    reviewedAt: row.reviewed_at,
    helpfulVotes: row.helpful_votes,
    language: row.language as Review['language'],
    aspectRatings: row.aspect_ratings_json ? parseJson(row.aspect_ratings_json, {}) : null,
    provenance: toProvenance(row.provenance_json),
  };
}

export function upsertReview(review: Review): void {
  run(
    `INSERT INTO reviews (
       id, listing_id, product_id, title, body, rating, author, verified_purchase,
       reviewed_at, helpful_votes, language, aspect_ratings_json, provenance_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       body = excluded.body,
       rating = excluded.rating,
       verified_purchase = excluded.verified_purchase,
       reviewed_at = excluded.reviewed_at,
       helpful_votes = excluded.helpful_votes,
       language = excluded.language,
       provenance_json = excluded.provenance_json`,
    review.id,
    review.listingId,
    review.productId,
    review.title ?? null,
    review.body,
    review.rating,
    review.author ?? null,
    review.verifiedPurchase === null ? null : review.verifiedPurchase ? 1 : 0,
    review.reviewedAt ?? null,
    review.helpfulVotes ?? null,
    review.language,
    review.aspectRatings ? JSON.stringify(review.aspectRatings) : null,
    JSON.stringify(review.provenance),
  );
}

export function listReviews(productId: string): Review[] {
  return select<ReviewRow>(
    'SELECT * FROM reviews WHERE product_id = ? ORDER BY COALESCE(reviewed_at, \'\') DESC',
    productId,
  ).map(mapReview);
}

/* ------------------------------------------------------------------ */
/* Review intelligence                                                 */
/* ------------------------------------------------------------------ */

export function saveReviewIntelligence(intelligence: ReviewIntelligence): void {
  run(
    `INSERT INTO review_intelligence (
       id, product_id, listing_id, analysed_at, review_count, verified_ratio,
       average_rating, negative_share, authenticity_risk, signals_json,
       aspects_json, positives_json, complaints_json, long_term_json,
       language_breakdown_json, provenance_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       analysed_at = excluded.analysed_at,
       review_count = excluded.review_count,
       verified_ratio = excluded.verified_ratio,
       average_rating = excluded.average_rating,
       negative_share = excluded.negative_share,
       authenticity_risk = excluded.authenticity_risk,
       signals_json = excluded.signals_json,
       aspects_json = excluded.aspects_json,
       positives_json = excluded.positives_json,
       complaints_json = excluded.complaints_json,
       long_term_json = excluded.long_term_json,
       language_breakdown_json = excluded.language_breakdown_json`,
    `ri-${intelligence.productId}`,
    intelligence.productId,
    intelligence.listingId,
    new Date().toISOString(),
    intelligence.reviewCount,
    intelligence.verifiedRatio,
    intelligence.averageRating,
    intelligence.negativeShare,
    intelligence.authenticityRisk,
    JSON.stringify(intelligence.signals),
    JSON.stringify(intelligence.aspects),
    JSON.stringify(intelligence.positives),
    JSON.stringify(intelligence.complaints),
    JSON.stringify(intelligence.longTermConcerns),
    JSON.stringify(intelligence.languageBreakdown),
    JSON.stringify(intelligence.provenance),
  );
}

export function getReviewIntelligence(productId: string): ReviewIntelligence | null {
  const row = selectOne<{
    product_id: string;
    listing_id: string | null;
    review_count: number;
    verified_ratio: number;
    average_rating: number;
    negative_share: number;
    authenticity_risk: number;
    signals_json: string;
    aspects_json: string;
    positives_json: string;
    complaints_json: string;
    long_term_json: string;
    language_breakdown_json: string;
    provenance_json: string;
  }>('SELECT * FROM review_intelligence WHERE product_id = ?', productId);
  if (!row) return null;

  return {
    productId: row.product_id,
    listingId: row.listing_id,
    reviewCount: row.review_count,
    verifiedRatio: row.verified_ratio,
    averageRating: row.average_rating,
    negativeShare: row.negative_share,
    authenticityRisk: row.authenticity_risk,
    authenticityCaveat:
      'These are statistical signals about review patterns, not proof that any review is fake. Treat them as a reason to weight verified, detailed reviews more heavily.',
    signals: parseJson(row.signals_json, []),
    aspects: parseJson(row.aspects_json, []),
    positives: parseJson(row.positives_json, []),
    complaints: parseJson(row.complaints_json, []),
    longTermConcerns: parseJson(row.long_term_json, []),
    languageBreakdown: parseJson(row.language_breakdown_json, {}),
    provenance: toProvenance(row.provenance_json),
  };
}

/* ------------------------------------------------------------------ */
/* Price points                                                        */
/* ------------------------------------------------------------------ */

interface PricePointRow {
  listing_id: string;
  price_paise: number;
  recorded_at: string;
  provenance_json: string;
}

export function insertPricePoint(point: PricePoint): void {
  run(
    `INSERT INTO price_points (listing_id, price_paise, recorded_at, provenance_json)
     VALUES (?,?,?,?)`,
    point.listingId,
    point.pricePaise,
    point.recordedAt,
    JSON.stringify(point.provenance),
  );
}

export function listPricePoints(listingId: string): PricePoint[] {
  return select<PricePointRow>(
    'SELECT * FROM price_points WHERE listing_id = ? ORDER BY recorded_at',
    listingId,
  ).map((row) => ({
    listingId: row.listing_id,
    pricePaise: row.price_paise,
    recordedAt: row.recorded_at,
    provenance: toProvenance(row.provenance_json),
  }));
}

/** Prices recorded on or after a date. */
export function listPricePointsSince(listingId: string, sinceIso: string): PricePoint[] {
  return select<PricePointRow>(
    'SELECT * FROM price_points WHERE listing_id = ? AND recorded_at >= ? ORDER BY recorded_at',
    listingId,
    sinceIso,
  ).map((row) => ({
    listingId: row.listing_id,
    pricePaise: row.price_paise,
    recordedAt: row.recorded_at,
    provenance: toProvenance(row.provenance_json),
  }));
}

/** Distinct products that have any listing. */
export function productIdsWithListings(): string[] {
  return select<{ product_id: string }>(
    'SELECT DISTINCT product_id FROM retailer_listings',
  ).map((row) => row.product_id);
}
