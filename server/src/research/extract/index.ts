/**
 * The extraction cascade.
 *
 * Facts are extracted in a fixed order of decreasing trust and increasing
 * cost:
 *
 *   1. JSON-LD          — written by the merchant, machine readable
 *   2. Microdata        — itemprop attributes
 *   3. Meta tags        — og: and product meta tags
 *   4. Retailer parser  — deterministic parser for a known page structure
 *   5. Specification table + price text — layout-based, deterministic
 *   6. Browser DOM      — only when the page needs rendering
 *   7. LLM extraction   — only when the page is unstructured prose
 *
 * The cascade stops as soon as it has enough: there is no point launching a
 * browser when the JSON-LD block already answered the question.
 */

import type { Evidence, ExtractionMethod, ResearchFactKind } from '../types.ts';
import {
  extractJsonLdBlocks,
  extractMetaTags,
  extractMicrodata,
  flattenLd,
  isProductNode,
  ldText,
  readProductNode,
  type StructuredProduct,
} from './structured.ts';
import {
  extractAllSpecs,
  findAvailability,
  findOffers,
  findPrices,
  findReviewSnippets,
  htmlToText,
  type OfferFinding,
  type PriceFinding,
  type SpecPair,
} from './tables.ts';

/** A fact before it is attached to a product and given provenance. */
export interface ExtractedFact {
  kind: ResearchFactKind;
  key: string;
  value: string | number | boolean | null;
  unit?: string | null;
  evidence: Evidence;
  method: ExtractionMethod;
  /** Confidence from the method alone, before agreement is considered. */
  confidence: number;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  /** The structured product, when one was found. */
  product: StructuredProduct | null;
  /** The page title. */
  title: string | null;
  /** Whether a structured product block was present. */
  hadStructuredData: boolean;
  /** Which method produced the most facts. */
  primaryMethod: ExtractionMethod | null;
  /** Offers found in the page text. */
  offers: OfferFinding[];
  /** Prices found in the page text. */
  prices: PriceFinding[];
  /** Review snippets found in the page text. */
  reviewSnippets: { title: string | null; body: string; rating: number | null; verified: boolean | null }[];
  /** Availability as read from the page. */
  availability: { inStock: boolean | null; excerpt: string | null };
}

/** Read the document title. */
export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const title = match?.[1]?.trim();
  return title ? decodeEntities(title) : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ */
/* Spec key normalisation                                              */
/* ------------------------------------------------------------------ */

/**
 * Map a page's specification labels onto canonical keys.
 *
 * Retailers label the same thing a dozen ways: "RAM", "Memory", "RAM Size",
 * "Memory (GB)". Matching them onto one key is what lets two retailers'
 * pages be compared.
 */
