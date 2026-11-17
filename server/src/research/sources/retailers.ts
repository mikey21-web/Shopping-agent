/**
 * Retailer adapters.
 *
 * A retailer adapter knows how to find product listings for one retailer
 * and how to read one listing. Adapters are pure description — they hold
 * no state and can be registered, tested and replaced independently.
 *
 * The acquisition hierarchy each adapter implements:
 *
 *   1. An official API or feed, when the retailer publishes one and
 *      credentials are available.
 *   2. Search-engine discovery, to locate the product page.
 *   3. Direct HTTP retrieval of the product page.
 *   4. Browser rendering, for pages that need JavaScript.
 *   5. Structured extraction from whichever of the above succeeded.
 *
 * Adapters never bypass authentication, CAPTCHAs or access controls. An
 * adapter that needs credentials reports that it needs them rather than
 * pretending to work.
 */

import { z } from 'zod';

import {
  NormalizedProductSchema,
  ProvenanceSchema,
  VariantSchema,
  type NormalizedProduct,
  type Provenance,
} from '../extract/schema.ts';

/* ------------------------------------------------------------------ */
/* The adapter contract                                                 */
/* ------------------------------------------------------------------ */

/** How a retailer is allowed to be reached. */
export type RetailerAccess =
  /** An official API or feed. Needs credentials. */
  | 'api'
  /** A public product page reachable over HTTP. */
  | 'public_page'
  /** A product page that needs JavaScript to render. */
  | 'rendered_page';

/** What an adapter needs before it can run. */
export interface RetailerRequirements {
  /** Environment variables that must be present. */
  envVars: string[];
  /** Whether the retailer requires prior approval or a signed agreement. */
  requiresApproval: boolean;
  /** A note about what approval means, when it is required. */
  approvalNote?: string;
}

/**
 * A retailer adapter.
 */
export interface RetailerAdapter {
  /** Stable id, used in provenance and configuration. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The domains this adapter handles. */
  domains: string[];
  /** The categories this adapter is good at. Empty means all. */
  categories: string[];
  /** How the retailer may be reached. */
  access: RetailerAccess;
  /** What the adapter needs in order to run. */
  requirements: RetailerRequirements;
  /**
   * The retailer's own search URL for a query, when there is one.
   * The search engine uses this to find product pages directly.
   */
  searchUrlTemplate?: string;
  /**
   * True when the retailer's search results are rendered by JavaScript
   * and are therefore not in the initial HTML.
   *
   * The acquisition engine reads those retailers' *product* pages over
   * HTTP — which works — but it cannot read their *search* pages that
   * way, so the search-engine channel is used to find the listings
   * instead. The engine reports this rather than silently returning
   * nothing.
   */
  searchIsRendered?: boolean;
  /**
   * Extract a normalised product from a fetched page.
   *
   * Returns null when the page does not contain a usable product — that is
   * a normal outcome, not an error.
   */
  parse(html: string, url: string, retrievedAt: string): NormalizedProduct | null;
}

/* ------------------------------------------------------------------ */
/* Shared parsing helpers                                               */
/* ------------------------------------------------------------------ */

/** Extract every JSON-LD block from a document. */
export function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw.trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      // A malformed block is skipped. Another block may still be usable.
    }
  }

  return blocks;
}

/** Find the first JSON-LD block that is a Product. */
export function findProductJsonLd(html: string): Record<string, unknown> | null {
  for (const block of jsonLdBlocks(html)) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    const type = record['@type'];
    if (type === 'Product') return record;
    if (Array.isArray(type) && type.includes('Product')) return record;
    // Some publishers wrap the product in a graph.
    const graph = record['@graph'];
    if (Array.isArray(graph)) {
      for (const entry of graph) {
        if (entry && typeof entry === 'object') {
          const inner = entry as Record<string, unknown>;
          const innerType = inner['@type'];
          if (innerType === 'Product' || (Array.isArray(innerType) && innerType.includes('Product'))) {
            return inner;
          }
        }
      }
    }
  }
  return null;
}

