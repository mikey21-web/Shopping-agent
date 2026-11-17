/**
 * Credential-gated retailer adapters.
 *
 * These adapters describe the access each retailer actually offers and refuse
 * to operate without the required credentials. They never scrape, never
 * attempt to bypass bot protection, and never fall back to invented data.
 *
 * Each adapter reports `not_configured` with a concrete hint so an operator
 * knows exactly which credentials to supply.
 */

import type { RetailerId } from '../domain/types.ts';
import type {
  ProviderCapabilities,
  ProviderHealth,
  ProviderResult,
  ProviderSearchOptions,
  RawListing,
  RetailerProvider,
} from './types.ts';

interface CredentialSpec {
  /** Environment variables that must all be present. */
  envVars: string[];
  /** Human-readable name of the programme. */
  programme: string;
  /** Where to apply. */
  signupUrl: string;
  /** What the credentials allow. */
  grants: string;
}

interface RetailerSpec {
  id: RetailerId;
  name: string;
  siteUrl: string;
  categories: ProviderCapabilities['categories'];
  credentials: CredentialSpec;
  /** Refresh interval in minutes. */
  refreshIntervalMinutes: number;
  dataConfidence: number;
  notes: string;
}

function isConfigured(envVars: string[]): { configured: boolean; reason: string; hint: string | null } {
  const missing = envVars.filter((name) => !process.env[name]);
  if (missing.length === 0) {
    return { configured: true, reason: 'Credentials present.', hint: null };
  }
  return {
    configured: false,
    reason: `Missing environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    hint: 'Apply for the retailer programme and set the variables in .env. Until then this source reports no products rather than demo products.',
  };
}

/**
 * Build an adapter for a retailer that requires an official/affiliate programme.
 */
function createCredentialGatedProvider(spec: RetailerSpec): RetailerProvider {
  const capabilities: ProviderCapabilities = {
    categories: spec.categories,
    search: true,
    productDetail: true,
    price: true,
    stock: true,
    seller: true,
    reviews: true,
    offers: true,
  };

  const provider: RetailerProvider = {
    id: spec.id,
    name: spec.name,
    siteUrl: spec.siteUrl,
    capabilities,
    terms: {
      accessMethod: 'affiliate_feed',
      requiresCredentials: true,
      credentialEnvVars: spec.credentials.envVars,
      attributionRequired: true,
      notes: spec.notes,
    },
    refreshIntervalMinutes: spec.refreshIntervalMinutes,
    dataConfidence: spec.dataConfidence,

    configuration() {
      const state = isConfigured(spec.credentials.envVars);
      return {
        configured: state.configured,
        reason: state.configured
          ? `Configured via ${spec.credentials.programme}.`
          : state.reason,
        hint: state.hint ?? `Apply at ${spec.credentials.signupUrl}. Grants: ${spec.credentials.grants}`,
      };
    },

    async search(
      _query: string,
      _options?: ProviderSearchOptions,
    ): Promise<ProviderResult<RawListing>> {
      const state = provider.configuration();
      const observedAt = new Date().toISOString();
      if (!state.configured) {
        return {
          status: 'unavailable',
          reason: state.reason,
          hint: state.hint ?? undefined,
          observedAt,
        };
      }
      // The transport for the authorised feed is implemented in Stage 2 of the
      // retailer work (per-retailer request signing and payload mapping). Until
      // then we report honestly rather than emitting placeholder listings.
      return {
        status: 'unavailable',
        reason: `${spec.name} feed adapter is configured but the request signing/mapping layer is not implemented yet.`,
        hint: 'See SAHIPICK_MASTER_PLAN.md → Stage 2 → retailer feeds.',
        observedAt,
      };
    },

    async getProduct(retailerProductId: string): Promise<ProviderResult<RawListing>> {
      const state = provider.configuration();
      const observedAt = new Date().toISOString();
      if (!state.configured) {
        return { status: 'unavailable', reason: state.reason, hint: state.hint ?? undefined, observedAt };
      }
      return {
        status: 'unavailable',
        reason: `${spec.name} detail adapter is not implemented yet.`,
        hint: `Requested retailer id: ${retailerProductId}`,
        observedAt,
      };
    },

    async health(): Promise<ProviderHealth> {
      const state = provider.configuration();
      return {
        providerId: spec.id,
        providerName: spec.name,
        status: state.configured ? 'ok' : 'not_configured',
        reason: state.reason,
        hint: state.hint,
        accessMethod: 'affiliate_feed',
        lastSuccessAt: null,
        refreshIntervalMinutes: spec.refreshIntervalMinutes,
        dataConfidence: spec.dataConfidence,
        categories: spec.categories,
      };
    },
  };

  return provider;
}

export const amazonIndia = createCredentialGatedProvider({
  id: 'amazon_in',
  name: 'Amazon India',
  siteUrl: 'https://www.amazon.in',
  categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming', 'appliance'],
  credentials: {
    envVars: ['AMAZON_PAAPI_ACCESS_KEY', 'AMAZON_PAAPI_SECRET_KEY', 'AMAZON_PAAPI_PARTNER_TAG'],
    programme: 'Amazon Associates Product Advertising API',
    signupUrl: 'https://webservices.amazon.in/paapi5/documentation/',
    grants: 'Product search, product details, price, availability and browse-node data for the Indian marketplace.',
  },
  refreshIntervalMinutes: 360,
  dataConfidence: 0.9,
  notes:
    'Amazon Product Advertising API. Requires an approved Associates account. Affiliate attribution must be disclosed and must never affect ranking.',
});

export const flipkart = createCredentialGatedProvider({
  id: 'flipkart',
  name: 'Flipkart',
  siteUrl: 'https://www.flipkart.com',
  categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming', 'fashion', 'beauty', 'grocery'],
  credentials: {
    envVars: ['FLIPKART_AFFILIATE_ID', 'FLIPKART_AFFILIATE_TOKEN'],
    programme: 'Flipkart Affiliate Program',
    signupUrl: 'https://www.flipkart.com/affiliate-program',
    grants: 'Product feeds and offer data for the affiliate programme.',
  },
  refreshIntervalMinutes: 360,
  dataConfidence: 0.88,
  notes:
    'Flipkart affiliate/product feed. Requires an approved affiliate account. Affiliate attribution must be disclosed.',
});

export const croma = createCredentialGatedProvider({
  id: 'croma',
  name: 'Croma',
  siteUrl: 'https://www.croma.com',
  categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming', 'appliance'],
  credentials: {
    envVars: ['CROMA_API_KEY', 'CROMA_API_SECRET'],
    programme: 'Croma Partner Product Feed',
    signupUrl: 'https://www.croma.com/',
    grants: 'Product catalogue, price and offer data for listed SKUs.',
  },
  refreshIntervalMinutes: 720,
  dataConfidence: 0.85,
  notes:
    'Croma partner feed for listed SKUs. Product data is limited to the catalogue Croma publishes through the programme.',
});

export const relianceDigital = createCredentialGatedProvider({
  id: 'reliance_digital',
  name: 'Reliance Digital',
  siteUrl: 'https://www.reliancedigital.in',
  categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming', 'appliance'],
  credentials: {
    envVars: ['RELIANCE_API_KEY', 'RELIANCE_API_SECRET'],
    programme: 'Reliance Digital Merchant Feed',
    signupUrl: 'https://www.reliancedigital.in/',
    grants: 'Catalogue, price and offer data for merchant-listed SKUs.',
  },
  refreshIntervalMinutes: 720,
  dataConfidence: 0.83,
  notes: 'Reliance Digital merchant feed.',
});

export const vijaySales = createCredentialGatedProvider({
  id: 'vijay_sales',
  name: 'Vijay Sales',
  siteUrl: 'https://www.vijaysales.com',
  categories: ['smartphone', 'laptop', 'tv', 'audio', 'appliance'],
  credentials: {
    envVars: ['VIJAY_SALES_API_KEY', 'VIJAY_SALES_API_SECRET'],
    programme: 'Vijay Sales Merchant Feed',
    signupUrl: 'https://www.vijaysales.com/',
    grants: 'Catalogue, price and offer data for merchant-listed SKUs.',
  },
  refreshIntervalMinutes: 720,
  dataConfidence: 0.8,
  notes: 'Vijay Sales merchant feed.',
});
