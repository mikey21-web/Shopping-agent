/**
 * User-submitted link provider.
 *
 * This is the one data path that works today with no credentials: the user
 * points us at a product page they are already looking at, and we read the
 * standard `schema.org/Product` structured data (JSON-LD) that retailers
 * publish for search engines.
 *
 * Why this is permitted and safe:
 *  - It fetches only the page the user explicitly asked about.
 *  - It reads structured data intended for public consumption, not protected
 *    endpoints. It does not log in, does not bypass CAPTCHAs or anti-bot
 *    controls, and does not crawl search result pages.
 *  - The fetch goes through the SSRF guard, so a user-supplied URL cannot be
 *    used to reach internal services.
 *  - The result is recorded as `origin='live'` but with a `confirmationStatus`
 *    of `pending`, because a page read by SahiPick is not the same as a
 *    price the user has personally verified.
 */

import { parsePriceToPaise } from '../intelligence/normalize/specs.ts';
import { safeFetch } from '../net/safe-fetch.ts';
import type { CategoryId } from '../domain/types.ts';
import type {
  ProviderHealth,
  ProviderResult,
  ProviderSearchOptions,
  RawListing,
  RawOffer,
  RetailerProvider,
} from './types.ts';

/** Retailers we recognise by domain, so we can attribute a user link. */
const DOMAIN_TO_RETAILER: Record<string, 'amazon_in' | 'flipkart' | 'croma' | 'reliance_digital' | 'vijay_sales'> = {
  'amazon.in': 'amazon_in',
  'www.amazon.in': 'amazon_in',
  'flipkart.com': 'flipkart',
  'www.flipkart.com': 'flipkart',
  'croma.com': 'croma',
  'www.croma.com': 'croma',
  'reliancedigital.in': 'reliance_digital',
  'www.reliancedigital.in': 'reliance_digital',
  'vijaysales.com': 'vijay_sales',
  'www.vijaysales.com': 'vijay_sales',
};

function detectCategory(text: string): CategoryId | null {
  const lower = text.toLowerCase();
  if (/iphone|galaxy|pixel|oneplus|vivo|realme|motorola|xiaomi|nothing|oppo/.test(lower) && /phone|mobile/.test(lower)) {
    return 'smartphone';
  }
  if (/laptop|notebook|macbook|idepad|vivobook|inspiron|swift|rog |thinkpad/.test(lower)) return 'laptop';
  if (/tv|television|oled|qled/.test(lower)) return 'tv';
  if (/earbuds|headphone|speaker|audio/.test(lower)) return 'audio';
  if (/watch|smartwatch|band/.test(lower)) return 'smartwatch';
  if (/camera|lens|dslr|mirrorless/.test(lower)) return 'camera';
  return null;
}

/** Extract every JSON-LD block from an HTML document. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1];
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) if (entry && typeof entry === 'object') blocks.push(entry as Record<string, unknown>);
      } else if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        // @graph form
        const graph = record['@graph'];
        if (Array.isArray(graph)) {
          for (const entry of graph) if (entry && typeof entry === 'object') blocks.push(entry as Record<string, unknown>);
        } else {
          blocks.push(record);
        }
      }
    } catch {
      // Malformed JSON-LD is common on retailer pages; skip it quietly.
    }
  }
  return blocks;
}

function findProductNode(blocks: Record<string, unknown>[]): Record<string, unknown> | null {
  for (const block of blocks) {
    const type = block['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((entry) => typeof entry === 'string' && entry.toLowerCase() === 'product')) {
      return block;
    }
  }
  return null;
}

/** Pull an offer object out of a JSON-LD product node. */
function readOffer(node: Record<string, unknown>): RawOffer | null {
  const offers = node.offers;
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const price = record.price ?? record.lowPrice;
    const pricePaise = typeof price === 'string' ? parsePriceToPaise(price) : typeof price === 'number' ? parsePriceToPaise(price) : null;
    if (pricePaise === null) continue;
    const currency = typeof record.priceCurrency === 'string' ? record.priceCurrency : 'INR';
    if (currency.toUpperCase() !== 'INR') continue; // SahiPick prices in INR only.
    const availability = typeof record.availability === 'string' ? record.availability.toLowerCase() : '';
    return {
      id: `ld-offer-${String(record.name ?? 'offer').slice(0, 40)}`,
      kind: 'coupon',
      title: typeof record.name === 'string' ? record.name : 'Retailer listed offer',
      description: typeof record.description === 'string' ? record.description : null,
      flatOffPaise: 0,
    };
  }
  return null;
}

/** Extract brand / model from a JSON-LD product node. */
function readBrand(node: Record<string, unknown>): string | null {
  const brand = node.brand;
  if (typeof brand === 'string') return brand;
  if (brand && typeof brand === 'object') {
    const record = brand as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
  }
  return null;
}

function readModel(node: Record<string, unknown>): string | null {
  if (typeof node.mpn === 'string') return node.mpn;
  if (typeof node.sku === 'string') return node.sku;
  if (typeof node.model === 'string') return node.model;
  return null;
}

