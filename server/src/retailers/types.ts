/**
 * Retailer provider framework.
 *
 * Each Indian retailer gets an independent adapter that declares what it can do,
 * how it is allowed to get the data, and how much we trust it. The registry
 * aggregates providers and — critically — reports providers that are
 * *unavailable* with a reason, instead of silently substituting demo data.
 *
 * Access methods, in order of preference:
 *   official_api        – the retailer's own product API (credentials required)
 *   affiliate_feed      – affiliate/product feed (credentials required)
 *   merchant_feed       – a feed the merchant publishes or exports
 *   public_page         – a public page the user explicitly pointed us at
 *   user_capture        – data the user confirmed in their own browser
 *   sample              – bundled demonstration data, always labelled
 *
 * No adapter may bypass authentication, CAPTCHAs, anti-bot protections or any
 * other access control. Adapters that cannot operate return `unavailable`.
 */

import type { CategoryId, Provenance, RetailerId } from '../domain/types.ts';

export type AccessMethod =
  | 'official_api'
  | 'affiliate_feed'
  | 'merchant_feed'
  | 'public_page'
  | 'user_capture'
  | 'sample';

export interface ProviderCapabilities {
  /** Categories this retailer can serve. */
  categories: CategoryId[];
  /** Free-text product search. */
  search: boolean;
  /** Fetch one product by its retailer id. */
  productDetail: boolean;
  /** Price availability. */
  price: boolean;
  /** Stock/availability information. */
  stock: boolean;
  /** Seller/marketplace information. */
  seller: boolean;
  /** Customer reviews. */
  reviews: boolean;
  /** Coupon/bank/card offer data. */
  offers: boolean;
}

export interface ProviderTerms {
  accessMethod: AccessMethod;
  /** True when the provider needs credentials to operate. */
  requiresCredentials: boolean;
  /** Environment variable names that must be present. */
  credentialEnvVars: string[];
  /** Whether results must carry a disclosure/attribution in the UI. */
  attributionRequired: boolean;
  /** Human-readable note about permitted use. */
  notes: string;
}

export type ProviderStatus = 'ok' | 'unavailable' | 'error' | 'not_configured';

export interface ProviderHealth {
  providerId: RetailerId;
  providerName: string;
  status: ProviderStatus;
  /** Why this status, in plain language. */
  reason: string;
  /** What the operator can do about it. */
  hint: string | null;
  accessMethod: AccessMethod;
  /** ISO timestamp of the last successful call. */
  lastSuccessAt: string | null;
  /** Suggested minutes between refreshes. */
  refreshIntervalMinutes: number;
  /** How much we trust data from this provider, 0..1. */
  dataConfidence: number;
  categories: CategoryId[];
}

/** A normalised listing coming out of a provider, before identity resolution. */
export interface RawListing {
  retailer: RetailerId;
  retailerProductId: string;
  title: string;
  url: string;
  /** Price as presented by the retailer, in paise. */
  listPricePaise: number | null;
  /** Reference price (MRP) in paise, when published. */
  mrpPaise?: number | null;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  condition?: 'new' | 'refurbished' | 'used' | 'open_box' | null;
  seller?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  reviewCount?: number | null;
  imageUrl?: string | null;
  deliveryFeePaise?: number | null;
  /** Raw specification strings as published by the retailer. */
  rawSpecs?: Record<string, string>;
  /** Offers as published by the retailer. */
  rawOffers?: RawOffer[];
  /** The brand as published, if any. */
  brand?: string | null;
  /** The model as published, if any. */
  model?: string | null;
}

export interface RawOffer {
  id: string;
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
  title: string;
  description?: string | null;
  percentOff?: number | null;
  flatOffPaise?: number | null;
  cashbackPaise?: number | null;
  couponCode?: string | null;
  bank?: string | null;
  cardType?: 'credit' | 'debit' | null;
  membershipTier?: string | null;
  minSpendPaise?: number | null;
  maxDiscountPaise?: number | null;
  emiTenureMonths?: number | null;
  emiInterestRatePercent?: number | null;
  emiBank?: string | null;
  requiresExchange?: boolean;
  exchangeBonusPaise?: number | null;
  stackability?: 'stackable' | 'exclusive' | 'primary_only';
  automatic?: boolean;
  validityStart?: string | null;
  validityEnd?: string | null;
}

export type ProviderResult<T> =
  | {
      status: 'ok';
      data: T[];
      observedAt: string;
      source: string;
      confidence: number;
    }
  | {
      status: 'unavailable';
      reason: string;
      hint?: string;
      observedAt: string;
    }
  | {
      status: 'error';
      message: string;
      observedAt: string;
    };

export interface ProviderSearchOptions {
  category?: CategoryId | null;
  /** Maximum results to return. */
  limit?: number;
  /** ISO pincode for delivery checks, when the provider supports it. */
  pincode?: string | null;
  /** Upper price bound in paise. */
  maxPricePaise?: number | null;
  /** Lower price bound in paise. */
  minPricePaise?: number | null;
}

export interface RetailerProvider {
  id: RetailerId;
  name: string;
  /** URL of the retailer's site, for links. */
  siteUrl: string;
  capabilities: ProviderCapabilities;
  terms: ProviderTerms;
  /** Suggested minutes between refreshes for this retailer. */
  refreshIntervalMinutes: number;
  /** Trust in data from this provider, 0..1. */
  dataConfidence: number;

  /** Whether the provider has everything it needs to operate. */
  configuration(): { configured: boolean; reason: string; hint: string | null };

  /** Free-text search. */
  search(query: string, options?: ProviderSearchOptions): Promise<ProviderResult<RawListing>>;

  /** Single-product fetch. */
  getProduct(retailerProductId: string): Promise<ProviderResult<RawListing>>;

  /** Current health snapshot. */
  health(): Promise<ProviderHealth>;
}

/** Build the provenance record for data returned by a provider. */
export function providerProvenance(
  provider: RetailerProvider,
  observedAt: string,
  override?: Partial<Provenance>,
): Provenance {
  const sample = provider.terms.accessMethod === 'sample';
  return {
    origin: sample ? 'sample' : 'live',
    source: provider.id,
    observedAt,
    confidence: provider.dataConfidence,
    url: null,
    note: provider.terms.notes,
    ...override,
  };
}
