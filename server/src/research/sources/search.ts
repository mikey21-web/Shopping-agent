/**
 * Multi-provider web search.
 *
 * SahiPick does not depend on any single search vendor. Each provider is an
 * independent adapter that declares its own configuration state, cost and
 * rate limit, so the orchestrator can fan out across whichever ones are
 * actually available and report the ones that were not.
 *
 * Providers are chosen for a reason:
 *   cloudflare   — one endpoint, many upstream engines (Exa, Linkup, Ceramic),
 *                  account-level auth, and AI Gateway caching in front of it.
 *   exa          — best-in-class semantic and "similar page" search; the
 *                  default choice when a product model is known.
 *   linkup       — strong on recency and on commercial queries.
 *   brave        — independent index; useful as a cross-check on Exa.
 *   searxng      — self-hostable, keyless, aggregates many engines.
 *   duckduckgo   — keyless fallback; best-effort HTML endpoint.
 *
 * Every provider returns the same `SearchHit` shape, so nothing downstream
 * knows or cares which one produced a result.
 */

import { config } from '../../config.ts';
import { safeFetch } from '../../net/safe-fetch.ts';
import type {
  SearchHit,
  SearchOptions,
  SearchProvider,
  SearchProviderResult,
} from '../types.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    // Strip tracking parameters so the same page is not fetched twice.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|referrer|fbclid|gclid|mc_cid|mc_eid|tag|campaign)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

/** Apply the include/exclude/recent filters the provider did not apply itself. */
function applyFilters(hits: SearchHit[], options: SearchOptions): SearchHit[] {
  const include = options.includeDomains?.map((domain) => domain.toLowerCase());
  const exclude = options.excludeDomains?.map((domain) => domain.toLowerCase());
  const cutoff =
    options.recencyDays && options.recencyDays > 0
      ? Date.now() - options.recencyDays * 86_400_000
      : null;

  return hits.filter((hit) => {
    const domain = hit.domain.toLowerCase();
    if (include?.length && !include.some((allowed) => domain.includes(allowed))) {
      return false;
    }
    if (exclude?.length && exclude.some((blocked) => domain.includes(blocked))) {
      return false;
    }
    if (cutoff !== null && hit.publishedAt) {
      const published = Date.parse(hit.publishedAt);
      if (Number.isFinite(published) && published < cutoff) return false;
    }
    return true;
  });
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Response was not JSON');
  }
}

/* ------------------------------------------------------------------ */
/* Cloudflare Web Search API                                            */
/* ------------------------------------------------------------------ */

/**
 * Cloudflare's Web Search API.
 *
 * One endpoint, several upstream engines. Exa and Linkup are semantic search
 * engines with different strengths; Ceramic is the newest of the three.
 *
 * `CLOUDFLARE_WEB_SEARCH_ENGINE` selects the upstream engine.
 */
