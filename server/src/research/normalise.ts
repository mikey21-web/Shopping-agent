/**
 * Normalisation of research facts onto a category's specification schema.
 *
 * Raw pages use a dozen different labels for the same thing. The category
 * profile already declares the canonical field names and the aliases that
 * map onto them, so normalisation is a lookup rather than a guess.
 *
 * Normalisation never invents a value. A field that no source stated stays
 * absent, and its absence is later reported as *unknown* — not as a defect of
 * the product.
 */

import type { NormalizedSpecs } from '../domain/types.ts';
import { getCategory } from '../intelligence/categories/index.ts';
import {
  parseBatteryMah,
  parseDisplaySizeIn,
  parseRamGb,
  parseStorageGb,
  parseWarrantyMonths,
} from '../intelligence/normalize/specs.ts';
import type { ResearchFact, ResearchPlan } from './types.ts';

/** The extra fields a category declares, keyed by the profile's spec field. */
export interface NormalisedResearch {
  /** Facts that mapped onto the schema, keyed by canonical field name. */
  specs: Record<string, string | number | boolean>;
  /** Facts that did not map, kept for the trace. */
  unmapped: ResearchFact[];
  /** The fact that produced each mapped value. */
  sources: Record<string, ResearchFact>;
}

/**
 * Map research facts onto the category's specification schema.
 *
 * Facts that already use a canonical key are accepted directly. Facts with a
 * raw label are matched against the profile's alias list.
 */
export function normaliseFacts(facts: ResearchFact[], plan: ResearchPlan): ResearchFact[] {
  const profile = getCategory(plan.category);
  const canonical = new Set<string>();

  if (profile) {
    for (const field of profile.specFields) canonical.add(field.key);
  }

  // Alias lookup: lowercased label -> canonical field key.
  const aliasMap = new Map<string, string>();
  if (profile) {
    for (const field of profile.specFields) {
      aliasMap.set(field.key.toLowerCase(), field.key);
      for (const alias of field.aliases) aliasMap.set(alias.toLowerCase().trim(), field.key);
    }
  }

  const normalised: ResearchFact[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    if (fact.kind !== 'specification') {
      normalised.push(fact);
      continue;
    }

    const key = fact.key;
    const canonicalKey = canonical.has(key) ? key : aliasMap.get(key.toLowerCase());

    if (!canonicalKey) {
      // Not part of the schema. Keep it — extra evidence is still evidence.
      normalised.push({ ...fact, key });
      continue;
    }

    const dedupeKey = `${fact.kind}::${canonicalKey}`;
    if (seen.has(dedupeKey)) {
      // A second source for the same field: keep it only if it agrees or has
      // higher confidence, which the verification stage has already scored.
      const existing = normalised.find((f) => `${f.kind}::${f.key}` === dedupeKey);
      if (existing && fact.confidence > existing.confidence) {
        normalised[normalised.indexOf(existing)] = { ...fact, key: canonicalKey };
      }
      continue;
    }

    seen.add(dedupeKey);
    normalised.push({ ...fact, key: canonicalKey });
  }

  return normalised;
}

/**
 * Build a `NormalizedSpecs` object from verified research facts.
 *
 * Only the fields the existing spec normaliser understands are converted; the
 * rest stay in `extra`.
 */
export function specsFromFacts(facts: ResearchFact[]): NormalizedSpecs {
  const specs: NormalizedSpecs = { extra: {} };

  const put = (key: string, value: string | number | boolean | null): void => {
    if (value === null || value === undefined || value === '') return;
    switch (key) {
      case 'ram':
      case 'ramGb':
        if (specs.ramGb === undefined) {
          const parsed = parseRamGb(String(value));
          if (parsed !== null) specs.ramGb = parsed;
        }
        break;
      case 'storage':
      case 'storageGb':
        if (specs.storageGb === undefined) {
          const parsed = parseStorageGb(String(value));
          if (parsed !== null) specs.storageGb = parsed;
        }
        break;
      case 'storageType':
        specs.storageType = String(value);
        break;
      case 'soc':
      case 'processor':
        specs.soc = String(value);
        break;
      case 'cpuCores':
        specs.cpuCores = Number(value) || undefined;
        break;
      case 'displaySize':
      case 'displaySizeIn':
        if (specs.displaySizeIn === undefined) {
          const parsed = parseDisplaySizeIn(String(value));
          if (parsed !== null) specs.displaySizeIn = parsed;
        }
        break;
      case 'batteryCapacity':
      case 'batteryMah':
        if (specs.batteryMah === undefined) {
          const parsed = parseBatteryMah(String(value));
          if (parsed !== null) specs.batteryMah = parsed;
        }
        break;
      case 'colour':
        specs.colour = String(value);
        break;
      case 'warrantyMonths':
        {
          const parsed = parseWarrantyMonths(String(value));
          if (parsed !== null) specs.warrantyMonths = parsed;
        }
        break;
      default:
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          specs.extra[key] = value;
        }
        break;
    }
  };

  for (const fact of facts) {
    if (fact.kind === 'specification') put(fact.key, fact.value);
  }

  return specs;
}
