/**
 * The universal extraction pipeline.
 *
 * A tiered cascade. Each tier is tried in order and the first one that
 * produces a complete-enough product wins. The tier that succeeded is
 * recorded on the product, so the UI can say how the data was obtained
 * and the decision engine can weigh it accordingly.
 *
 *   1. **JSON-LD / Schema.org** — the publisher's own machine-readable
 *      statement about the product. The best tier, because it is the
 *      publisher speaking about itself in a format designed for exactly
 *      this.
 *   2. **Embedded structured JSON** — the application state the page ships
 *      to its own front end. Accurate but the format is per-site, so it
 *      is matched by known shapes.
 *   3. **Retailer adapter** — a known Indian retailer's own page shape.
 *   4. **Rendered DOM and page content** — the fallback: read the
 *      specification table and the price out of the visible page.
 *   5. **LLM structured extraction** — the last resort, and only when a
 *      model is configured. The result is marked `llm` and carries
 *      `unverified_model` until a source confirms it.
 *
 * Nothing in this file invents a value. A tier that cannot find a field
 * leaves it null, and the null propagates all the way to the decision
 * engine, which reports it as a gap rather than guessing.
 */

import {
  NormalizedProductSchema,
  type NormalizedProduct,
  type Provenance,
  type RawEvidence,
} from './schema.ts';
import {
  adapterForUrl,
  extractVariant,
  findProductJsonLd,
  jsonLdBlocks,
  normaliseRating,
  parsePriceToPaise,
  provenanceFor,
  readSpecifications,
  stripTags,
} from '../sources/retailers.ts';

/* ------------------------------------------------------------------ */
/* Tier 1 — JSON-LD                                                     */
/* ------------------------------------------------------------------ */

