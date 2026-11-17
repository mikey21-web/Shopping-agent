/**
 * Extraction schemas.
 *
 * Every object that leaves the extraction pipeline is validated. The
 * schemas are deliberately strict about *type* and lenient about
 * *presence*: a missing field is `null`, never a guess, and never a
 * fabricated default.
 *
 * The distinction that matters:
 *
 *   - **Facts** carry provenance. They know where they came from, when
 *     they were retrieved, how they were extracted, and whether they have
 *     been corroborated by a second independent source.
 *   - **Products** are the normalised view of one listing at one retailer
 *     at one moment. The raw evidence stays attached.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Provenance                                                           */
/* ------------------------------------------------------------------ */

/** How a fact was obtained. */
export const ExtractionMethodSchema = z.enum([
  'json_ld',
  'microdata',
  'embedded_json',
  'retailer_adapter',
  'dom',
  'browser_dom',
  'search_snippet',
  'llm',
  'manual',
]);

export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

/** Whether a fact has been corroborated. */
export const VerificationStatusSchema = z.enum([
  /** One source, no corroboration. */
  'single_source',
  /** Two or more independent sources agree. */
  'corroborated',
  /** Independent sources disagree — the disagreement is preserved. */
  'conflicted',
  /** A model produced this and it has not been checked against a source. */
  'unverified_model',
  /** A model produced this and a source agreed with it. */
  'model_confirmed',
  /** The source itself states it. */
  'manufacturer_claim',
]);

export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/** The evidence class a fact belongs to. */
export const EvidenceClassSchema = z.enum([
  'objective_fact',
  'manufacturer_claim',
  'independent_test',
  'customer_experience',
  'market_observation',
  'model_inference',
]);

export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

/**
 * Where a fact came from.
 *
 * Every extracted value carries one of these. A fact without provenance is
 * a guess, and guesses do not enter the evidence base.
 */