const SPEC_KEY_ALIASES: Record<string, string> = {
  ram: 'ram',
  memory: 'ram',
  'memory size': 'ram',
  'ram size': 'ram',
  'ram capacity': 'ram',
  'ram gb': 'ram',
  storage: 'storage',
  'storage capacity': 'storage',
  'internal storage': 'storage',
  'storage type': 'storageType',
  'hard disk': 'storage',
  'ssd capacity': 'storage',
  processor: 'processor',
  cpu: 'processor',
  'processor type': 'processor',
  'processor name': 'processor',
  chipset: 'soc',
  'soc': 'soc',
  display: 'display',
  'display size': 'displaySize',
  'screen size': 'displaySize',
  resolution: 'resolution',
  'display resolution': 'resolution',
  'refresh rate': 'refreshRate',
  battery: 'battery',
  'battery capacity': 'batteryCapacity',
  'battery life': 'batteryLife',
  camera: 'camera',
  'primary camera': 'camera',
  'rear camera': 'camera',
  'camera megapixels': 'cameraMegapixels',
  weight: 'weight',
  'product dimensions': 'dimensions',
  dimensions: 'dimensions',
  'dimension': 'dimensions',
  warranty: 'warranty',
  'warranty details': 'warranty',
  'warranty period': 'warranty',
  colour: 'colour',
  color: 'colour',
  size: 'size',
  material: 'material',
  fabric: 'material',
  'pack size': 'packSize',
  'net quantity': 'packSize',
  quantity: 'packSize',
  capacity: 'capacity',
  'energy rating': 'energyRating',
  'power consumption': 'powerConsumption',
  'noise level': 'noiseLevel',
  'form factor': 'formFactor',
  'driver size': 'driverSize',
  anc: 'anc',
  'number of cores': 'cpuCores',
  'cpu cores': 'cpuCores',
  os: 'operatingSystem',
  'operating system': 'operatingSystem',
  'model number': 'modelNumber',
  'model name': 'model',
  'part number': 'partNumber',
  'item model number': 'modelNumber',
  connectivity: 'connectivity',
  'special feature': 'specialFeatures',
  'included components': 'includedComponents',
  'manufacturer': 'manufacturer',
  'country of origin': 'countryOfOrigin',
  'item weight': 'weight',
  ingredients: 'ingredients',
  'nutritional information': 'nutrition',
  'nutrition facts': 'nutrition',
  'shelf life': 'shelfLife',
  'expiry date': 'expiryDate',
  'country of manufacture': 'countryOfOrigin',
  'care instructions': 'careInstructions',
  'sole material': 'soleMaterial',
  'water resistance': 'waterResistance',
  'skin type': 'skinType',
  'hair type': 'hairType',
};

/** Canonical key for a page label, or null when the label is unknown. */
export function canonicalSpecKey(label: string): string | null {
  const key = label.trim().toLowerCase().replace(/\s*[:*]\s*$/, '');
  if (SPEC_KEY_ALIASES[key]) return SPEC_KEY_ALIASES[key] as string;
  // "Display Size (Inches)" -> "displaySize"
  const cleaned = key.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (SPEC_KEY_ALIASES[cleaned]) return SPEC_KEY_ALIASES[cleaned] as string;
  return null;
}

/* ------------------------------------------------------------------ */
/* Building facts                                                      */
/* ------------------------------------------------------------------ */

function addFact(list: ExtractedFact[], f: ExtractedFact | null): void {
  if (f) list.push(f);
}

function fact(
  kind: ResearchFactKind,
  key: string,
  value: string | number | boolean | null,
  method: ExtractionMethod,
  evidence: Evidence,
  confidence: number,
  unit?: string | null,
): ExtractedFact | null {
  if (value === null || value === undefined || value === '') return null;
  return { kind, key, value, evidence, method, confidence, unit: unit ?? null };
}

const METHOD_BASE: Record<ExtractionMethod, number> = {
  json_ld: 0.92,
  microdata: 0.88,
  meta_tag: 0.78,
  spec_table: 0.74,
  retailer_parser: 0.85,
  search_snippet: 0.42,
  sitemap: 0.4,
  browser_dom: 0.8,
  browser_js: 0.85,
  llm_extraction: 0.55,
  manual: 1,
  seed: 0.3,
};

/* ------------------------------------------------------------------ */
/* The cascade                                                         */
/* ------------------------------------------------------------------ */

export interface ExtractOptions {
  /** The product this page is believed to be about, for labelling only. */
  expectedPartNumber?: string | null;
  /** A deterministic parser for this specific domain, when one exists. */
  retailerParser?: (html: string) => ExtractedFact[] | null;
}

/**
 * Extract every fact we can from an HTML document.
 *
 * The returned facts are not yet verified or attributed to a product — that
 * is the orchestrator's job.
 */