function readRating(node: Record<string, unknown>): { rating: number | null; count: number | null } {
  const aggregate = node.aggregateRating;
  if (!aggregate || typeof aggregate !== 'object') return { rating: null, count: null };
  const record = aggregate as Record<string, unknown>;
  const rating = typeof record.ratingValue === 'string' ? Number.parseFloat(record.ratingValue) : typeof record.ratingValue === 'number' ? record.ratingValue : null;
  const count = typeof record.reviewCount === 'string' ? Number.parseInt(record.reviewCount, 10) : typeof record.reviewCount === 'number' ? record.reviewCount : null;
  return {
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    count: count !== null && Number.isFinite(count) ? count : null,
  };
}

export const userLinkProvider: RetailerProvider = {
  id: 'sample',
  name: 'User-submitted product link',
  siteUrl: 'https://example.test/user-link',
  capabilities: {
    categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming', 'appliance'],
    search: false,
    productDetail: true,
    price: true,
    stock: true,
    seller: false,
    reviews: false,
    offers: true,
  },
  terms: {
    accessMethod: 'public_page',
    requiresCredentials: false,
    credentialEnvVars: [],
    attributionRequired: false,
    notes:
      'Reads schema.org/Product structured data from a page the user explicitly supplied. No login, no CAPTCHA solving, no crawling of search results.',
  },
  refreshIntervalMinutes: 60,
  dataConfidence: 0.6,

  configuration() {
    return {
      configured: true,
      reason: 'Always available — requires only a public product URL.',
      hint: null,
    };
  },

  async search(
    _query: string,
    _options?: ProviderSearchOptions,
  ): Promise<ProviderResult<RawListing>> {
    return {
      status: 'unavailable',
      reason: 'This provider reads a single user-supplied product page; it does not support keyword search.',
      hint: 'Submit a product URL instead.',
      observedAt: new Date().toISOString(),
    };
  },

  async getProduct(retailerProductId: string): Promise<ProviderResult<RawListing>> {
    const observedAt = new Date().toISOString();
    let url: URL;
    try {
      url = new URL(retailerProductId);
    } catch {
      return { status: 'error', message: 'That does not look like a valid product URL.', observedAt };
    }

    let html: string;
    try {
      const response = await safeFetch(url.toString(), { timeoutMs: 12_000 });
      html = response.text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch error';
      return {
        status: 'unavailable',
        reason: `Could not read that page: ${message}`,
        hint:
          message.includes('not publicly routable') || message.includes('not permitted')
            ? 'Only public product URLs can be read.'
            : 'The page may require a sign-in or may block automated reads. Paste the product details manually instead.',
        observedAt,
      };
    }

    const blocks = extractJsonLd(html);
    const node = findProductNode(blocks);
    if (!node) {
      return {
        status: 'unavailable',
        reason: 'That page does not publish schema.org/Product structured data, so its details could not be read.',
        hint: 'Paste the product name and price manually, or try the retailer’s own product page.',
        observedAt,
      };
    }

    const name = typeof node.name === 'string' ? node.name : null;
    if (!name) {
      return { status: 'unavailable', reason: 'The structured data on that page has no product name.', observedAt };
    }

    const offers = node.offers;
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
    let listPricePaise: number | null = null;
    let availability: RawListing['availability'] = 'unknown';
    let seller: string | null = null;

    for (const entry of offerList) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const price = record.price ?? record.lowPrice;
      const parsed =
        typeof price === 'string' ? parsePriceToPaise(price) : typeof price === 'number' ? parsePriceToPaise(price) : null;
      if (parsed !== null && listPricePaise === null) listPricePaise = parsed;
      if (typeof record.availability === 'string') {
        const value = record.availability.toLowerCase();
        if (value.includes('instock') || value.includes('in_stock')) availability = 'in_stock';
        else if (value.includes('outofstock') || value.includes('out_of_stock')) availability = 'out_of_stock';
      }
      if (typeof record.seller === 'object' && record.seller) {
        const sellerRecord = record.seller as Record<string, unknown>;
        if (typeof sellerRecord.name === 'string') seller = sellerRecord.name;
      } else if (typeof record.seller === 'string') {
        seller = record.seller;
      }
    }

    const rating = readRating(node);
    const domain = url.hostname.toLowerCase();
    const retailer = DOMAIN_TO_RETAILER[domain] ?? 'sample';
    const brand = readBrand(node);
    const model = readModel(node);
    const image = typeof node.image === 'string' ? node.image : null;
    const description = typeof node.description === 'string' ? node.description : null;
    const category = detectCategory(`${name ?? ''} ${description ?? ''}`);

    return {
      status: 'ok',
      observedAt,
      source: `user-link:${domain}`,
      confidence: 0.6,
      data: [
        {
          retailer,
          retailerProductId: typeof node.sku === 'string' ? node.sku : url.pathname.slice(0, 120),
          title: name,
          url: url.toString(),
          listPricePaise,
          mrpPaise: null,
          availability,
          condition: 'new',
          seller,
          rating: rating.rating,
          ratingCount: rating.count,
          reviewCount: rating.count,
          imageUrl: image,
          deliveryFeePaise: null,
          brand,
          model,
          rawOffers: readOffer(node) ? [readOffer(node) as RawOffer] : [],
        },
      ],
    };
  },

  async health(): Promise<ProviderHealth> {
    return {
      providerId: 'sample',
      providerName: 'User-submitted product link',
      status: 'ok',
      reason: 'Available without credentials.',
      hint: null,
      accessMethod: 'public_page',
      lastSuccessAt: new Date().toISOString(),
      refreshIntervalMinutes: 60,
      dataConfidence: 0.6,
      categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming', 'appliance'],
    };
  },
};