/** Parse a price that may be written in several ways. */
export function parsePriceToPaise(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  if (typeof value !== 'string') return null;

  // "₹1,29,999", "Rs. 129999.50", "129999"
  // Start at the first digit, so a currency label that itself contains a
  // dot ("Rs.") does not corrupt the number. Commas are Indian or Western
  // grouping separators and are removed. A trailing group of one or two
  // digits after a dot is the decimal part.
  const firstDigit = value.search(/[0-9]/);
  if (firstDigit === -1) return null;

  const numeric = value.slice(firstDigit).replace(/[^0-9.]/g, '');
  if (!numeric) return null;

  // Keep only the first decimal point.
  const firstDot = numeric.indexOf('.');
  let whole: string;
  let fraction: string;

  if (firstDot === -1) {
    whole = numeric;
    fraction = '';
  } else {
    const afterDot = numeric.slice(firstDot + 1).replace(/\./g, '');
    whole = numeric.slice(0, firstDot);
    fraction = afterDot.slice(0, 2);
  }

  if (!whole) return null;

  const parsed = Number.parseFloat(fraction ? `${whole}.${fraction}` : whole);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.round(parsed * 100);
}

/** Normalise a rating to a 0..5 scale. */
export function normaliseRating(value: unknown, scale: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (scale === 5) return value > 5 ? value / 2 : value;
    if (scale === 10) return value / 2;
    if (scale === 100) return value / 20;
    return value;
  }
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  if (scale === 5) return parsed > 5 ? parsed / 2 : parsed;
  if (scale === 10) return parsed / 2;
  if (scale === 100) return parsed / 20;
  return parsed;
}

