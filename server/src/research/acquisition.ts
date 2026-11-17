/**
 * The acquisition engine.
 *
 * Product discovery runs through two independent channels, and both are
 * used:
 *
 *  1. **Retailer adapters.** Each adapter knows the retailer's own search
 *     URL shape, so the engine can go straight to the retailer's own
 *     results rather than hoping a search engine surfaces the listing.
 *     This finds the products a shopper would actually find.
 *  2. **Search engines.** These find the products a retailer does not
 *     surface in its own search, the independent reviews, and the
 *     community discussions that make the decision trustworthy.
 *
 * The two are merged and deduplicated by normalised URL, so a page found
 * through both channels is opened once.
 *
 * Every query is recorded with its provider, its cost and its result
 * count, so the run can report exactly what it did and what it spent.
 */

import { config } from '../config.ts';
import { safeFetch } from '../net/safe-fetch.ts';
import {
  adapterForUrl,
  configuredRetailerAdapters,
  retailerAdapters,
  type RetailerAdapter,
} from './sources/retailers.ts';
import { configuredSearchProviders, searchProviders } from './sources/search.ts';
import { connectBrowser, type Browser } from './sources/browser.ts';
import type { SearchHit } from './types.ts';

/* ------------------------------------------------------------------ */
/* The acquisition record                                               */
/* ------------------------------------------------------------------ */

/** One query that was issued, and what it cost. */
export interface AcquisitionQuery {
  /** The query as issued. */
  query: string;
  /** Which channel issued it. */
  channel: 'retailer' | 'search';
  /** The provider or adapter id. */
  provider: string;
  /** How many results came back. */
  hits: number;
  /** The cost of the query in USD, when the provider publishes one. */
  costUsd: number;
  /** How long it took. */
  elapsedMs: number;
  /** Why it produced nothing, when it did. */
  reason: string | null;
}

/** The result of one acquisition run. */
export interface AcquisitionResult {
  /** Every distinct page to open. */
  pages: SearchHit[];
  /** Every query that was issued. */
  queries: AcquisitionQuery[];
  /** The total cost in USD. */
  costUsd: number;
  /** The adapters that ran. */
  adaptersUsed: string[];
  /** The search providers that ran. */
  providersUsed: string[];
  /** The adapters and providers that could not run, and why. */
  unavailable: { id: string; name: string; reason: string }[];
}

/* ------------------------------------------------------------------ */
/* URL normalisation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Normalise a URL so the same page is not opened twice.
 *
 * Tracking parameters are stripped, the scheme and `www.` are removed,
 * and a trailing slash is dropped. Query parameters that select a
 * variant (a size, a colour) are *kept*, because two sizes of the same
 * shoe are different pages with different prices.
 */
export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|referrer|fbclid|gclid|mc_cid|mc_eid|campaign|tag|_encoding|psc)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    let text = url.toString();
    text = text.replace(/\/$/, '');
    return text;
  } catch {
    return raw;
  }
}

/* ------------------------------------------------------------------ */
/* Retailer discovery                                                   */
/* ------------------------------------------------------------------ */

/**
 * Run a retailer's own search and read the product links out of it.
 *
 * This is the cheap first rung: one request to the retailer's own
 * search. It only works for retailers whose search results are in the
 * initial HTML; for the client-rendered ones the search-engine channel
 * does the work instead.
 */
