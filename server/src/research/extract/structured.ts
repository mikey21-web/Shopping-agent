/**
 * Structured data extraction.
 *
 * Most modern retailer pages publish their product facts as schema.org
 * JSON-LD. That block is the single highest-value thing on the page: it is
 * machine-readable, it is written by the merchant rather than scraped from
 * layout, and it costs nothing extra to read.
 *
 * This module reads three structured surfaces, in descending order of trust:
 *   1. JSON-LD (`application/ld+json` script blocks, including @graph)
 *   2. Microdata (`itemprop` attributes)
 *   3. Open Graph / product meta tags
 *
 * Nothing here guesses. If a field is absent, it is absent — the caller
 * decides whether a different extraction method should be tried.
 */

import type { Evidence, ExtractionMethod } from '../types.ts';

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

/** Extract every JSON-LD block from an HTML document. */
export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match = pattern.exec(html);
  while (match) {
    const raw = match[1]?.trim() ?? '';
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        blocks.push(parsed);
      } catch {
        // A malformed block is common on real pages. Try to salvage the
        // largest valid JSON object inside it — merchants often emit a
        // trailing comma or wrap the object in stray characters.
        const salvaged = salvageJson(raw);
        if (salvaged !== null) blocks.push(salvaged);
      }
    }
    match = pattern.exec(html);
  }

  return blocks;
}

/** Find the largest parseable JSON value inside a malformed block. */
function salvageJson(raw: string): unknown | null {
  const start = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  const from = start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart);
  if (from === -1) return null;

  for (let end = raw.length; end > from; end -= 1) {
    const slice = raw.slice(from, end);
    try {
      return JSON.parse(slice);
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

/** Flatten a JSON-LD value into a list of node objects, following @graph. */
export function flattenLd(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const entry of node) flattenLd(entry, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;

  const record = node as Record<string, unknown>;
  out.push(record);

  const graph = record['@graph'];
  if (Array.isArray(graph)) {
    for (const entry of graph) flattenLd(entry, out);
  }
  return out;
}

/** The schema.org type of a node, as a lowercase string or null. */
export function ldType(node: Record<string, unknown>): string | null {
  const type = node['@type'];
  if (typeof type === 'string') return type.toLowerCase();
  if (Array.isArray(type) && typeof type[0] === 'string') return (type[0] as string).toLowerCase();
  return null;
}

/** True when the node describes a product (or a product offer). */
export function isProductNode(node: Record<string, unknown>): boolean {
  const type = ldType(node);
  return type === 'product' || type === 'productmodel' || type === 'vehicle' || type === 'productgroup';
}

/* ------------------------------------------------------------------ */
/* Normalising JSON-LD values                                           */
/* ------------------------------------------------------------------ */

/** A JSON-LD value may be a string, a number, an object, or an array of them. */
export function ldValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = ldValue(entry);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = record.name ?? record.value ?? record['@id'];
    if (name !== undefined) return ldValue(name);
  }
  return null;
}

/** Read a property that may be nested under a @graph or an array. */
export function ldGet(node: Record<string, unknown>, key: string): unknown {
  const value = node[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        if (record.name !== undefined || record['@value'] !== undefined) return entry;
      }
    }
    return value[0];
  }
  return value;
}

/** Read a property as a plain value. */
export function ldText(node: Record<string, unknown>, key: string): string | null {
  const resolved = ldValue(ldGet(node, key));
  return resolved === null ? null : String(resolved);
}

