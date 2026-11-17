/**
 * Layout-based extraction.
 *
 * Some pages publish no structured data, or only a partial block. This module
 * reads facts out of the ordinary page furniture:
 *
 *   - specification tables (`<table>`, `<dl>`, and label/value `<li>` pairs)
 *   - prices written as text ("₹62,990", "Rs. 62,990", "MRP ₹72,999")
 *   - availability language ("In stock", "Out of stock", "Currently unavailable")
 *   - discount language ("Save ₹10,000", "45% off")
 *   - offer/coupon text ("10% off with HDFC Bank", "Apply coupon BOAT200")
 *
 * Everything is deterministic and evidence-bearing. A price is never inferred
 * from a sentence that does not contain one.
 */

import { decodeEntities } from './structured.ts';

/* ------------------------------------------------------------------ */
/* Specification tables                                                */
/* ------------------------------------------------------------------ */

export interface SpecPair {
  key: string;
  value: string;
  /** Where the pair was found. */
  locator: string;
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Keys that are noise rather than specification. */
const SPEC_NOISE = new Set([
  ' ',
  'more',
  'read more',
  'show more',
  'see more',
  'view more',
  'details',
  'specification',
  'specifications',
  'general',
  'overview',
  'features',
  'reviews',
  'faq',
  'compare',
  'price',
  'quantity',
  'delivery',
  'shipping',
  'you may also like',
  'recently viewed',
  'customers also bought',
]);

/** Extract key/value pairs from `<table>` markup. */
export function extractTableSpecs(html: string): SpecPair[] {
  const pairs: SpecPair[] = [];
  const tablePattern = /<table[\s\S]*?<\/table>/gi;

  let tableMatch = tablePattern.exec(html);
  while (tableMatch) {
    const table = tableMatch[0];
    const rowPattern = /<tr[\s\S]*?<\/tr>/gi;
    let rowMatch = rowPattern.exec(table);

    while (rowMatch) {
      const row = rowMatch[0];
      const cellPattern = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      const cells: string[] = [];
      let cellMatch = cellPattern.exec(row);
      while (cellMatch) {
        cells.push(cleanText(cellMatch[2] ?? ''));
        cellMatch = cellPattern.exec(row);
      }

      if (cells.length === 2) {
        const [key, value] = cells;
        if (key && value && !SPEC_NOISE.has(key.toLowerCase())) {
          pairs.push({ key, value, locator: 'table row' });
        }
      } else if (cells.length >= 3) {
        // Some tables alternate key/value/key/value in one row.
        for (let i = 0; i + 1 < cells.length; i += 2) {
          const key = cells[i];
          const value = cells[i + 1];
          if (key && value && !SPEC_NOISE.has(key.toLowerCase())) {
            pairs.push({ key, value, locator: 'table row' });
          }
        }
      }

      rowMatch = rowPattern.exec(table);
    }

    tableMatch = tablePattern.exec(html);
  }

  return pairs;
}

/** Extract key/value pairs from `<dl>` description lists. */
export function extractDefinitionSpecs(html: string): SpecPair[] {
  const pairs: SpecPair[] = [];
  const pattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;

  let match = pattern.exec(html);
  while (match) {
    const key = cleanText(match[1] ?? '');
    const value = cleanText(match[2] ?? '');
    if (key && value && !SPEC_NOISE.has(key.toLowerCase())) {
      pairs.push({ key, value, locator: 'definition list' });
    }
    match = pattern.exec(html);
  }

  return pairs;
}

/**
 * Extract key/value pairs from label/value markup.
 *
 * Retailers frequently use `<span class="label">RAM</span><span>8 GB</span>`
 * rather than a real table. We look for a label-ish class or a bolded label
 * immediately followed by a value.
 */
export function extractLabelledSpecs(html: string): SpecPair[] {
  const pairs: SpecPair[] = [];

  const classPattern =
    /<(?:span|div|p|li|td|th|dt)\b[^>]*class\s*=\s*["'][^"']*\b(?:label|title|key|spec-name|prop-name|feature-name|attr-name)\b[^"']*["'][^>]*>([\s\S]{0,200}?)<\/\1>\s*<[^>]*>([\s\S]{0,300}?)<\//gi;
  let match = classPattern.exec(html);
  while (match) {
    const key = cleanText(match[1] ?? '');
    const value = cleanText(match[2] ?? '');
    if (key && value && key.length <= 80 && !SPEC_NOISE.has(key.toLowerCase())) {
      pairs.push({ key, value, locator: 'labelled element' });
    }
    match = classPattern.exec(html);
  }

  // Bold label followed by plain text: <b>Display</b> 6.7 inches
  const boldPattern = /<(?:b|strong)\b[^>]*>([\s\S]{0,120}?)<\/(?:b|strong)>\s*[:\-–]?\s*([^<>]{1,200}?)(?:<\/|<br|<div|<p|<\/li|;)/gi;
  match = boldPattern.exec(html);
  while (match) {
    const key = cleanText(match[1] ?? '');
    const value = cleanText(match[2] ?? '');
    if (key && value && key.length <= 60 && !SPEC_NOISE.has(key.toLowerCase())) {
      pairs.push({ key, value, locator: 'bold label' });
    }
    match = boldPattern.exec(html);
  }

  return pairs;
}

/** Every specification pair found on a page, deduplicated by key. */
export function extractAllSpecs(html: string): SpecPair[] {
  const all = [...extractTableSpecs(html), ...extractDefinitionSpecs(html), ...extractLabelledSpecs(html)];
  const seen = new Map<string, SpecPair>();
  for (const pair of all) {
    const key = pair.key.toLowerCase();
    if (!seen.has(key)) seen.set(key, pair);
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/** A price found in page text. */
export interface PriceFinding {
  /** The amount in paise. */
  paise: number;
  /** The verbatim text it came from. */
  excerpt: string;
  /** What the price represents. */
  role: 'list' | 'mrp' | 'sale' | 'discount' | 'unknown';
  /** Character offset in the document. */
  offset: number;
}

const RUPEE_PATTERN = /(?:₹|rs\.?\s*|inr\s*)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;

/**
 * Find rupee amounts in a block of text.
 *
 * `contextBefore` classifies the amount: an MRP mentioned before the price
 * makes it a reference price, not the payable one.
 */
export function findPrices(text: string, window = 60): PriceFinding[] {
  const findings: PriceFinding[] = [];
  RUPEE_PATTERN.lastIndex = 0;

  let match = RUPEE_PATTERN.exec(text);
  while (match) {
    const digits = (match[1] ?? '').replace(/,/g, '');
    const value = Number(digits);
    if (Number.isFinite(value) && value > 0) {
      const before = text.slice(Math.max(0, match.index - window), match.index).toLowerCase();
      let role: PriceFinding['role'] = 'unknown';
      if (/\bmrp\b|was\s*₹|~~/.test(before)) role = 'mrp';
      else if (/save|discount|off|reduced|deal/.test(before)) role = 'discount';
      else if (/(sale price|our price|price|₹)/.test(before)) role = 'list';

      findings.push({
        paise: Math.round(value * 100),
        excerpt: text.slice(match.index, match.index + match[0].length + 24).trim(),
        role,
        offset: match.index,
      });
    }
    match = RUPEE_PATTERN.exec(text);
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

const IN_STOCK = /\b(in stock|available now|add to cart|buy now|ships from|instant delivery|available)\b/i;
const OUT_OF_STOCK =
  /\b(out of stock|out-of-stock|currently unavailable|sold out|notify me|not available|temporarily unavailable|unavailable)\b/i;

/** Read availability language from page text. */
export function findAvailability(text: string): { inStock: boolean | null; excerpt: string | null } {
  const outMatch = OUT_OF_STOCK.exec(text);
  if (outMatch) {
    return { inStock: false, excerpt: text.slice(outMatch.index, outMatch.index + outMatch[0].length).trim() };
  }
  const inMatch = IN_STOCK.exec(text);
  if (inMatch) {
    return { inStock: true, excerpt: text.slice(inMatch.index, inMatch.index + inMatch[0].length).trim() };
  }
  return { inStock: null, excerpt: null };
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

export interface OfferFinding {
  title: string;
  kind:
    | 'coupon'
    | 'bank_discount'
    | 'card_offer'
    | 'cashback'
    | 'emi'
    | 'no_cost_emi'
    | 'exchange'
    | 'delivery'
    | 'membership';
  percentOff: number | null;
  flatOffPaise: number | null;
  cashbackPaise: number | null;
  couponCode: string | null;
  bank: string | null;
  excerpt: string;
}

const BANK_NAMES = [
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'SBI Card',
  'State Bank of India',
  'Kotak',
  'Yes Bank',
  'IDFC FIRST',
  'IndusInd Bank',
  'Bank of Baroda',
  'Punjab National Bank',
  'Canara Bank',
  'Union Bank',
  'IDBI Bank',
  'Federal Bank',
  'AU Bank',
  'Paytm Payments Bank',
  'Amazon Pay',
  'Flipkart',
  'Croma',
  'Reliance Digital',
  'Vijay Sales',
];

const COUPON_CODE = /\b(?:coupon(?:\s*code)?|promo(?:code)?)\s*[:\-]?\s*([A-Z0-9]{4,20})\b/i;

/**
 * Find offer lines in page text.
 *
 * This reads what the page says about offers; it does not decide which offers
 * the shopper is eligible for. Eligibility is evaluated by the existing
 * deterministic offer engine.
 */
export function findOffers(text: string): OfferFinding[] {
  const findings: OfferFinding[] = [];
  const seen = new Set<string>();

  const lines = text
    .split(/\n|(?<=[.!])\s{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 3 && line.length < 220);

  for (const line of lines) {
    const lower = line.toLowerCase();
    const hasOfferWord =
      /\b(discount|offer|off\b|cashback|emi|exchange|bank offer|coupon|savings?)\b/.test(lower);
    if (!hasOfferWord) continue;

    const percentMatch = /(\d{1,2}(?:\.\d)?)\s*%\s*(?:off|discount|instant discount)/i.exec(line);
    const flatMatch = /(?:₹|rs\.?)\s*([0-9][0-9,]*)/i.exec(line);
    const cashbackMatch = /(?:₹|rs\.?)\s*([0-9][0-9,]*)\s*(?:cashback|back)/i.exec(line);

    let kind: OfferFinding['kind'] = 'coupon';
    let bank: string | null = null;
    for (const candidate of BANK_NAMES) {
      if (lower.includes(candidate.toLowerCase())) {
        bank = candidate;
        if (/emi/.test(lower)) kind = /no[\s-]?cost/.test(lower) ? 'no_cost_emi' : 'emi';
        else if (/cashback/.test(lower)) kind = 'cashback';
        else if (/exchange/.test(lower)) kind = 'exchange';
        else if (/(credit|debit)\s*card|bank offer|net banking/.test(lower)) kind = 'bank_discount';
        else if (/delivery/.test(lower)) kind = 'delivery';
        break;
      }
    }
    if (!bank) {
      if (/cashback/.test(lower)) kind = 'cashback';
      else if (/\bemi\b/.test(lower)) kind = /no[\s-]?cost/.test(lower) ? 'no_cost_emi' : 'emi';
      else if (/exchange/.test(lower)) kind = 'exchange';
      else if (/delivery/.test(lower)) kind = 'delivery';
      else if (/coupon|promo/.test(lower)) kind = 'coupon';
      else if (percentMatch) kind = 'bank_discount';
    }

    const codeMatch = COUPON_CODE.exec(line);
    const key = `${kind}:${line.slice(0, 40).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      title: line,
      kind,
      percentOff: percentMatch ? Number(percentMatch[1]) : null,
      flatOffPaise: !percentMatch && flatMatch ? Math.round(Number(flatMatch[1]?.replace(/,/g, '')) * 100) : null,
      cashbackPaise: cashbackMatch ? Math.round(Number(cashbackMatch[1]?.replace(/,/g, '')) * 100) : null,
      couponCode: codeMatch?.[1]?.toUpperCase() ?? null,
      bank,
      excerpt: line,
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Review snippets                                                     */
/* ------------------------------------------------------------------ */

export interface ReviewSnippet {
  title: string | null;
  body: string;
  rating: number | null;
  verified: boolean | null;
  excerpt: string;
}

/** Find review-shaped text on a product page. */
export function findReviewSnippets(text: string): ReviewSnippet[] {
  const snippets: ReviewSnippet[] = [];

  // Reviews usually sit under a heading and run for a couple of sentences.
  const pattern =
    /(?:^|\n)\s*(?:★|⭐|\d(?:\.\d)?\s*(?:\/\s*5|\s*star))[^\n]{0,40}\n([^\n]{40,600})/gi;
  let match = pattern.exec(text);
  while (match) {
    const body = (match[1] ?? '').trim();
    if (body.length > 40) {
      const ratingMatch = /(\d(?:\.\d)?)\s*(?:\/\s*5|stars?)/i.exec(match[0]);
      snippets.push({
        title: null,
        body,
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        verified: /\bverified\b/i.test(body),
        excerpt: body.slice(0, 300),
      });
    }
    match = pattern.exec(text);
  }

  return snippets;
}

/** Strip a document down to readable text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