export function extractFacts(html: string, options: ExtractOptions = {}): ExtractionResult {
  const facts: ExtractedFact[] = [];
  const title = extractTitle(html);

  /* --- 1. JSON-LD ------------------------------------------------ */
  let product: StructuredProduct | null = null;
  const ldNodes = flattenLd(extractJsonLdBlocks(html));
  const productNode = ldNodes.find((node) => isProductNode(node));
  if (productNode) {
    product = readProductNode(productNode);

    const push = (f: ExtractedFact | null): void => addFact(facts, f);

    push(
      fact(
        'model_identification',
        'name',
        product.name,
        'json_ld',
        { excerpt: product.name ?? '', locator: 'JSON-LD Product.name' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'model_identification',
        'brand',
        product.brand,
        'json_ld',
        { excerpt: product.brand ?? '', locator: 'JSON-LD Product.brand' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'variant_identification',
        'sku',
        product.sku,
        'json_ld',
        { excerpt: product.sku ?? '', locator: 'JSON-LD Product.sku' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'variant_identification',
        'partNumber',
        product.mpn,
        'json_ld',
        { excerpt: product.mpn ?? '', locator: 'JSON-LD Product.mpn' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'variant_identification',
        'gtin',
        product.gtin,
        'json_ld',
        { excerpt: product.gtin ?? '', locator: 'JSON-LD Product.gtin' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'price',
        'listPrice',
        product.pricePaise,
        'json_ld',
        { excerpt: `₹${(product.pricePaise ?? 0) / 100}`, locator: 'JSON-LD offers.price' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'stock',
        'inStock',
        product.inStock,
        'json_ld',
        { excerpt: String(product.inStock), locator: 'JSON-LD offers.availability' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'owner_experience',
        'rating',
        product.ratingValue,
        'json_ld',
        { excerpt: String(product.ratingValue ?? ''), locator: 'JSON-LD aggregateRating.ratingValue' },
        METHOD_BASE.json_ld,
      ),
    );
    push(
      fact(
        'owner_experience',
        'ratingCount',
        product.ratingCount,
        'json_ld',
        { excerpt: String(product.ratingCount ?? ''), locator: 'JSON-LD aggregateRating.reviewCount' },
        METHOD_BASE.json_ld,
      ),
    );

    for (const [label, value] of Object.entries(product.properties)) {
      const key = canonicalSpecKey(label);
      if (!key) continue;
      push(
        fact(
          'specification',
          key,
          value,
          'json_ld',
          { excerpt: `${label}: ${value}`, locator: `JSON-LD additionalProperty.${label}` },
          METHOD_BASE.json_ld,
        ),
      );
    }
  }

  /* --- 2. Microdata --------------------------------------------- */
  const microdata = extractMicrodata(html);
  if (Object.keys(microdata).length > 0) {
    const microMap: Record<string, { key: string; kind: ResearchFactKind }> = {
      name: { key: 'name', kind: 'model_identification' },
      brand: { key: 'brand', kind: 'model_identification' },
      sku: { key: 'sku', kind: 'variant_identification' },
      mpn: { key: 'partNumber', kind: 'variant_identification' },
      gtin13: { key: 'gtin', kind: 'variant_identification' },
      price: { key: 'listPrice', kind: 'price' },
      priceCurrency: { key: 'currency', kind: 'price' },
      availability: { key: 'availability', kind: 'stock' },
      ratingValue: { key: 'rating', kind: 'owner_experience' },
      reviewCount: { key: 'reviewCount', kind: 'owner_experience' },
    };
    for (const [property, entry] of Object.entries(microMap)) {
      const raw = microdata[property];
      if (!raw) continue;
      const value =
        entry.kind === 'price' && /^\d/.test(raw) ? Math.round(Number(raw.replace(/,/g, '')) * 100) : raw;
      const pushed = fact(
        entry.kind,
        entry.key,
        value,
        'microdata',
        { excerpt: raw, locator: `itemprop=${property}` },
        METHOD_BASE.microdata,
      );
      if (pushed && !facts.some((f) => f.kind === pushed.kind && f.key === pushed.key)) {
        facts.push(pushed);
      }
    }
  }

  /* --- 3. Meta tags --------------------------------------------- */
  const meta = extractMetaTags(html);
  const ogTitle = meta['og:title'];
  const ogDescription = meta['og:description'];
  const ogImage = meta['og:image'];
  if (ogTitle && !facts.some((f) => f.key === 'name')) {
    addFact(
      facts,
      fact(
        'model_identification',
        'name',
        ogTitle,
        'meta_tag',
        { excerpt: ogTitle, locator: 'meta[property=og:title]' },
        METHOD_BASE.meta_tag,
      ),
    );
  }
  if (ogDescription) {
    addFact(
      facts,
      fact(
        'model_identification',
        'description',
        ogDescription,
        'meta_tag',
        { excerpt: ogDescription, locator: 'meta[property=og:description]' },
        METHOD_BASE.meta_tag,
      ),
    );
  }
  if (ogImage) {
    addFact(
      facts,
      fact(
        'source_page',
        'image',
        ogImage,
        'meta_tag',
        { excerpt: ogImage, locator: 'meta[property=og:image]' },
        METHOD_BASE.meta_tag,
      ),
    );
  }

  /* --- 4. Retailer-specific parser ------------------------------- */
  if (options.retailerParser) {
    try {
      const parsed = options.retailerParser(html);
      if (parsed) {
        for (const f of parsed) {
          if (!facts.some((existing) => existing.kind === f.kind && existing.key === f.key)) {
            facts.push(f);
          }
        }
      }
    } catch {
      // A retailer parser that throws is a bug in the parser, not a reason to
      // fail the whole extraction.
    }
  }

  /* --- 5. Layout-based extraction --------------------------------- */
  const text = htmlToText(html);
  const specs: SpecPair[] = extractAllSpecs(html);
  for (const spec of specs) {
    const key = canonicalSpecKey(spec.key);
    if (!key) continue;
    if (facts.some((f) => f.kind === 'specification' && f.key === key)) continue;
    addFact(
      facts,
      fact(
        'specification',
        key,
        spec.value,
        'spec_table',
        { excerpt: `${spec.key}: ${spec.value}`, locator: spec.locator },
        METHOD_BASE.spec_table,
      ),
    );
  }

  const prices = findPrices(text);
  const availability = findAvailability(text);
  const offers = findOffers(text);

  // Only take a price from the text when no structured price was found.
  if (!facts.some((f) => f.kind === 'price' && f.key === 'listPrice')) {
    const listPrice = prices.find((price) => price.role === 'list' || price.role === 'unknown');
    if (listPrice) {
      addFact(
        facts,
        fact(
          'price',
          'listPrice',
          listPrice.paise,
          'spec_table',
          { excerpt: listPrice.excerpt, locator: 'page text', offset: listPrice.offset },
          0.62,
        ),
      );
    }
  }

  const mrp = prices.find((price) => price.role === 'mrp');
  if (mrp) {
    addFact(
      facts,
      fact(
        'price',
        'mrp',
        mrp.paise,
        'spec_table',
        { excerpt: mrp.excerpt, locator: 'page text', offset: mrp.offset },
        0.58,
      ),
    );
  }

  if (availability.inStock !== null && !facts.some((f) => f.kind === 'stock')) {
    addFact(
      facts,
      fact(
        'stock',
        'inStock',
        availability.inStock,
        'spec_table',
        { excerpt: availability.excerpt ?? '', locator: 'page text' },
        0.7,
      ),
    );
  }

  const reviewSnippets = findReviewSnippets(text);

  return {
    facts,
    product,
    title,
    hadStructuredData: product !== null,
    primaryMethod: product ? 'json_ld' : facts.length > 0 ? 'spec_table' : null,
    offers,
    prices,
    reviewSnippets,
    availability,
  };
}

/**
 * Do we need a browser for this page?
 *
 * A page needs rendering when the facts we want are not in the initial HTML.
 * We detect that by the absence of structured data and of prices, which is a
 * good proxy for "this page is rendered client-side".
 */
export function needsBrowser(result: ExtractionResult): boolean {
  if (result.hadStructuredData) return false;
  if (result.prices.length > 0) return false;
  if (result.facts.length >= 3) return false;
  return true;
}

/** Confidence for a method, exposed for the orchestrator. */
export function methodConfidence(method: ExtractionMethod): number {
  return METHOD_BASE[method] ?? 0.5;
}
