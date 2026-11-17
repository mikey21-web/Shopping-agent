/**
 * Retailer provider registry.
 *
 * Aggregates providers and reports, per provider, what happened — including
 * providers that could not run and exactly why. Callers can therefore tell the
 * user "Croma returned nothing because its feed credentials are missing"
 * instead of silently returning a smaller result set.
 */

import type { RetailerId } from '../domain/types.ts';
import type {
  ProviderHealth,
  ProviderResult,
  ProviderSearchOptions,
  RawListing,
  RetailerProvider,
} from './types.ts';

export interface ProviderOutcome {
  providerId: RetailerId;
  providerName: string;
  status: 'ok' | 'unavailable' | 'error' | 'not_configured';
  reason: string;
  hint: string | null;
  /** Number of listings this provider contributed. */
  count: number;
  /** True when the provider's data is bundled sample data. */
  isSample: boolean;
}

export interface AggregateResult {
  listings: RawListing[];
  outcomes: ProviderOutcome[];
  /** Providers that could not run, with reasons. */
  unavailable: ProviderOutcome[];
  /** True when every provider failed. */
  empty: boolean;
  /** ISO timestamp. */
  observedAt: string;
}

const providers = new Map<RetailerId, RetailerProvider>();

export function registerProvider(provider: RetailerProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: RetailerId): RetailerProvider | undefined {
  return providers.get(id);
}

export function listProviders(): RetailerProvider[] {
  return [...providers.values()];
}

/**
 * Run a search across every provider that supports it.
 * Providers that cannot run are reported, never hidden.
 */
export async function searchAllProviders(
  query: string,
  options: ProviderSearchOptions = {},
): Promise<AggregateResult> {
  const observedAt = new Date().toISOString();
  const outcomes: ProviderOutcome[] = [];
  const listings: RawListing[] = [];

  for (const provider of listProviders()) {
    if (!provider.capabilities.search) continue;

    const configuration = provider.configuration();
    if (!configuration.configured) {
      outcomes.push({
        providerId: provider.id,
        providerName: provider.name,
        status: 'not_configured',
        reason: configuration.reason,
        hint: configuration.hint,
        count: 0,
        isSample: provider.terms.accessMethod === 'sample',
      });
      continue;
    }

    try {
      const result: ProviderResult<RawListing> = await provider.search(query, options);
      if (result.status === 'ok') {
        listings.push(...result.data);
        outcomes.push({
          providerId: provider.id,
          providerName: provider.name,
          status: 'ok',
          reason: `${result.data.length} listing${result.data.length === 1 ? '' : 's'} returned.`,
          hint: null,
          count: result.data.length,
          isSample: provider.terms.accessMethod === 'sample',
        });
      } else if (result.status === 'unavailable') {
        outcomes.push({
          providerId: provider.id,
          providerName: provider.name,
          status: 'unavailable',
          reason: result.reason,
          hint: result.hint ?? null,
          count: 0,
          isSample: provider.terms.accessMethod === 'sample',
        });
      } else {
        outcomes.push({
          providerId: provider.id,
          providerName: provider.name,
          status: 'error',
          reason: result.message,
          hint: null,
          count: 0,
          isSample: provider.terms.accessMethod === 'sample',
        });
      }
    } catch (error) {
      outcomes.push({
        providerId: provider.id,
        providerName: provider.name,
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unknown provider error',
        hint: null,
        count: 0,
        isSample: provider.terms.accessMethod === 'sample',
      });
    }
  }

  return {
    listings,
    outcomes,
    unavailable: outcomes.filter((outcome) => outcome.status !== 'ok'),
    empty: listings.length === 0,
    observedAt,
  };
}

/** Health snapshot for every registered provider. */
export async function providerHealth(): Promise<ProviderHealth[]> {
  const results = await Promise.all(listProviders().map((provider) => provider.health()));
  return results.sort((a, b) => a.providerName.localeCompare(b.providerName));
}

/** Whether every registered provider is a sample provider. */
export function onlySampleProvidersRegistered(): boolean {
  const all = listProviders();
  return all.length > 0 && all.every((provider) => provider.terms.accessMethod === 'sample');
}