export function cloudflareProvider(): SearchProvider {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? null;
  const token = process.env.CLOUDFLARE_WEB_SEARCH_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? null;
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID ?? 'default';
  const engine = process.env.CLOUDFLARE_WEB_SEARCH_ENGINE ?? 'ceramic';

  const configured = Boolean(accountId && token);

  // Cloudflare prices the upstream engine at its list price, charged against
  // AI Gateway credits (or BYOK, where the provider bills directly).
  const COST_PER_QUERY_USD: Record<string, number> = {
    ceramic: 0.00025,
    linkup: 0.005,
    exa: 0.007,
  };

  return {
    id: 'cloudflare',
    name: `Cloudflare Web Search (${engine})`,
    engine,
    configured,
    reason: configured
      ? null
      : 'Missing CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_WEB_SEARCH_TOKEN (or CLOUDFLARE_API_TOKEN).',
    costPerQueryUsd: COST_PER_QUERY_USD[engine] ?? 0.00025,
    // AI Gateway allows 200 requests / 60 s per gateway for managed credentials.
    rateLimitPerMinute: 200,
    async search(query, options): Promise<SearchProviderResult> {
      const started = Date.now();
      // The API caps a response at ten results.
      const limit = Math.min(10, options.limit ?? 10);

      const payload = await fetchJson(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/websearch/`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            query,
            provider: engine,
            limit,
            options: { gateway: { id: gatewayId } },
          }),
          timeoutMs: options.deadlineMs ?? 12_000,
          signal: options.signal,
        },
      );

      const envelope = payload as {
        success?: boolean;
        result?: {
          items?: {
            url?: string;
            title?: string;
            description?: string;
            image?: string;
            favicon?: string;
            lastModified?: string;
          }[];
          metadata?: { query?: string; requestId?: string; latencyMs?: number };
        };
        errors?: { message?: string }[];
      };

      if (envelope.success === false) {
        throw new Error(envelope.errors?.[0]?.message ?? 'Cloudflare web search failed');
      }

      const items = envelope.result?.items ?? [];
      const hits: SearchHit[] = items
        .filter((entry) => Boolean(entry.url))
        .map((entry) => ({
          title: entry.title ?? '',
          url: normaliseUrl(entry.url as string),
          snippet: entry.description ?? null,
          score: null,
          publishedAt: parseIsoDate(entry.lastModified),
          domain: domainOf(entry.url as string),
          provider: 'cloudflare',
          providerRef: envelope.result?.metadata?.requestId ?? null,
        }));

      return {
        hits: applyFilters(hits, options),
        interpretedQuery: envelope.result?.metadata?.query ?? null,
        searchedAt: new Date().toISOString(),
        elapsedMs: envelope.result?.metadata?.latencyMs ?? Date.now() - started,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Exa                                                                 */
/* ------------------------------------------------------------------ */

export function exaProvider(): SearchProvider {
  const key = process.env.EXA_API_KEY ?? null;
  return {
    id: 'exa',
    name: 'Exa',
    engine: 'exa',
    configured: Boolean(key),
    reason: key ? null : 'Missing EXA_API_KEY.',
    costPerQueryUsd: 0.005,
    rateLimitPerMinute: 600,
    async search(query, options): Promise<SearchProviderResult> {
      const started = Date.now();
      const payload = (await fetchJson('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'x-api-key': key as string, 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          numResults: options.limit ?? 10,
          type: 'auto',
          includeDomains: options.includeDomains,
          excludeDomains: options.excludeDomains,
          contents: { text: { maxCharacters: 1200 } },
        }),
        timeoutMs: options.deadlineMs ?? 12_000,
        signal: options.signal,
      })) as {
        results?: {
          title?: string;
          url?: string;
          text?: string;
          score?: number;
          publishedDate?: string;
        }[];
      };

      const hits: SearchHit[] = (payload.results ?? [])
        .filter((entry) => Boolean(entry.url))
        .map((entry) => ({
          title: entry.title ?? '',
          url: normaliseUrl(entry.url as string),
          snippet: entry.text ? entry.text.slice(0, 400) : null,
          score: typeof entry.score === 'number' ? entry.score : null,
          publishedAt: parseIsoDate(entry.publishedDate),
          domain: domainOf(entry.url as string),
          provider: 'exa',
        }));

      return {
        hits: applyFilters(hits, options),
        searchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Linkup                                                              */
/* ------------------------------------------------------------------ */

export function linkupProvider(): SearchProvider {
  const key = process.env.LINKUP_API_KEY ?? null;
  return {
    id: 'linkup',
    name: 'Linkup',
    engine: 'linkup',
    configured: Boolean(key),
    reason: key ? null : 'Missing LINKUP_API_KEY.',
    costPerQueryUsd: 0.005,
    rateLimitPerMinute: 600,
    async search(query, options): Promise<SearchProviderResult> {
      const started = Date.now();
      const payload = (await fetchJson('https://api.linkup.so/v1/search', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          q: query,
          depth: 'standard',
          outputType: 'searchResults',
          includeImages: false,
          includeContent: true,
        }),
        timeoutMs: options.deadlineMs ?? 12_000,
        signal: options.signal,
      })) as {
        results?: {
          name?: string;
          url?: string;
          content?: string;
          type?: string;
          publishedDate?: string;
        }[];
      };

      const hits: SearchHit[] = (payload.results ?? [])
        .filter((entry) => Boolean(entry.url))
        .map((entry) => ({
          title: entry.name ?? '',
          url: normaliseUrl(entry.url as string),
          snippet: entry.content ? entry.content.slice(0, 400) : null,
          publishedAt: parseIsoDate(entry.publishedDate),
          domain: domainOf(entry.url as string),
          provider: 'linkup',
        }));

      return {
        hits: applyFilters(hits, options),
        searchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Brave Search                                                        */
/* ------------------------------------------------------------------ */

export function braveProvider(): SearchProvider {
  const key = process.env.BRAVE_SEARCH_API_KEY ?? null;
  return {
    id: 'brave',
    name: 'Brave Search',
    engine: 'brave',
    configured: Boolean(key),
    reason: key ? null : 'Missing BRAVE_SEARCH_API_KEY.',
    costPerQueryUsd: 0.005,
    rateLimitPerMinute: 2000,
    async search(query, options): Promise<SearchProviderResult> {
      const started = Date.now();
      const params = new URLSearchParams({ q: query, count: String(options.limit ?? 10) });
      if (options.country) params.set('country', options.country.toUpperCase());
      if (options.recencyDays) {
        params.set('freshness', `pd${options.recencyDays}`);
      }

      const payload = (await fetchJson(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        {
          headers: {
            'x-subscription-token': key as string,
            accept: 'application/json',
          },
          timeoutMs: options.deadlineMs ?? 12_000,
          signal: options.signal,
        },
      )) as {
        web?: {
          results?: {
            title?: string;
            url?: string;
            description?: string;
            age?: string;
            page_age?: string;
          }[];
        };
      };

      const hits: SearchHit[] = (payload.web?.results ?? [])
        .filter((entry) => Boolean(entry.url))
        .map((entry) => ({
          title: entry.title ?? '',
          url: normaliseUrl(entry.url as string),
          snippet: entry.description ?? null,
          publishedAt: parseIsoDate(entry.page_age ?? entry.age),
          domain: domainOf(entry.url as string),
          provider: 'brave',
        }));

      return {
        hits: applyFilters(hits, options),
        searchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* SearxNG (self-hosted, keyless)                                       */
/* ------------------------------------------------------------------ */

export function searxngProvider(): SearchProvider {
  const base = process.env.SEARXNG_BASE_URL ?? null;
  return {
    id: 'searxng',
    name: 'SearxNG',
    engine: 'searxng',
    configured: Boolean(base),
    reason: base ? null : 'Missing SEARXNG_BASE_URL.',
    costPerQueryUsd: 0,
    rateLimitPerMinute: null,
    async search(query, options): Promise<SearchProviderResult> {
      const started = Date.now();
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        safesearch: '1',
      });
      const firstDomain = options.includeDomains?.[0];
      if (firstDomain) {
        params.set('site', firstDomain);
      }

      const payload = (await fetchJson(
        `${(base as string).replace(/\/$/, '')}/search?${params.toString()}`,
        {
          headers: { accept: 'application/json' },
          timeoutMs: options.deadlineMs ?? 15_000,
          signal: options.signal,
        },
      )) as {
        results?: {
          title?: string;
          url?: string;
          content?: string;
          publishedDate?: string;
          score?: number;
        }[];
      };

      const hits: SearchHit[] = (payload.results ?? [])
        .filter((entry) => Boolean(entry.url))
        .map((entry) => ({
          title: entry.title ?? '',
          url: normaliseUrl(entry.url as string),
          snippet: entry.content ?? null,
          score: typeof entry.score === 'number' ? entry.score : null,
          publishedAt: parseIsoDate(entry.publishedDate),
          domain: domainOf(entry.url as string),
          provider: 'searxng',
        }));

      return {
        hits: applyFilters(hits, options),
        searchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* DuckDuckGo HTML (keyless, best effort)                              */
/* ------------------------------------------------------------------ */

export function duckDuckGoProvider(): SearchProvider {
  return {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    engine: 'duckduckgo',
    configured: true,
    reason: null,
    costPerQueryUsd: 0,
    rateLimitPerMinute: null,
    async search(query, options): Promise<SearchProviderResult> {
      const started = Date.now();
      // The HTML endpoint is the only keyless surface DuckDuckGo exposes.
      const { text } = await safeFetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          timeoutMs: options.deadlineMs ?? 12_000,
          userAgent: config.userAgent,
          headers: { accept: 'text/html' },
        },
      );

      const hits: SearchHit[] = [];
      const linkPattern =
        /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetPattern =
        /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

      const snippets: string[] = [];
      let snippetMatch = snippetPattern.exec(text);
      while (snippetMatch) {
        snippets.push(decodeEntities(stripTags(snippetMatch[1] ?? '')));
        snippetMatch = snippetPattern.exec(text);
      }

      let match = linkPattern.exec(text);
      let index = 0;
      while (match) {
        const rawUrl = decodeEntities(match[1] ?? '');
        // DuckDuckGo wraps results in a redirect; unwrap it.
        const unwrapped = rawUrl.match(/[?&]uddg=([^&]+)/)?.[1];
        const url = unwrapped ? decodeURIComponent(unwrapped) : rawUrl;
        if (url.startsWith('http')) {
          hits.push({
            title: decodeEntities(stripTags(match[2] ?? "")),
            url: normaliseUrl(url),
            snippet: snippets[index] ?? null,
            domain: domainOf(url),
            provider: 'duckduckgo',
          });
          index += 1;
        }
        match = linkPattern.exec(text);
      }

      return {
        hits: applyFilters(hits, options).slice(0, options.limit ?? 10),
        searchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        notice:
          hits.length === 0
            ? 'DuckDuckGo returned no parseable results; it may have rate-limited the request.'
            : null,
      };
    },
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

let providers: SearchProvider[] | null = null;

/** Every search provider, in the order they should be tried. */
export function searchProviders(): SearchProvider[] {
  if (providers) return providers;
  providers = [
    cloudflareProvider(),
    exaProvider(),
    linkupProvider(),
    braveProvider(),
    searxngProvider(),
    duckDuckGoProvider(),
  ];
  return providers;
}

/** Register an additional provider (used by tests and by self-hosted setups). */
export function registerSearchProvider(provider: SearchProvider): void {
  searchProviders().push(provider);
}

/** Reset the registry. Used by tests. */
export function resetSearchProviders(): void {
  providers = null;
}

/** Providers that can actually run right now. */
export function configuredSearchProviders(): SearchProvider[] {
  return searchProviders().filter((provider) => provider.configured);
}

/** The cost of a query on a given provider, when known. */
export function searchCost(providerId: string): number {
  return searchProviders().find((provider) => provider.id === providerId)?.costPerQueryUsd ?? 0;
}