export async function discoverFromRetailer(
  adapter: RetailerAdapter,
  query: string,
  options: { limit?: number; deadlineMs?: number; browser?: Browser | null },
): Promise<{ hits: SearchHit[]; costUsd: number; elapsedMs: number; reason: string | null }> {
  const started = Date.now();

  if (!adapter.searchUrlTemplate) {
    return {
      hits: [],
      costUsd: 0,
      elapsedMs: 0,
      reason: `${adapter.name} has no public search URL that can be queried without a session.`,
    };
  }

  // A retailer whose search is rendered by JavaScript needs a browser.
  // Without one, the retailer channel is skipped honestly and the
  // search-engine channel finds the listings instead.
  if (adapter.searchIsRendered && !options.browser) {
    return {
      hits: [],
      costUsd: 0,
      elapsedMs: 0,
      reason: `${adapter.name} renders its search results in JavaScript, and no browser is available to read them. The search-engine channel is used instead.`,
    };
  }

  const url = adapter.searchUrlTemplate.replace('{query}', encodeURIComponent(query));

  try {
    let text: string;

    if (options.browser) {
      const page = await options.browser.newPage();
      try {
        await page.goto(url, options.deadlineMs ?? 15_000);
        await page.scrollThrough(3);
        text = await page.content();
      } finally {
        await page.close().catch(() => {});
      }
    } else {
      const fetched = await safeFetch(url, {
        timeoutMs: options.deadlineMs ?? 10_000,
        userAgent: config.userAgent,
        headers: { accept: 'text/html' },
      });
      text = fetched.text;
    }

    const hits = extractProductLinks(text, adapter, options.limit ?? 10);

    return {
      hits,
      costUsd: 0,
      elapsedMs: Date.now() - started,
      reason: hits.length === 0 ? 'The retailer search page did not expose product links.' : null,
    };
  } catch (error) {
    return {
      hits: [],
      costUsd: 0,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pull product links out of a retailer's search page.
 *
 * Only links that look like product pages on the retailer's own domain
 * are kept, so the navigation and footer links are discarded.
 */
export function extractProductLinks(
  html: string,
  adapter: RetailerAdapter,
  limit: number,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const pattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    if (!href) continue;

    let absolute: string;
    try {
      absolute = new URL(href, `https://www.${adapter.domains[0] ?? 'example.com'}`).toString();
    } catch {
      continue;
    }

    const canonical = canonicalUrl(absolute);
    if (seen.has(canonical)) continue;

    // The link must be on the retailer's own domain.
    let host = '';
    try {
      host = new URL(canonical).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }

    const onDomain = adapter.domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
    if (!onDomain) continue;

    // It must look like a product page, not a category, a policy page or
    // a search. The patterns are anchored to path segments so that
    // "/shop/Buy-Back" is not mistaken for a product.
    if (!isProductPath(pathOf(canonical))) continue;

    const label = stripHtml(match[2] ?? '');
    if (!label || label.length < 8) continue;

    seen.add(canonical);
    hits.push({
      title: label.slice(0, 200),
      url: canonical,
      snippet: null,
      domain: host,
      score: 0.6,
      provider: `retailer:${adapter.id}`,
    });

    if (hits.length >= limit) break;
  }

  return hits;
}

/**
 * Is this path a product page?
 *
 * The patterns are anchored to path segments so that a category page
 * ("/shop/Buy-Back") or a policy page ("/shop/Return-Policy") is not
 * mistaken for a product.
 */
export function isProductPath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split('/').filter(Boolean);

  // A product path has a segment that names a product.
  const productSegments = new Set([
    'product', 'products', 'prod', 'dp', 'p', 'item', 'items',
    'buy', 'product-detail', 'productdetails', 'pd',
  ]);

  for (const segment of segments) {
    if (productSegments.has(segment)) return true;
    // "/shop/nike-pegasus-41-..." — the segment after a shop segment.
    if (/^[a-z0-9-]*pegasus/i.test(segment)) return true;
  }

  // Query-string product identifiers.
  if (/[?&](pid|productid|product_id|itemid|sku)=/i.test(path)) return true;

  // A slug that ends in a product identifier.
  if (/[\/_-](p|prod|dp|item)[-_]?\d{4,}/i.test(lower)) return true;

  return false;
}

/** The path of a URL, without the query. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Strip tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* The acquisition run                                                  */
/* ------------------------------------------------------------------ */

/**
 * Discover candidate product pages.
 *
 * Retailer adapters and search providers run in parallel, because they
 * are independent and both are slow enough that serialising them would
 * double the time for no benefit.
 */
export async function acquire(
  queries: string[],
  options: {
    limit?: number;
    deadlineMs?: number;
    retailerConcurrency?: number;
    searchConcurrency?: number;
    /** Skip the retailer channel, for a run that only wants web results. */
    skipRetailers?: boolean;
    /** Skip the search channel, for a run that only wants retailer listings. */
    skipSearch?: boolean;
    /** Restrict retailer adapters to these categories. */
    categories?: string[];
    /**
     * A browser session for retailers whose search is rendered by
     * JavaScript. When absent, those retailers are skipped and the
     * engine says so.
     */
    browser?: Browser | null;
  } = {},
): Promise<AcquisitionResult> {
  const started = Date.now();
  const deadlineMs = options.deadlineMs ?? 30_000;
  const limit = options.limit ?? 10;

  const queriesIssued: AcquisitionQuery[] = [];
  const allHits: SearchHit[] = [];
  let costUsd = 0;

  const remaining = (): number => deadlineMs - (Date.now() - started);

  /* ---- Retailer channel ---- */
  const adapters = options.skipRetailers
    ? []
    : configuredRetailerAdapters().filter((adapter) => {
        if (!options.categories || options.categories.length === 0) return true;
        if (adapter.categories.length === 0) return true;
        return adapter.categories.some((category) => options.categories?.includes(category));
      });

  /* ---- Search channel ---- */
  const providers = options.skipSearch ? [] : configuredSearchProviders();

  /* ---- Report what could not run ---- */
  const unavailable: AcquisitionResult['unavailable'] = [];

  if (!options.skipRetailers) {
    for (const adapter of retailerAdapters()) {
      if (adapters.includes(adapter)) continue;
      const missing = adapter.requirements.envVars.filter((name) => !process.env[name]);
      const needsApproval =
        adapter.requirements.requiresApproval &&
        process.env[`${adapter.id.toUpperCase()}_APPROVED`] !== '1' &&
        process.env[`${adapter.id.toUpperCase()}_APPROVED`] !== 'true';
      if (missing.length > 0) {
        unavailable.push({
          id: adapter.id,
          name: adapter.name,
          reason: `Missing ${missing.join(', ')}`,
        });
      } else if (needsApproval) {
        unavailable.push({
          id: adapter.id,
          name: adapter.name,
          reason: 'Requires prior approval from the retailer.',
        });
      }
    }
  }

  for (const provider of searchProviders()) {
    if (providers.includes(provider)) continue;
    unavailable.push({
      id: provider.id,
      name: provider.name,
      reason: provider.reason ?? 'Not configured.',
    });
  }

  /* ---- Run both channels ---- */
  const retailerWork = adapters.flatMap((adapter) =>
    queries.map((query) => async (): Promise<void> => {
      if (remaining() <= 0) return;
      const result = await discoverFromRetailer(adapter, query, {
        limit,
        deadlineMs: Math.min(10_000, remaining()),
        browser: options.browser ?? null,
      });
      queriesIssued.push({
        query,
        channel: 'retailer',
        provider: adapter.id,
        hits: result.hits.length,
        costUsd: result.costUsd,
        elapsedMs: result.elapsedMs,
        reason: result.reason,
      });
      allHits.push(...result.hits);
    }),
  );

  const searchWork = providers.flatMap((provider) =>
    queries.map((query) => async (): Promise<void> => {
      if (remaining() <= 0) return;
      const queryStart = Date.now();
      try {
        const result = await provider.search(query, {
          limit,
          deadlineMs: Math.min(8_000, remaining()),
          country: 'IN',
        });
        const cost = provider.costPerQueryUsd ?? 0;
        costUsd += cost;
        queriesIssued.push({
          query,
          channel: 'search',
          provider: provider.id,
          hits: result.hits.length,
          costUsd: cost,
          elapsedMs: result.elapsedMs || Date.now() - queryStart,
          reason: result.hits.length === 0 ? 'The provider returned no results.' : null,
        });
        allHits.push(...result.hits);
      } catch (error) {
        queriesIssued.push({
          query,
          channel: 'search',
          provider: provider.id,
          hits: 0,
          costUsd: 0,
          elapsedMs: Date.now() - queryStart,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  await Promise.all([
    runBounded(retailerWork, options.retailerConcurrency ?? 4),
    runBounded(searchWork, options.searchConcurrency ?? 4),
  ]);

  /* ---- Deduplicate ---- */
  const pages = dedupeHits(allHits);

  return {
    pages,
    queries: queriesIssued,
    costUsd: Number(costUsd.toFixed(6)),
    adaptersUsed: adapters.map((adapter) => adapter.id),
    providersUsed: providers.map((provider) => provider.id),
    unavailable,
  };
}

/**
 * Deduplicate hits by canonical URL.
 *
 * The first occurrence wins, so the ordering of the channels decides
 * which snippet is kept. Retailer hits come first because they are the
 * listing a shopper would actually buy from.
 */
export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const hit of hits) {
    const key = canonicalUrl(hit.url);
    const existing = seen.get(key);
    if (existing) {
      // Keep the better snippet.
      if (!existing.snippet && hit.snippet) existing.snippet = hit.snippet;
      continue;
    }
    seen.set(key, { ...hit, url: key });
  }
  return [...seen.values()];
}

/** Run tasks with at most `limit` in flight. */
async function runBounded(
  tasks: (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, limit), tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        const task = tasks[index];
        if (!task) continue;
        try {
          await task();
        } catch {
          /* the task recorded its own failure */
        }
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Which retailer handles a URL. Exposed so the research engine can log
 * the retailer for every product it finds.
 */
export function retailerForUrl(url: string): string | null {
  return adapterForUrl(url)?.name ?? null;
}