/** Read the retailer's own labels out of a specification table or list. */
export function readSpecifications(html: string): Record<string, string> {
  const specs: Record<string, string> = {};

  // Table rows: <tr><th>Label</th><td>Value</td></tr>
  //
  // The cell matcher deliberately avoids a backreference. A backreference
  // inside a global regular expression carries `lastIndex` state across
  // calls, and that state makes the second row of a table parse
  // incorrectly when the same module is used many times.
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  rowPattern.lastIndex = 0;
  for (const row of html.matchAll(rowPattern)) {
    const cellPattern = /<(th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    cellPattern.lastIndex = 0;
    const cells = [...(row[1] ?? '').matchAll(cellPattern)].map((cell) =>
      stripTags(cell[2] ?? ''),
    );
    if (cells.length >= 2) {
      const key = cells[0]?.trim();
      const value = cells[1]?.trim();
      if (key && value && key.length < 80) specs[key] = value;
    }
  }

  // Definition lists: <dt>Label</dt><dd>Value</dd>
  const dlPattern = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  dlPattern.lastIndex = 0;
  for (const pair of html.matchAll(dlPattern)) {
    const key = stripTags(pair[1] ?? '').trim();
    const value = stripTags(pair[2] ?? '').trim();
    if (key && value && key.length < 80) specs[key] = value;
  }

  return specs;
}

/** Strip tags and collapse whitespace. */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a provenance record for a value read from a page. */
export function provenanceFor(input: {
  sourceUrl: string;
  retrievedAt: string;
  method: Provenance['method'];
  excerpt?: string | null;
  locator?: string | null;
  confidence?: number;
  evidenceClass?: Provenance['evidenceClass'];
  verification?: Provenance['verification'];
}): Provenance {
  let domain = '';
  try {
    domain = new URL(input.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    domain = 'unknown';
  }

  const result = ProvenanceSchema.safeParse({
    sourceUrl: input.sourceUrl,
    sourceDomain: domain,
    retrievedAt: input.retrievedAt,
    excerpt: input.excerpt ?? null,
    locator: input.locator ?? null,
    method: input.method,
    validation: 'passed',
    confidence: input.confidence ?? 0.8,
    evidenceClass: input.evidenceClass ?? 'objective_fact',
    verification: input.verification ?? 'single_source',
    corroboratingSources: 0,
    conflictingSources: [],
  });

  return result.success ? result.data : (ProvenanceSchema.parse({}) as Provenance);
}

/* ------------------------------------------------------------------ */
/* Variant extraction                                                   */
/* ------------------------------------------------------------------ */

/**
 * Pull variant attributes out of a set of retailer's specifications.
 *
 * The label→attribute mapping is per-category, because "size" means a
 * shoebox number on a shoe and a screen diagonal on a television.
 */
export function extractVariant(
  specifications: Record<string, string>,
  mapping: {
    size?: string[];
    width?: string[];
    colour?: string[];
    material?: string[];
    secondaryMaterial?: string[];
    storage?: string[];
    ram?: string[];
    gender?: string[];
    fit?: string[];
  },
): Record<string, string | null> {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(specifications)) {
    lower[key.toLowerCase().trim()] = value;
  }

  const find = (labels: string[] | undefined): string | null => {
    if (!labels) return null;
    for (const label of labels) {
      const direct = lower[label.toLowerCase()];
      if (direct && direct.trim()) return direct.trim();
      // Fall back to a prefix match: "Size (UK)" for "size".
      for (const [key, value] of Object.entries(lower)) {
        if (key.startsWith(label.toLowerCase()) && value.trim()) return value.trim();
      }
    }
    return null;
  };

  return {
    size: find(mapping.size),
    width: find(mapping.width),
    colour: find(mapping.colour),
    material: find(mapping.material),
    secondaryMaterial: find(mapping.secondaryMaterial),
    storage: find(mapping.storage),
    ram: find(mapping.ram),
    gender: find(mapping.gender),
    fit: find(mapping.fit),
  };
}

/* ------------------------------------------------------------------ */
/* The shared generic adapter builder                                   */
/* ------------------------------------------------------------------ */

/**
 * Build an adapter that reads a page through the standard JSON-LD path.
 *
 * Most retailers publish Schema.org Product JSON-LD. The differences
 * between them are small enough that one careful implementation covers
 * them all; the per-retailer adapters then only need to describe what is
 * different about them.
 */
export function buildJsonLdAdapter(options: {
  id: string;
  name: string;
  domains: string[];
  categories: string[];
  access?: RetailerAccess;
  requirements?: Partial<RetailerRequirements>;
  searchUrlTemplate?: string;
  /**
   * True when the retailer's search results are rendered by JavaScript.
   */
  searchIsRendered?: boolean;
  /** Label→attribute mapping for variant extraction. */
  variantMapping?: Parameters<typeof extractVariant>[1];
  /** Extra specification extraction beyond the shared table reader. */
  extraSpecifications?: (html: string) => Record<string, string>;
  /** Overrides applied after the shared parse. */
  refine?: (product: NormalizedProduct, html: string) => NormalizedProduct;
}): RetailerAdapter {
  const access = options.access ?? 'public_page';
  const requirements: RetailerRequirements = {
    envVars: options.requirements?.envVars ?? [],
    requiresApproval: options.requirements?.requiresApproval ?? false,
    approvalNote: options.requirements?.approvalNote,
  };

  return {
    id: options.id,
    name: options.name,
    domains: options.domains,
    categories: options.categories,
    access,
    requirements,
    searchUrlTemplate: options.searchUrlTemplate,
    searchIsRendered: options.searchIsRendered ?? false,
    parse(html: string, url: string, retrievedAt: string): NormalizedProduct | null {
      const product = findProductJsonLd(html);
      if (!product) return null;

      const name = typeof product.name === 'string' ? product.name : null;
      if (!name) return null;

      const specifications = {
        ...readSpecifications(html),
        ...(options.extraSpecifications ? options.extraSpecifications(html) : {}),
      };

      const offers = product.offers;
      const offerRecord = Array.isArray(offers) ? offers[0] : offers;
      const offer = (offerRecord ?? {}) as Record<string, unknown>;

      const listedPricePaise = parsePriceToPaise(offer.price);
      const salePricePaise = parsePriceToPaise(
        (offer as Record<string, unknown>).price ?? (product as Record<string, unknown>).offers,
      );

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

      const variantRaw = extractVariant(
        specifications,
        options.variantMapping ?? {
          size: ['size', 'shoe size', 'uk size', 'us size', 'eu size'],
          colour: ['colour', 'color'],
          material: ['material', 'upper material', 'fabric'],
          gender: ['gender', 'department'],
        },
      );

      const candidate = {
        listingId: `${options.id}:${url}`,
        name,
        brand,
        category: options.categories[0] ?? null,
        model:
          typeof product.model === 'string'
            ? product.model
            : typeof product.sku === 'string'
              ? product.sku
              : null,
        variant: VariantSchema.parse(variantRaw),
        retailer: options.name,
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
          listedPricePaise === null
            ? null
            : {
                paise: listedPricePaise,
                currency: (offer.priceCurrency as string | undefined) ?? 'INR',
                provenance,
              },
        salePrice:
          salePricePaise === null
            ? null
            : {
                paise: salePricePaise,
                currency: (offer.priceCurrency as string | undefined) ?? 'INR',
                provenance,
              },
        rating: normaliseRating(
          (product.aggregateRating as Record<string, unknown> | undefined)?.ratingValue ??
            product.rating,
          normaliseRating(product.rating, 5) !== null && Number(product.rating) > 5 ? 10 : 5,
        ),
        reviewCount: (() => {
          const raw = (product.aggregateRating as Record<string, unknown> | undefined)
            ?.reviewCount;
          const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
          return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
        })(),
        availability:
          typeof offer.availability === 'string' &&
          /in\s*stock/i.test(offer.availability)
            ? ('in_stock' as const)
            : typeof offer.availability === 'string' &&
                /out\s*of\s*stock|unavailable/i.test(offer.availability)
              ? ('out_of_stock' as const)
              : ('unknown' as const),
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

      return options.refine ? options.refine(parsed.data, html) : parsed.data;
    },
  };
}

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

const adapters = new Map<string, RetailerAdapter>();

/** Register an adapter. */
export function registerRetailerAdapter(adapter: RetailerAdapter): void {
  adapters.set(adapter.id, adapter);
}

/** Every registered adapter. */
export function retailerAdapters(): RetailerAdapter[] {
  return [...adapters.values()];
}

/** The adapter that handles a URL, if any. */
export function adapterForUrl(url: string): RetailerAdapter | null {
  let domain = '';
  try {
    domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  for (const adapter of adapters.values()) {
    for (const candidate of adapter.domains) {
      if (domain === candidate || domain.endsWith(`.${candidate}`)) return adapter;
    }
  }
  return null;
}

/** Adapters that are usable right now. */
export function configuredRetailerAdapters(): RetailerAdapter[] {
  return retailerAdapters().filter((adapter) => {
    if (adapter.requirements.requiresApproval && !hasApproval(adapter)) return false;
    return adapter.requirements.envVars.every((name) => Boolean(process.env[name]));
  });
}

/** Whether the adapter's approval requirement is satisfied. */
export function hasApproval(adapter: RetailerAdapter): boolean {
  const flag = process.env[`${adapter.id.toUpperCase()}_APPROVED`];
  return flag === '1' || flag === 'true';
}

/**
 * The adapters that could not run, and why.
 *
 * The UI shows this so the operator knows a retailer's absence is a
 * configuration problem, not a research failure.
 */
export function retailerAdapterStatus(): {
  id: string;
  name: string;
  domains: string[];
  access: RetailerAccess;
  available: boolean;
  reason: string | null;
  requiresApproval: boolean;
}[] {
  return retailerAdapters().map((adapter) => {
    const missing = adapter.requirements.envVars.filter((name) => !process.env[name]);
    const needsApproval =
      adapter.requirements.requiresApproval && !hasApproval(adapter);

    let reason: string | null = null;
    if (missing.length > 0) {
      reason = `Missing environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`;
    } else if (needsApproval) {
      reason =
        adapter.requirements.approvalNote ??
        'This retailer requires prior approval before its data can be used.';
    }

    return {
      id: adapter.id,
      name: adapter.name,
      domains: adapter.domains,
      access: adapter.access,
      available: reason === null,
      reason,
      requiresApproval: adapter.requirements.requiresApproval,
    };
  });
}

/** Reset the registry. Used by tests. */
export function resetRetailerAdapters(): void {
  adapters.clear();
}

/** The Zod schema used to validate a normalised product. */
export const ProductSchema = NormalizedProductSchema;

/** A helper for adapters that need to check their own shape. */
export function isNormalizedProduct(value: unknown): value is NormalizedProduct {
  return NormalizedProductSchema.safeParse(value).success;
}

export { z };