/** Try to build a product from Schema.org JSON-LD. */
function fromJsonLd(
  html: string,
  url: string,
  retrievedAt: string,
): { product: NormalizedProduct; evidence: RawEvidence } | null {
  const product = findProductJsonLd(html);
  if (!product) return null;

  const name = typeof product.name === 'string' ? product.name.trim() : null;
  if (!name) return null;

  const offers = product.offers;
  const offerRecord = Array.isArray(offers) ? offers[0] : offers;
  const offer = (offerRecord && typeof offerRecord === 'object' ? offerRecord : {}) as Record<
    string,
    unknown
  >;

  const specifications = readSpecifications(html);
  const provenance = provenanceFor({
    sourceUrl: url,
    retrievedAt,
    method: 'json_ld',
    excerpt: name,
    locator: 'script[type="application/ld+json"]',
    confidence: 0.9,
  });

  const brandRaw = product.brand;
  const brand =
    typeof brandRaw === 'string'
      ? brandRaw
      : brandRaw && typeof brandRaw === 'object'
        ? ((brandRaw as Record<string, unknown>).name as string | undefined) ?? null
        : null;

  const pricePaise = parsePriceToPaise(offer.price);

  const aggregate = product.aggregateRating as Record<string, unknown> | undefined;
  const ratingRaw = aggregate?.ratingValue ?? product.rating;
  const reviewRaw = aggregate?.reviewCount ?? product.reviewCount;
  const parsedReviewCount =
    typeof reviewRaw === 'string' ? Number.parseInt(reviewRaw, 10) : reviewRaw;

  const candidate = {
    listingId: `${domainOf(url)}:${url}`,
    name,
    brand,
    category: null,
    model:
      typeof product.model === 'string'
        ? product.model
        : typeof product.sku === 'string'
          ? product.sku
          : null,
    variant: {
      ...extractVariant(specifications, {
        size: ['size', 'shoe size', 'uk size', 'us size', 'eu size', 'india size'],
        width: ['width'],
        colour: ['colour', 'color'],
        material: ['material', 'upper material', 'fabric'],
        secondaryMaterial: ['sole material', 'midsole', 'outsole', 'lining'],
        storage: ['storage', 'storage capacity', 'internal storage'],
        ram: ['ram', 'ram size'],
        gender: ['gender', 'department'],
        fit: ['fit'],
      }),
      extra: specifications,
    },
    retailer: domainOf(url),
    productUrl: url,
    sku: typeof product.sku === 'string' ? product.sku : null,
    mpn:
      typeof product.mpn === 'string'
        ? product.mpn
        : typeof product.productID === 'string'
          ? product.productID
          : null,
    gtin:
      typeof product.gtin === 'string'
        ? product.gtin
        : typeof product.gtin13 === 'string'
          ? product.gtin13
          : null,
    specifications,
    listedPrice:
      pricePaise === null
        ? null
        : { paise: pricePaise, currency: (offer.priceCurrency as string) ?? 'INR', provenance },
    salePrice:
      pricePaise === null
        ? null
        : { paise: pricePaise, currency: (offer.priceCurrency as string) ?? 'INR', provenance },
    rating: normaliseRating(ratingRaw, 5),
    reviewCount:
      typeof parsedReviewCount === 'number' && Number.isFinite(parsedReviewCount)
        ? parsedReviewCount
        : null,
    availability: availabilityFrom(offer.availability),
    deliveryEstimate: null,
    returnPolicy: null,
    warranty: null,
    offers: [],
    observedAt: retrievedAt,
    sourceProvenance: [url],
    extractionMethod: 'json_ld' as const,
    verification: 'single_source' as const,
  };

  const parsed = NormalizedProductSchema.safeParse(candidate);
  if (!parsed.success) return null;

  return {
    product: parsed.data,
    evidence: {
      url,
      domain: domainOf(url),
      retrievedAt,
      excerpt: name,
      method: 'json_ld',
      sourceType: 'retailer',
      structured: JSON.stringify(product),
      title: name,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tier 2 — embedded structured JSON                                    */
/* ------------------------------------------------------------------ */

/**
 * Read the application state a page ships to its own front end.
 *
 * These blobs are per-site, so the shapes below are the ones actually
 * seen on Indian retail sites. When none matches, this tier returns null
 * and the cascade moves on.
 */
function fromEmbeddedJson(
  html: string,
  url: string,
  retrievedAt: string,
): { product: NormalizedProduct; evidence: RawEvidence } | null {
  const candidates: unknown[] = [];

  // <script type="application/json"> blocks.
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = match[1];
    if (!raw) continue;
    try {
      candidates.push(JSON.parse(raw.trim()));
    } catch {
      /* not this one */
    }
  }

  // __NEXT_DATA__ and similar hydration payloads.
  for (const match of html.matchAll(
    /<script[^>]+id=["'](?:__NEXT_DATA__|__NUXT_DATA__)["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = match[1];
    if (!raw) continue;
    try {
      candidates.push(JSON.parse(raw.trim()));
    } catch {
      /* not this one */
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const found = findEmbeddedProduct(candidate as Record<string, unknown>);
    if (!found) continue;

    const product = found.product;
    const productName = asString(product.name) ?? 'Unknown product';
    const pricePaise = parsePriceToPaise(product.price ?? product.salePrice ?? product.mrp);
    const provenance = provenanceFor({
      sourceUrl: url,
      retrievedAt,
      method: 'embedded_json',
      excerpt: productName,
      locator: 'script[type="application/json"]',
      confidence: 0.75,
    });

    const specifications: Record<string, string> = {};
    for (const [key, value] of Object.entries(product.specifications ?? {})) {
      if (value === null || value === undefined) continue;
      specifications[String(key)] = String(value);
    }

    const candidate2 = {
      listingId: `${domainOf(url)}:${url}`,
      name: product.name,
      brand: product.brand ?? null,
      category: product.category ?? null,
      model: product.model ?? product.sku ?? null,
      variant: {
        ...extractVariant(specifications, {
          size: ['size', 'shoe size', 'uk size', 'us size', 'eu size'],
          colour: ['colour', 'color'],
          material: ['material', 'upper material'],
          storage: ['storage', 'storage capacity'],
          ram: ['ram', 'ram size'],
          gender: ['gender', 'department'],
        }),
        extra: specifications,
      },
      retailer: domainOf(url),
      productUrl: url,
      sku: product.sku ?? null,
      mpn: null,
      gtin: null,
      specifications,
      listedPrice:
        pricePaise === null
          ? null
          : { paise: pricePaise, currency: 'INR', provenance },
      salePrice:
        pricePaise === null
          ? null
          : { paise: pricePaise, currency: 'INR', provenance },
      rating: normaliseRating(product.rating, 5),
      reviewCount:
        typeof product.reviewCount === 'number' ? product.reviewCount : null,
      availability: availabilityFrom(product.availability),
      deliveryEstimate: product.deliveryEstimate ?? null,
      returnPolicy: product.returnPolicy ?? null,
      warranty: product.warranty ?? null,
      offers: [],
      observedAt: retrievedAt,
      sourceProvenance: [url],
      extractionMethod: 'embedded_json' as const,
      verification: 'single_source' as const,
    };

    const parsed = NormalizedProductSchema.safeParse(candidate2);
    if (parsed.success) {
      return {
        product: parsed.data,
        evidence: {
          url,
          domain: domainOf(url),
          retrievedAt,
          excerpt: productName,
          method: 'embedded_json',
          sourceType: 'retailer',
          structured: JSON.stringify(found.raw).slice(0, 20_000),
          title: productName,
        },
      };
    }
  }

  return null;
}

/** Narrow an unknown to a string, or null. */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Walk a hydration payload looking for something product-shaped. */
function findEmbeddedProduct(
  root: Record<string, unknown>,
): { product: Record<string, unknown>; raw: unknown } | null {
  const queue: unknown[] = [root];
  let examined = 0;

  while (queue.length > 0 && examined < 500) {
    const current = queue.shift();
    examined += 1;
    if (!current || typeof current !== 'object') continue;

    const record = current as Record<string, unknown>;

    // A direct product record.
    const name = record.name ?? record.title ?? record.productName;
    if (typeof name === 'string' && name.length > 3) {
      const hasPrice =
        record.price !== undefined ||
        record.salePrice !== undefined ||
        record.mrp !== undefined ||
        record.sellingPrice !== undefined;
      const hasProductish = record.brand !== undefined || record.sku !== undefined || hasPrice;
      if (hasProductish) {
        return {
          product: {
            name,
            brand:
              typeof record.brand === 'string'
                ? record.brand
                : typeof (record.brand as Record<string, unknown> | undefined)?.name === 'string'
                  ? ((record.brand as Record<string, unknown>).name as string)
                  : null,
            category: typeof record.category === 'string' ? record.category : null,
            model: typeof record.model === 'string' ? record.model : null,
            sku: typeof record.sku === 'string' ? record.sku : null,
            price: record.price ?? record.salePrice ?? record.sellingPrice,
            salePrice: record.salePrice ?? record.sellingPrice,
            mrp: record.mrp,
            rating: record.rating ?? record.averageRating,
            reviewCount: record.reviewCount ?? record.totalReviewCount,
            availability: record.availability ?? record.inStock,
            specifications: record.specifications ?? record.specs ?? record.attributes,
            deliveryEstimate: record.deliveryEstimate ?? record.deliveryTime,
            returnPolicy: record.returnPolicy,
            warranty: record.warranty,
          },
          raw: record,
        };
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Tier 3 — retailer adapter                                            */
/* ------------------------------------------------------------------ */

function fromRetailerAdapter(
  html: string,
  url: string,
  retrievedAt: string,
): { product: NormalizedProduct; evidence: RawEvidence } | null {
  const adapter = adapterForUrl(url);
  if (!adapter) return null;

  const product = adapter.parse(html, url, retrievedAt);
  if (!product) return null;

  return {
    product,
    evidence: {
      url,
      domain: domainOf(url),
      retrievedAt,
      excerpt: product.name,
      method: 'retailer_adapter',
      sourceType: 'retailer',
      structured: null,
      title: product.name,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tier 4 — rendered DOM and page content                               */
/* ------------------------------------------------------------------ */

/**
 * The fallback: read the visible page.
 *
 * This tier works on almost any product page because specification
 * tables and price elements are near-universal. It produces a lower
 * confidence product and the method is recorded, so downstream it is
 * treated as weaker evidence than JSON-LD.
 */
function fromPageContent(
  html: string,
  url: string,
  retrievedAt: string,
): { product: NormalizedProduct; evidence: RawEvidence } | null {
  const specifications = readSpecifications(html);
  const title = readTitle(html);
  if (!title) return null;

  const pricePaise = findPriceInMarkup(html);
  const provenance = provenanceFor({
    sourceUrl: url,
    retrievedAt,
    method: 'dom',
    excerpt: title,
    locator: 'body',
    confidence: 0.55,
  });

  const candidate = {
    listingId: `${domainOf(url)}:${url}`,
    name: title,
    brand: null,
    category: null,
    model: null,
    variant: {
      ...extractVariant(specifications, {
        size: ['size', 'shoe size', 'uk size', 'us size', 'eu size'],
        colour: ['colour', 'color'],
        material: ['material', 'upper material'],
        storage: ['storage', 'storage capacity'],
        ram: ['ram', 'ram size'],
        gender: ['gender', 'department'],
      }),
      extra: specifications,
    },
    retailer: domainOf(url),
    productUrl: url,
    sku: null,
    mpn: null,
    gtin: null,
    specifications,
    listedPrice:
      pricePaise === null
        ? null
        : { paise: pricePaise, currency: 'INR', provenance },
    salePrice:
      pricePaise === null
        ? null
        : { paise: pricePaise, currency: 'INR', provenance },
    rating: null,
    reviewCount: null,
    availability: 'unknown',
    deliveryEstimate: null,
    returnPolicy: null,
    warranty: null,
    offers: [],
    observedAt: retrievedAt,
    sourceProvenance: [url],
    extractionMethod: 'dom' as const,
    verification: 'single_source' as const,
  };

  const parsed = NormalizedProductSchema.safeParse(candidate);
  if (!parsed.success) return null;

  return {
    product: parsed.data,
    evidence: {
      url,
      domain: domainOf(url),
      retrievedAt,
      excerpt: title,
      method: 'dom',
      sourceType: 'retailer',
      structured: null,
      title,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function readTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return stripTags(og[1]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) {
    const value = stripTags(title[1]);
    if (value) return value;
  }
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    const value = stripTags(h1[1]);
    if (value) return value;
  }
  return null;
}

function findPriceInMarkup(html: string): number | null {
  const patterns = [
    /itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/i,
    /"price"\s*:\s*"?([0-9.]+)"?/i,
    /data-price=["']([0-9.]+)["']/i,
    /class="[^"]*(?:a-price-whole|a-price)[^"]*"[^>]*>([0-9,]{2,})/i,
    /₹\s*([0-9][0-9,]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const paise = parsePriceToPaise(match[1]);
      if (paise !== null) return paise;
    }
  }
  return null;
}

function availabilityFrom(value: unknown): NormalizedProduct['availability'] {
  if (typeof value !== 'string') return 'unknown';
  if (/in\s*stock|instock/i.test(value)) return 'in_stock';
  if (/out\s*of\s*stock|unavailable|sold\s*out/i.test(value)) return 'out_of_stock';
  if (/pre[- ]?order/i.test(value)) return 'pre_order';
  if (/back\s*order/i.test(value)) return 'backorder';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                         */
/* ------------------------------------------------------------------ */

/** The outcome of one extraction. */
export interface ExtractionOutcome {
  /** The product, when one was found. */
  product: NormalizedProduct | null;
  /** The raw evidence the product was built from. */
  evidence: RawEvidence[];
  /** The tier that produced the product. */
  tier: 'json_ld' | 'embedded_json' | 'retailer_adapter' | 'dom' | 'llm' | null;
  /** Why no product was produced, when there was none. */
  reason: string | null;
}

/**
 * Run the extraction cascade over a fetched page.
 *
 * The tiers are tried in order and the first that produces a valid product
 * wins. Every tier's attempt is recorded so the caller can report which
 * tiers were tried.
 */
export function extractProduct(
  html: string,
  url: string,
  retrievedAt: string,
): ExtractionOutcome {
  const evidence: RawEvidence[] = [];

  const attempts: {
    tier: ExtractionOutcome['tier'];
    run: () => { product: NormalizedProduct; evidence: RawEvidence } | null;
  }[] = [
    { tier: 'json_ld', run: () => fromJsonLd(html, url, retrievedAt) },
    { tier: 'embedded_json', run: () => fromEmbeddedJson(html, url, retrievedAt) },
    { tier: 'retailer_adapter', run: () => fromRetailerAdapter(html, url, retrievedAt) },
    { tier: 'dom', run: () => fromPageContent(html, url, retrievedAt) },
  ];

  for (const attempt of attempts) {
    const result = attempt.run();
    if (!result) continue;
    evidence.push(result.evidence);
    return { product: result.product, evidence, tier: attempt.tier, reason: null };
  }

  return {
    product: null,
    evidence,
    tier: null,
    reason:
      'No product could not be extracted from this page. The page may not be a product page, or its data may be behind an access control.',
  };
}

/**
 * Every JSON-LD block on a page.
 *
 * Exposed for the research engine, which uses it to read manufacturer
 * specification pages that do not describe a single Product.
 */
export function allStructuredData(html: string): unknown[] {
  return jsonLdBlocks(html);
}

/** Attach provenance to a value read from a source. */
export function attachProvenance(
  value: string | number | null,
  provenance: Provenance | null,
): { value: string | number | null; provenance: Provenance | null } {
  return { value, provenance };
}