/** Read a numeric property, tolerating strings like "16 GB". */
export function ldNumber(node: Record<string, unknown>, key: string): number | null {
  const raw = ldText(node, key);
  if (raw === null) return null;
  const match = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Read a price, preferring `price` over `lowPrice` and understanding
 * price specifications. Returns paise.
 */
export function ldPricePaise(node: Record<string, unknown>): number | null {
  const direct = ldNumber(node, 'price');
  if (direct !== null) return Math.round(direct * 100);

  const spec = ldGet(node, 'priceSpecification');
  if (spec && typeof spec === 'object') {
    const record = spec as Record<string, unknown>;
    const value = ldNumber(record, 'price');
    if (value !== null) return Math.round(value * 100);
  }

  const low = ldNumber(node, 'lowPrice');
  if (low !== null) return Math.round(low * 100);

  return null;
}

/* ------------------------------------------------------------------ */
/* Currency                                                            */
/* ------------------------------------------------------------------ */

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** Format paise as a human-readable amount. */
export function formatPaiseFromLd(paise: number, currency = 'INR'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const rupees = paise / 100;
  return `${symbol}${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ */
/* Product extraction                                                   */
/* ------------------------------------------------------------------ */

export interface StructuredProduct {
  /** The JSON-LD node the facts came from. */
  node: Record<string, unknown>;
  method: ExtractionMethod;
  /** Schema.org type of the node. */
  type: string;
  name: string | null;
  brand: string | null;
  description: string | null;
  sku: string | null;
  mpn: string | null;
  gtin: string | null;
  image: string | null;
  /** Price in paise. */
  pricePaise: number | null;
  currency: string | null;
  /** True when the merchant marks it as available. */
  inStock: boolean | null;
  /** Rating value and count. */
  ratingValue: number | null;
  ratingCount: number | null;
  /** Review count. */
  reviewCount: number | null;
  /** Additional properties (brand, colour, size, material, ...). */
  properties: Record<string, string>;
  /** The raw offers node, when present. */
  offers: Record<string, unknown> | null;
}

/** Read a product node from JSON-LD into a normalised shape. */
export function readProductNode(node: Record<string, unknown>): StructuredProduct {
  const brandRaw = ldGet(node, 'brand');
  let brand: string | null = null;
  if (brandRaw && typeof brandRaw === 'object') {
    const resolved = ldValue(brandRaw as Record<string, unknown>);
    brand = resolved === null ? null : String(resolved);
  } else {
    const resolved = ldValue(brandRaw);
    brand = resolved === null ? null : String(resolved);
  }

  const imageRaw = ldGet(node, 'image');
  let image: string | null = null;
  if (typeof imageRaw === 'string') image = imageRaw;
  else if (Array.isArray(imageRaw) && typeof imageRaw[0] === 'string') image = imageRaw[0];
  else if (imageRaw && typeof imageRaw === 'object') {
    const resolved = ldValue(imageRaw as Record<string, unknown>);
    image = resolved === null ? null : String(resolved);
  }

  const offersRaw = ldGet(node, 'offers');
  const offers =
    offersRaw && typeof offersRaw === 'object' && !Array.isArray(offersRaw)
      ? (offersRaw as Record<string, unknown>)
      : Array.isArray(offersRaw) && offersRaw[0] && typeof offersRaw[0] === 'object'
        ? (offersRaw[0] as Record<string, unknown>)
        : null;

  const aggregateRating = ldGet(node, 'aggregateRating');
  const ratingRecord =
    aggregateRating && typeof aggregateRating === 'object'
      ? (aggregateRating as Record<string, unknown>)
      : null;

  const properties: Record<string, string> = {};
  const additional = ldGet(node, 'additionalProperty');
  const additionalList = Array.isArray(additional) ? additional : additional ? [additional] : [];
  for (const entry of additionalList) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = ldText(record, 'name');
    const value = ldText(record, 'value');
    if (name && value) properties[name] = value;
  }

  const availability = ldText(offers ?? {}, 'availability') ?? ldText(node, 'availability');

  return {
    node,
    method: 'json_ld',
    type: ldType(node) ?? 'product',
    name: ldText(node, 'name'),
    brand: brand === null ? null : String(brand),
    description: ldText(node, 'description'),
    sku: ldText(node, 'sku'),
    mpn: ldText(node, 'mpn'),
    gtin: ldText(node, 'gtin13') ?? ldText(node, 'gtin') ?? ldText(node, 'gtin12'),
    image,
    pricePaise: ldPricePaise(offers ?? node),
    currency: ldText(offers ?? node, 'priceCurrency') ?? 'INR',
    inStock: availability ? /instock/i.test(availability) : null,
    ratingValue: ratingRecord ? ldNumber(ratingRecord, 'ratingValue') : null,
    ratingCount: ratingRecord ? ldNumber(ratingRecord, 'reviewCount') ?? ldNumber(ratingRecord, 'ratingCount') : null,
    reviewCount: ldNumber(node, 'reviewCount'),
    properties,
    offers,
  };
}

/* ------------------------------------------------------------------ */
/* Microdata                                                           */
/* ------------------------------------------------------------------ */

/**
 * Read microdata (`itemprop`) values.
 *
 * Returns a flat map of itemprop name to the content of the element, taking
 * the first occurrence of each property.
 */
export function extractMicrodata(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /<[^>]*itemprop\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match = pattern.exec(html);
  while (match) {
    const property = match[1]?.trim();
    if (property && !(property in values)) {
      const tag = match[0];
      const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
      if (contentMatch) {
        values[property] = decodeEntities(contentMatch[1] ?? '');
      } else {
        const element = readElementContent(html, match.index);
        if (element) values[property] = element;
      }
    }
    match = pattern.exec(html);
  }

  return values;
}

/** Read the text content of the element starting at `start`. */
function readElementContent(html: string, start: number): string | null {
  const openTagEnd = html.indexOf('>', start);
  if (openTagEnd === -1) return null;
  if (html[openTagEnd - 1] === '/') {
    return '';
  }
  const tagName = /^<\s*([a-z0-9]+)/i.exec(html.slice(start, start + 40))?.[1]?.toLowerCase();
  if (!tagName) return null;

  const closeTag = `</${tagName}`;
  const closeIndex = html.toLowerCase().indexOf(closeTag, openTagEnd);
  const inner = html.slice(openTagEnd + 1, closeIndex === -1 ? openTagEnd + 400 : closeIndex);
  const text = decodeEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  return text || null;
}

/* ------------------------------------------------------------------ */
/* Meta tags                                                           */
/* ------------------------------------------------------------------ */

/** Read product-related meta tags. */
export function extractMetaTags(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /<meta\s+[^>]*>/gi;

  let match = pattern.exec(html);
  while (match) {
    const tag = match[0];
    const nameMatch = /(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (nameMatch && contentMatch) {
      const key = nameMatch[1]?.trim().toLowerCase();
      if (key && !(key in values)) values[key] = decodeEntities(contentMatch[1] ?? '');
    }
    match = pattern.exec(html);
  }

  return values;
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Build an evidence record pointing at a JSON-LD property path. */
export function jsonLdEvidence(path: string, excerpt: string): Evidence {
  return {
    excerpt: excerpt.slice(0, 400),
    locator: `JSON-LD ${path}`,
    selector: path,
    offset: null,
  };
}
