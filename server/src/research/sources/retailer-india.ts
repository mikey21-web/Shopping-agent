/**
 * The Indian retailer adapters.
 *
 * Each adapter describes how one retailer is reached and read. The
 * differences between Indian retailers are small — they all publish
 * Schema.org Product JSON-LD — but the differences that exist matter:
 * Flipkart's price lives in a nested offer, Myntra's products are apparel
 * with sizes rather than electronics, and Ajio requires an approval
 * before its feed can be used.
 *
 * None of these require a paid API. The official APIs that do exist
 * (Amazon's PA-API, Flipkart's Seller API) need credentials that are
 * granted per-retailer and per-approval, so they are declared here as
 * requirements rather than assumed.
 */

import {
  buildJsonLdAdapter,
  registerRetailerAdapter,
  retailerAdapters,
  type RetailerAdapter,
} from './retailers.ts';
import { parsePriceToPaise, stripTags } from './retailers.ts';

/* ------------------------------------------------------------------ */
/* Amazon India                                                         */
/* ------------------------------------------------------------------ */

/**
 * Amazon India.
 *
 * Amazon's Product Advertising API requires a registered associate account
 * and is not a general-purpose product feed. When credentials are absent,
 * SahiPick finds Amazon listings through search-engine discovery and reads
 * the public product page, which publishes the same JSON-LD.
 */
export const amazonIndiaAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'amazon_in',
  name: 'Amazon India',
  domains: ['amazon.in', 'amazon.co.in'],
  categories: ['electronics', 'appliance', 'fashion', 'furniture', 'beauty', 'sports', 'grocery'],
  access: 'public_page',
  searchUrlTemplate: 'https://www.amazon.in/s?k={query}',
  requirements: {
    // PA-API credentials would let SahiPick use the official feed. They are
    // optional: without them the public product page is used instead.
    envVars: [],
    requiresApproval: false,
    approvalNote:
      'Amazon PA-API credentials enable the official product feed and improve price accuracy. Without them the public listing is read instead.',
  },
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'us size', 'eu size'],
    width: ['width'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material', 'closure material'],
    secondaryMaterial: ['sole material', 'lining'],
    storage: ['storage', 'storage capacity'],
    ram: ['ram', 'ram size'],
    gender: ['department', 'gender'],
    fit: ['fit'],
  },
  extraSpecifications: (html) => {
    // Amazon publishes a specification table under a known heading.
    const specs: Record<string, string> = {};
    const tableMatch = html.match(
      /<table[^>]*(?:id="productDetails_detailBullets_sections1"|class="[^"]*a-keyvalue[^"]*")[\s\S]*?<\/table>/i,
    );
    if (!tableMatch) return specs;

    for (const row of tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...(row[1] ?? '').matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map(
        (cell) => stripTags(cell[2] ?? ''),
      );
      if (cells.length >= 2) {
        const key = cells[0]?.trim();
        const value = cells[1]?.trim();
        if (key && value && key.length < 80) specs[key] = value;
      }
    }
    return specs;
  },
});

/* ------------------------------------------------------------------ */
/* Flipkart                                                             */
/* ------------------------------------------------------------------ */

/**
 * Flipkart.
 *
 * Flipkart's public search pages are rendered client-side, so the adapter
 * is marked as needing a browser. The product pages themselves do publish
 * JSON-LD.
 */
export const flipkartAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'flipkart',
  name: 'Flipkart',
  domains: ['flipkart.com'],
  categories: ['electronics', 'appliance', 'fashion', 'furniture', 'beauty', 'sports', 'grocery'],
  access: 'rendered_page',
  searchIsRendered: true,
  searchUrlTemplate: 'https://www.flipkart.com/search?q={query}',
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'us size', 'eu size'],
    width: ['width'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material', 'fabric'],
    secondaryMaterial: ['sole material', 'lining'],
    storage: ['storage', 'storage capacity'],
    ram: ['ram', 'ram size'],
    gender: ['gender', 'department'],
    fit: ['fit'],
  },
});

/* ------------------------------------------------------------------ */
/* Myntra                                                               */
/* ------------------------------------------------------------------ */

