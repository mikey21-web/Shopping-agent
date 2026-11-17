/**
 * Freshness policy.
 *
 * Different facts go stale at very different rates. A product's identity does
 * not change for years; its specifications change rarely; its reviews change
 * slowly; its price and stock change within minutes; bank offers expire on
 * their own validity dates; price history is append-only and never expires.
 *
 * Caching everything for the same duration would either serve stale prices or
 * re-fetch stable facts constantly. Each fact kind therefore has its own
 * policy, and the API reports when information was last checked.
 */

export type FactKind =
  | 'product_identity'
  | 'specifications'
  | 'reviews'
  | 'review_analysis'
  | 'price'
  | 'stock'
  | 'offers'
  | 'price_history'
  | 'provider_response'
  | 'recommendation';

export interface FreshnessPolicy {
  /** How long a cached value may be reused, in milliseconds. */
  ttlMs: number;
  /** Human-readable explanation. */
  label: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FRESHNESS: Record<FactKind, FreshnessPolicy> = {
  product_identity: {
    ttlMs: 30 * DAY,
    label: 'Product identity is stable; re-checked monthly.',
  },
  specifications: {
    ttlMs: 7 * DAY,
    label: 'Specifications change rarely; re-checked weekly.',
  },
  reviews: {
    ttlMs: 24 * HOUR,
    label: 'Reviews accumulate slowly; refreshed daily.',
  },
  review_analysis: {
    ttlMs: 12 * HOUR,
    label: 'Review analysis is recomputed twice a day.',
  },
  price: {
    ttlMs: 5 * MINUTE,
    label: 'Prices change within minutes; never shown as current beyond five minutes.',
  },
  stock: {
    ttlMs: 60 * 1000,
    label: 'Stock is re-checked every minute.',
  },
  offers: {
    ttlMs: 15 * MINUTE,
    label: 'Bank and card offers are re-checked every fifteen minutes, and their own validity window always applies.',
  },
  price_history: {
    ttlMs: 60 * MINUTE,
    label: 'Price history is append-only; observations are never stale.',
  },
  provider_response: {
    ttlMs: 10 * MINUTE,
    label: 'Retailer responses are cached briefly to avoid duplicate research.',
  },
  recommendation: {
    ttlMs: 5 * MINUTE,
    label: 'Recommendations depend on prices, so they are recomputed often.',
  },
};

/** How long a cached value may be reused, in milliseconds. */
export function ttlFor(kind: FactKind): number {
  return FRESHNESS[kind]?.ttlMs ?? MINUTE;
}

/** The label shown to the user for a fact kind. */
export function freshnessLabel(kind: FactKind): string {
  return FRESHNESS[kind]?.label ?? 'Freshness policy unknown.';
}
