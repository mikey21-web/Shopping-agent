/**
 * HTTP page retrieval for research.
 *
 * This is the cheap rung of the escalation ladder: most product pages expose
 * their facts in the initial HTML as JSON-LD, microdata or a specification
 * table. Fetching that costs one request and no browser.
 *
 * Everything here is bounded: a timeout, a size cap, a retry budget with
 * backoff, a robots check before the request, and an in-process cache so the
 * same URL is never fetched twice for the same fact kind.
 *
 * SSRF protection comes from `net/safe-fetch.ts` — the URLs here are
 * discovered on the open web and are therefore untrusted input.
 */

import { safeFetch, FetchBlockedError } from '../../net/safe-fetch.ts';
import { config } from '../../config.ts';
import { checkRobots } from '../robots.ts';
import type { RetrievedPage } from '../types.ts';

export interface FetchPageOptions {
  /** Deadline for this fetch, in milliseconds. */
  deadlineMs?: number;
  /** Maximum document size in bytes. */
  maxBytes?: number;
  /** Attempts beyond the first. */
  retries?: number;
  /** Skip the robots check (only for hosts we already know are permitted). */
  skipRobots?: boolean;
  signal?: AbortSignal;
  /** Additional headers. */
  headers?: Record<string, string>;
  /** Cache key override — by default the normalised URL. */
  cacheKey?: string;
}

export interface FetchPageResult {
  page: RetrievedPage | null;
  /** The document body, when the fetch succeeded. */
  html: string | null;
  /** Why the fetch failed, when it did. */
  error: string | null;
  /** The robots decision that applied. */
  robotsDecision: 'allowed' | 'disallowed' | 'unknown' | 'not_checked';
  /** True when the fetch was served from the in-process cache. */
  fromCache: boolean;
  /** Attempts made. */
  attempts: number;
  /** Wall-clock time including retries. */
  elapsedMs: number;
}

/** Normalise a URL so the same page is not fetched twice. */
export function normalisePageUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|referrer|fbclid|gclid|mc_cid|mc_eid|campaign|tag|_encoding)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

interface CacheEntry {
  html: string;
  page: RetrievedPage;
  expiresAt: number;
}

const pageCache = new Map<string, CacheEntry>();
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Clear the page cache. Used by tests. */
export function resetPageCache(): void {
  pageCache.clear();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a page over HTTP, respecting robots, with bounded retries.
 *
 * Retries use exponential backoff with jitter and only happen for transient
 * failures (timeouts, 429, 5xx). A 403 or a robots disallow is final.
 */
export async function fetchPage(
  rawUrl: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  const started = Date.now();
  const url = normalisePageUrl(rawUrl);
  const cacheKey = options.cacheKey ?? url;
  const deadlineMs = options.deadlineMs ?? 15_000;
  const maxRetries = options.retries ?? 2;

  const cached = pageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      page: cached.page,
      html: cached.html,
      error: null,
      robotsDecision: cached.page.robotsDecision ?? 'not_checked',
      fromCache: true,
      attempts: 0,
      elapsedMs: Date.now() - started,
    };
  }

  let robotsDecision: FetchPageResult['robotsDecision'] = 'not_checked';

  if (!options.skipRobots) {
    try {
      const robots = await checkRobots(url);
      robotsDecision = robots.decision;
      if (robots.decision === 'disallowed') {
        return {
          page: null,
          html: null,
          error: `robots.txt disallows ${url}`,
          robotsDecision: 'disallowed',
          fromCache: false,
          attempts: 0,
          elapsedMs: Date.now() - started,
        };
      }
    } catch {
      robotsDecision = 'unknown';
    }
  }

  let attempts = 0;
  let lastError = 'Unknown error';

  while (attempts <= maxRetries) {
    attempts += 1;
    try {
      const { text, finalUrl, status } = await safeFetch(url, {
        timeoutMs: deadlineMs,
        maxBytes: options.maxBytes ?? 3_000_000,
        headers: options.headers,
        userAgent: config.userAgent,
      });

      const page: RetrievedPage = {
        url,
        finalUrl,
        domain: new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, ''),
        status,
        retrievedAt: new Date().toISOString(),
        method: 'meta_tag',
        bytes: text.length,
        robotsDecision,
        rendered: false,
        elapsedMs: Date.now() - started,
      };

      pageCache.set(cacheKey, {
        html: text,
        page,
        expiresAt: Date.now() + PAGE_CACHE_TTL_MS,
      });

      return {
        page,
        html: text,
        error: null,
        robotsDecision,
        fromCache: false,
        attempts,
        elapsedMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof FetchBlockedError) {
        return {
          page: null,
          html: null,
          error: `Blocked: ${error.message}`,
          robotsDecision,
          fromCache: false,
          attempts,
          elapsedMs: Date.now() - started,
        };
      }

      lastError = error instanceof Error ? error.message : String(error);

      // Permanent failures are not retried.
      if (/HTTP 40[13]|HTTP 404|HTTP 410/.test(lastError)) break;

      if (attempts <= maxRetries) {
        const backoff = 250 * 2 ** (attempts - 1) + Math.floor(Math.random() * 150);
        const remaining = deadlineMs - (Date.now() - started);
        if (remaining <= backoff) break;
        await delay(backoff);
      }
    }
  }

  return {
    page: null,
    html: null,
    error: lastError,
    robotsDecision,
    fromCache: false,
    attempts,
    elapsedMs: Date.now() - started,
  };
}

/** How many pages are cached. */
export function pageCacheSize(): number {
  return pageCache.size;
}
