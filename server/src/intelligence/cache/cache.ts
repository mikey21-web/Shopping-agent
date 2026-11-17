/**
 * In-process cache with per-fact-kind freshness.
 *
 * Deliberately simple and observable: a Map of entries with an expiry, plus
 * hit/miss counters exposed through the metrics endpoint. Nothing private to
 * a user is cached — the key space contains only product and listing facts,
 * never a user's personal data or preferences.
 */

import { ttlFor, type FactKind } from './freshness.ts';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
  /** Version tag; a change invalidates derived entries. */
  version: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  evictions: number;
  hitRate: number;
  byKind: Record<string, { hits: number; misses: number; entries: number }>;
}

const stores = new Map<FactKind, Map<string, CacheEntry<unknown>>>();
const counters = new Map<FactKind, { hits: number; misses: number }>();

/** Bumped when the underlying computation changes, invalidating derived entries. */
const CACHE_VERSION = 'v1';

function bucket(kind: FactKind): Map<string, CacheEntry<unknown>> {
  let store = stores.get(kind);
  if (!store) {
    store = new Map();
    stores.set(kind, store);
  }
  return store;
}

function countersFor(kind: FactKind): { hits: number; misses: number } {
  let entry = counters.get(kind);
  if (!entry) {
    entry = { hits: 0, misses: 0 };
    counters.set(kind, entry);
  }
  return entry;
}

/** Read a cached value, if it exists and has not expired. */
export function cacheGet<T>(kind: FactKind, key: string): T | undefined {
  const store = bucket(kind);
  const entry = store.get(key);
  const counters = countersFor(kind);

  if (!entry) {
    counters.misses += 1;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    counters.misses += 1;
    return undefined;
  }
  if (entry.version !== CACHE_VERSION) {
    store.delete(key);
    counters.misses += 1;
    return undefined;
  }
  counters.hits += 1;
  return entry.value as T;
}

/** Store a value with the fact kind's own TTL. */
export function cacheSet<T>(kind: FactKind, key: string, value: T, ttlMs?: number): void {
  const now = Date.now();
  bucket(kind).set(key, {
    value,
    storedAt: now,
    expiresAt: now + (ttlMs ?? ttlFor(kind)),
    version: CACHE_VERSION,
  });
}

/** Remove one entry. */
export function cacheDelete(kind: FactKind, key: string): void {
  bucket(kind).delete(key);
}

/** Remove every entry of a kind. */
export function cacheClear(kind?: FactKind): void {
  if (kind) {
    stores.delete(kind);
    counters.delete(kind);
    return;
  }
  stores.clear();
  counters.clear();
}

/** Remove entries whose key starts with a prefix. */
export function cacheInvalidatePrefix(kind: FactKind, prefix: string): number {
  const store = bucket(kind);
  let removed = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Cache statistics for the metrics endpoint. */
export function cacheStats(): CacheStats {
  let hits = 0;
  let misses = 0;
  let entries = 0;
  let evictions = 0;
  const byKind: CacheStats['byKind'] = {};

  for (const [kind, store] of stores) {
    const counters = countersFor(kind);
    hits += counters.hits;
    misses += counters.misses;
    entries += store.size;
    byKind[kind] = { hits: counters.hits, misses: counters.misses, entries: store.size };
  }

  const total = hits + misses;
  return {
    hits,
    misses,
    entries,
    evictions,
    hitRate: total > 0 ? Number((hits / total).toFixed(3)) : 0,
    byKind,
  };
}

/**
 * Memoise an async computation under a fact kind.
 * Concurrent calls for the same key share one in-flight promise, which is how
 * duplicate research for the same product is prevented.
 */
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  kind: FactKind,
  key: string,
  compute: () => Promise<T>,
): Promise<{ value: T; cached: boolean; elapsedMs: number }> {
  const hit = cacheGet<T>(kind, key);
  if (hit !== undefined) {
    return { value: hit, cached: true, elapsedMs: 0 };
  }

  const inFlightKey = `${kind}::${key}`;
  const existing = inFlight.get(inFlightKey);
  if (existing) {
    const value = (await existing) as T;
    return { value, cached: true, elapsedMs: 0 };
  }

  const started = Date.now();
  const promise = compute()
    .then((value) => {
      cacheSet(kind, key, value);
      return value;
    })
    .finally(() => {
      inFlight.delete(inFlightKey);
    });

  inFlight.set(inFlightKey, promise);
  const value = await promise;
  return { value, cached: false, elapsedMs: Date.now() - started };
}
