/**
 * Retailer provider registration.
 *
 * Registering a provider makes it visible to the discovery engine and to the
 * operations health view. Providers that need credentials are still
 * registered: they report `not_configured` with the exact variables missing,
 * rather than being hidden.
 */

import { registerProvider } from './registry.ts';
import {
  amazonIndia,
  croma,
  flipkart,
  relianceDigital,
  vijaySales,
} from './credential-gated.ts';
import { userLinkProvider } from './user-link.ts';

let registered = false;

export function registerRetailerProviders(): void {
  if (registered) return;
  registered = true;

  registerProvider(amazonIndia);
  registerProvider(flipkart);
  registerProvider(croma);
  registerProvider(relianceDigital);
  registerProvider(vijaySales);
  registerProvider(userLinkProvider);
}