export const ProvenanceSchema = z.object({
  /** The URL the fact was read from. */
  sourceUrl: z.string().min(1),
  /** The domain, for grouping and independence checks. */
  sourceDomain: z.string().min(1),
  /** ISO-8601 timestamp of retrieval. */
  retrievedAt: z.string().min(1),
  /** The excerpt the value was taken from, when there is one. */
  excerpt: z.string().nullable().default(null),
  /** A CSS selector, XPath or JSON path that locates the value. */
  locator: z.string().nullable().default(null),
  /** How the value was extracted. */
  method: ExtractionMethodSchema,
  /** The validation outcome for this value. */
  validation: z.enum(['passed', 'failed', 'not_validated']).default('not_validated'),
  /** 0..1. Extraction confidence, not a probability of truth. */
  confidence: z.number().min(0).max(1).default(0.5),
  /** The evidence class this fact belongs to. */
  evidenceClass: EvidenceClassSchema.default('objective_fact'),
  /** The verification status. */
  verification: VerificationStatusSchema.default('single_source'),
  /** How many independent sources agree with this value. */
  corroboratingSources: z.number().int().min(0).default(0),
  /** Sources that disagree with this value. */
  conflictingSources: z.array(z.string()).default([]),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/* ------------------------------------------------------------------ */
/* Money                                                                */
/* ------------------------------------------------------------------ */

/**
 * A monetary amount.
 *
 * Amounts are held in paise (integers) to keep arithmetic exact. The
 * currency is always explicit — an amount without a currency is not a price.
 */
export const MoneySchema = z.object({
  /** The amount in paise. */
  paise: z.number().int().nonnegative(),
  /** ISO-4217 code. */
  currency: z.string().length(3).default('INR'),
  /** Where the amount came from. */
  provenance: ProvenanceSchema.nullable().default(null),
});

export type Money = z.infer<typeof MoneySchema>;

/* ------------------------------------------------------------------ */
/* Variant                                                              */
/* ------------------------------------------------------------------ */

/**
 * The attributes that distinguish one sellable variant from another.
 *
 * Every field is optional. Two listings agree on a variant only when every
 * field that *both* sides declare matches. Missing data is not agreement.
 */
export const VariantSchema = z.object({
  /** Free-form size, e.g. "UK 8", "9.5", "32". */
  size: z.string().nullable().default(null),
  /** Width, for footwear and apparel. */
  width: z.string().nullable().default(null),
  /** Colour. */
  colour: z.string().nullable().default(null),
  /** Primary material. */
  material: z.string().nullable().default(null),
  /** Secondary material, e.g. the lining or the midsole. */
  secondaryMaterial: z.string().nullable().default(null),
  /** Storage capacity. */
  storage: z.string().nullable().default(null),
  /** RAM. */
  ram: z.string().nullable().default(null),
  /** Gender / department. */
  gender: z.string().nullable().default(null),
  /** Fit. */
  fit: z.string().nullable().default(null),
  /** Every other attribute the retailer published, keyed by its own label. */
  extra: z.record(z.string(), z.string().nullable()).default({}),
});

export type Variant = z.infer<typeof VariantSchema>;

/* ------------------------------------------------------------------ */
/* Offer                                                                */
/* ------------------------------------------------------------------ */

/**
 * A discount or offer, and the conditions attached to it.
 *
 * The conditions are not decoration. A bank discount the buyer does not
 * qualify for is worth zero, and the price engine has to be able to say so.
 */
export const OfferSchema = z.object({
  /** What the offer is. */
  kind: z.enum([
    'coupon',
    'bank_discount',
    'cashback',
    'exchange',
    'free_shipping',
    'emi',
    'bundle',
    'other',
  ]),
  /** The headline as published. */
  label: z.string().min(1),
  /** The value of the offer in paise. */
  valuePaise: z.number().int().default(0),
  /** The bank the offer is tied to, when it is a bank offer. */
  bank: z.string().nullable().default(null),
  /** The card type the offer applies to. */
  cardType: z.string().nullable().default(null),
  /** The minimum spend the offer requires, in paise. */
  minimumSpendPaise: z.number().int().nullable().default(null),
  /** The maximum discount the offer allows, in paise. */
  maxDiscountPaise: z.number().int().nullable().default(null),
  /** Free-text eligibility conditions, verbatim. */
  conditions: z.array(z.string()).default([]),
  /** ISO-8601 expiry, when published. */
  expiresAt: z.string().nullable().default(null),
  /** True when SahiPick could not confirm the conditions from the source. */
  unverified: z.boolean().default(false),
  provenance: ProvenanceSchema.nullable().default(null),
});

export type Offer = z.infer<typeof OfferSchema>;

/* ------------------------------------------------------------------ */
/* Product                                                              */
/* ------------------------------------------------------------------ */

/**
 * A normalised product listing.
 *
 * This is one listing at one retailer at one moment. It is not the product
 * itself — the product identity lives in the matching layer, which merges
 * several listings of the same thing while keeping their differences.
 */
export const NormalizedProductSchema = z.object({
  /** A stable id for this listing. */
  listingId: z.string().min(1),
  /** The product name as published. */
  name: z.string().min(1),
  /** The brand. */
  brand: z.string().nullable().default(null),
  /** The category. */
  category: z.string().nullable().default(null),
  /** The model name or number. */
  model: z.string().nullable().default(null),
  /** The full variant identity, when the retailer publishes one. */
  variant: VariantSchema.nullable().default(null),
  /** The retailer that published the listing. */
  retailer: z.string().min(1),
  /** The product URL. */
  productUrl: z.string().min(1),
  /** The retailer's own SKU. */
  sku: z.string().nullable().default(null),
  /** The manufacturer's part number. */
  mpn: z.string().nullable().default(null),
  /** The GTIN / EAN / UPC. */
  gtin: z.string().nullable().default(null),
  /** The specifications, keyed by the retailer's own labels. */
  specifications: z.record(z.string(), z.string().nullable()).default({}),
  /** The listed price. */
  listedPrice: MoneySchema.nullable().default(null),
  /** The price the buyer actually pays before offers. */
  salePrice: MoneySchema.nullable().default(null),
  /** The published rating, on the retailer's own scale. */
  rating: z.number().min(0).max(5).nullable().default(null),
  /** How many ratings the rating is based on. */
  reviewCount: z.number().int().nonnegative().nullable().default(null),
  /** Availability as published. */
  availability: z
    .enum(['in_stock', 'out_of_stock', 'pre_order', 'backorder', 'unknown'])
    .default('unknown'),
  /** The delivery estimate, verbatim. */
  deliveryEstimate: z.string().nullable().default(null),
  /** The return policy, verbatim. */
  returnPolicy: z.string().nullable().default(null),
  /** The warranty, verbatim. */
  warranty: z.string().nullable().default(null),
  /** The offers published on this listing. */
  offers: z.array(OfferSchema).default([]),
  /** ISO-8601 timestamp of the observation. */
  observedAt: z.string().min(1),
  /** The URLs this listing was assembled from. */
  sourceProvenance: z.array(z.string()).min(1),
  /** How the listing was assembled. */
  extractionMethod: ExtractionMethodSchema,
  /** How many independent sources back this listing's core identity. */
  verification: VerificationStatusSchema.default('single_source'),
});

export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

/* ------------------------------------------------------------------ */
/* Raw evidence                                                         */
/* ------------------------------------------------------------------ */

/**
 * The raw evidence a product was built from.
 *
 * Kept separate from the normalised record on purpose: the normalised
 * record is what the decision engine reads, and the raw evidence is what
 * the UI shows when a shopper asks "where did this come from?".
 */
export const RawEvidenceSchema = z.object({
  /** The URL. */
  url: z.string().min(1),
  /** The domain. */
  domain: z.string().min(1),
  /** ISO-8601 retrieval time. */
  retrievedAt: z.string().min(1),
  /** The excerpt, when there is one. */
  excerpt: z.string().nullable().default(null),
  /** How the fact was extracted. */
  method: ExtractionMethodSchema,
  /** The source type. */
  sourceType: z.enum([
    'manufacturer',
    'retailer',
    'review_site',
    'community',
    'documentation',
    'unknown',
  ]),
  /** The JSON-LD or embedded JSON payload, when there was one. */
  structured: z.string().nullable().default(null),
  /** The page title. */
  title: z.string().nullable().default(null),
});

export type RawEvidence = z.infer<typeof RawEvidenceSchema>;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Validate an unknown value against a schema.
 *
 * Returns the parsed value on success and `null` on failure — a failed
 * validation is a gap in the evidence, not a reason to throw and lose the
 * whole page.
 */
export function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; value: T } | { ok: false; issues: string[] } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