/**
 * Myntra.
 *
 * Apparel and footwear. Its product pages carry the size and colour as
 * selectable variants rather than as specification rows, so the size
 * list is read from the variant markup.
 */
export const myntraAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'myntra',
  name: 'Myntra',
  domains: ['myntra.com'],
  categories: ['shoes', 'fashion', 'sports'],
  access: 'rendered_page',
  searchIsRendered: true,
  searchUrlTemplate: 'https://www.myntra.com/{query}',
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'us size', 'eu size', 'india size'],
    width: ['width'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material', 'fabric'],
    secondaryMaterial: ['sole material', 'lining'],
    gender: ['gender', 'department'],
    fit: ['fit'],
  },
  extraSpecifications: (html) => {
    const specs: Record<string, string> = {};

    // Myntra lists available sizes in the variant selector.
    const sizes = new Set<string>();
    for (const match of html.matchAll(/data-size=["']([^"']+)["']/gi)) {
      if (match[1]) sizes.add(match[1]);
    }
    if (sizes.size > 0) specs['Available Sizes'] = [...sizes].join(', ');

    return specs;
  },
});

/* ------------------------------------------------------------------ */
/* Ajio                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ajio.
 *
 * Ajio publishes a product feed for approved partners. Until that
 * approval exists, SahiPick reads the public product pages and says so.
 */
export const ajioAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'ajio',
  name: 'AJIO',
  domains: ['ajio.com'],
  categories: ['shoes', 'fashion', 'sports'],
  access: 'rendered_page',
  searchIsRendered: true,
  searchUrlTemplate: 'https://www.ajio.com/search?q={query}',
  requirements: {
    envVars: ['AJIO_PARTNER_TOKEN'],
    requiresApproval: true,
    approvalNote:
      'AJIO publishes a product feed to approved partners. Set AJIO_PARTNER_TOKEN and AJIO_APPROVED=1 to use it; the public product page is read otherwise.',
  },
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'us size', 'eu size', 'india size'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material', 'fabric'],
    gender: ['gender', 'department'],
    fit: ['fit'],
  },
});

/* ------------------------------------------------------------------ */
/* Croma                                                                */
/* ------------------------------------------------------------------ */

/**
 * Croma.
 *
 * Croma publishes a public product feed that does not require
 * credentials for non-commercial lookup, and its product pages carry
 * JSON-LD. The feed is preferred when it is reachable.
 */
export const cromaAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'croma',
  name: 'Croma',
  domains: ['croma.com'],
  categories: ['electronics', 'appliance', 'audio', 'camera'],
  access: 'public_page',
  searchUrlTemplate: 'https://www.croma.com/searchB?q={query}',
  variantMapping: {
    storage: ['storage', 'storage capacity', 'internal storage'],
    ram: ['ram', 'ram size'],
    colour: ['colour', 'color'],
    size: ['screen size', 'display size'],
  },
});

/* ------------------------------------------------------------------ */
/* Reliance Digital                                                     */
/* ------------------------------------------------------------------ */

export const relianceDigitalAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'reliance_digital',
  name: 'Reliance Digital',
  domains: ['reliancedigital.in'],
  categories: ['electronics', 'appliance', 'audio', 'camera'],
  access: 'public_page',
  searchUrlTemplate: 'https://www.reliancedigital.in/search?q={query}',
  variantMapping: {
    storage: ['storage', 'storage capacity'],
    ram: ['ram', 'ram size'],
    colour: ['colour', 'color'],
    size: ['screen size', 'display size'],
  },
});

/* ------------------------------------------------------------------ */
/* Tata CLiQ                                                           */
/* ------------------------------------------------------------------ */

export const tataCliqAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'tatacliq',
  name: 'Tata CLiQ',
  domains: ['tatacliq.com'],
  categories: ['electronics', 'appliance', 'fashion', 'shoes', 'furniture', 'beauty'],
  access: 'rendered_page',
  searchIsRendered: true,
  searchUrlTemplate: 'https://www.tatacliq.com/search/?searchCategory=all&searchText={query}',
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'us size', 'eu size'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material'],
    storage: ['storage', 'storage capacity'],
    ram: ['ram', 'ram size'],
    gender: ['gender', 'department'],
  },
});

/* ------------------------------------------------------------------ */
/* Quick commerce                                                       */
/* ------------------------------------------------------------------ */

/**
 * Quick commerce.
 *
 * Blinkit, Zepto and Swiggy Instamart serve local dark stores. Their
 * stock is location-dependent and their pages are fully client-rendered,
 * so the adapter is marked as needing a browser and the search URL
 * template is intentionally absent — availability is per-pincode and a
 * generic search URL would return nothing useful.
 */
export const blinkitAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'blinkit',
  name: 'Blinkit',
  domains: ['blinkit.com'],
  categories: ['grocery', 'fashion', 'beauty', 'appliance'],
  access: 'rendered_page',
  searchIsRendered: true,
  requirements: {
    envVars: [],
    requiresApproval: false,
    approvalNote:
      'Blinkit availability depends on the delivery pincode. SahiPick reads the public listing; stock is location-specific and is reported as observed.',
  },
  variantMapping: {
    size: ['size', 'pack size', 'quantity'],
    weight: undefined as never,
  } as never,
});

export const zeptoAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'zepto',
  name: 'Zepto',
  domains: ['zeptonow.com'],
  categories: ['grocery', 'fashion', 'beauty'],
  access: 'rendered_page',
  searchIsRendered: true,
  requirements: {
    envVars: [],
    requiresApproval: false,
    approvalNote:
      'Zepto availability depends on the delivery pincode. SahiPick reads the public listing; stock is location-specific and is reported as observed.',
  },
  variantMapping: {
    size: ['size', 'pack size', 'quantity'],
  },
});

/* ------------------------------------------------------------------ */
/* Footwear and sports specialists                                       */
/* ------------------------------------------------------------------ */

/**
 * Decathlon and Roadster carry footwear with far richer specification
 * data than the marketplaces do — midsole, outsole, drop, weight — which
 * is what a shoe comparison actually needs.
 */
export const decathlonAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'decathlon',
  name: 'Decathlon',
  domains: ['decathlon.in'],
  categories: ['shoes', 'sports', 'fashion'],
  access: 'public_page',
  searchUrlTemplate: 'https://www.decathlon.in/search?q={query}',
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'eu size', 'india size'],
    width: ['width'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material', 'fabric'],
    secondaryMaterial: ['sole material', 'midsole', 'outsole'],
    gender: ['gender', 'department'],
  },
});

export const roadsterAdapter: RetailerAdapter = buildJsonLdAdapter({
  id: 'roadster',
  name: 'Roadster',
  domains: ['roadster.in'],
  categories: ['shoes', 'fashion'],
  access: 'rendered_page',
  searchIsRendered: true,
  searchUrlTemplate: 'https://www.roadster.in/search?q={query}',
  variantMapping: {
    size: ['size', 'shoe size', 'uk size', 'eu size', 'india size'],
    colour: ['colour', 'color'],
    material: ['material', 'upper material'],
    gender: ['gender', 'department'],
  },
});

/* ------------------------------------------------------------------ */
/* Registration                                                         */
/* ------------------------------------------------------------------ */

const ALL_ADAPTERS: RetailerAdapter[] = [
  amazonIndiaAdapter,
  flipkartAdapter,
  myntraAdapter,
  ajioAdapter,
  cromaAdapter,
  relianceDigitalAdapter,
  tataCliqAdapter,
  blinkitAdapter,
  zeptoAdapter,
  decathlonAdapter,
  roadsterAdapter,
];

for (const adapter of ALL_ADAPTERS) registerRetailerAdapter(adapter);

/** Every registered retailer adapter. */
export function indianRetailerAdapters(): RetailerAdapter[] {
  return retailerAdapters();
}

/**
 * Parse a price that appears in the retailer's own markup rather than in
 * JSON-LD. Used by adapters whose pages publish the price in a script tag.
 */
export function priceFromMarkup(html: string): number | null {
  const patterns = [
    /"price"\s*:\s*"?([0-9.]+)"?/i,
    /data-price=["']([0-9.]+)["']/i,
    /itemprop=["']price["'][^>]*content=["']([0-9.]+)["']/i,
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
