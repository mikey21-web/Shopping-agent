/**
 * Product identity and variant matching.
 *
 * The problem: the same laptop appears on Amazon, Flipkart and Croma with
 * different titles, different spec formatting, and sometimes different
 * configurations. We must decide whether two listings describe the *same
 * sellable item*.
 *
 * The rules, in priority order:
 *  1. A shared manufacturer identifier (part number / SKU / GTIN) is decisive
 *     evidence that two listings are the same item.
 *  2. Otherwise compare configuration fields. Any hard difference (RAM,
 *     storage, storage type, chipset, screen size) blocks an exact match.
 *  3. Soft fields (colour, connectivity notes) downgrade to "same model,
 *     different variant" rather than "different product".
 *
 * Every decision is explainable: the result carries the individual signals and
 * the field-level differences that produced it.
 */

import type {
  MatchResult,
  MatchSignal,
  NormalizedSpecs,
  ProductVariant,
  VariantSignature,
} from '../../domain/types.ts';
import { compareNumeric, compareText, fuzzySimilarity } from './text-similarity.ts';
import { normalizeModel, stripModelNoise } from '../normalize/specs.ts';

/** Build the identity key for a product model: brand + canonical model + generation. */
export function buildIdentityKey(
  brand: string,
  model: string,
  generation?: string | null,
): string {
  const brandToken = stripModelNoise(normalizeModel(brand)) || 'unknown';
  const modelToken = stripModelNoise(normalizeModel(model)) || 'unknown';
  const gen = generation ? String(generation).trim() : '';
  return gen ? `${brandToken}::${modelToken}::${gen}` : `${brandToken}::${modelToken}`;
}

/**
 * Build a canonical configuration signature for a variant.
 * The signature is a sorted list of `key=value` pairs; two variants are the
 * same sellable item only when their signatures are identical.
 */
export function buildConfigSignature(specs: NormalizedSpecs): string {
  const parts: string[] = [];
  const push = (key: string, value: string | number | null | undefined): void => {
    if (value === null || value === undefined || value === '') return;
    parts.push(`${key}=${String(value).toLowerCase().trim()}`);
  };

  push('ram', specs.ramGb);
  push('storage', specs.storageGb);
  push('storagetype', specs.storageType);
  push('soc', specs.soc);
  push('display', specs.displaySizeIn);
  push('colour', specs.colour);
  push('network', specs.network);
  push('generation', specs.generation);

  // Extra fields that genuinely differentiate a configuration.
  for (const key of Object.keys(specs.extra).sort()) {
    const value = specs.extra[key];
    if (value === null || value === undefined || value === '') continue;
    parts.push(`x:${key}=${String(value).toLowerCase().trim()}`);
  }

  return parts.sort().join('|');
}

/** Derive a comparable variant signature from a spec object. */
export function toVariantSignature(
  specs: NormalizedSpecs,
  identifiers: { partNumber?: string | null; sku?: string | null; gtin?: string | null } = {},
): VariantSignature {
  return {
    ramGb: specs.ramGb ?? null,
    storageGb: specs.storageGb ?? null,
    storageType: specs.storageType ?? null,
    colour: specs.colour ?? null,
    soc: specs.soc ?? null,
    displaySizeIn: specs.displaySizeIn ?? null,
    connectivity: specs.network ?? null,
    partNumber: identifiers.partNumber ?? null,
    sku: identifiers.sku ?? null,
    gtin: identifiers.gtin ?? null,
    size: specs.extra['size'] != null ? String(specs.extra['size']) : null,
    generation: specs.generation ?? null,
    condition: specs.extra['condition'] != null ? String(specs.extra['condition']) : null,
    interface: specs.extra['interface'] != null ? String(specs.extra['interface']) : null,
    capacity:
      specs.extra['capacity'] != null
        ? typeof specs.extra['capacity'] === 'boolean'
          ? null
          : specs.extra['capacity']
        : null,
    version: specs.extra['version'] != null ? String(specs.extra['version']) : null,
  };
}

/** Hard configuration fields: a difference here blocks an exact match. */
const HARD_FIELDS: { key: keyof VariantSignature; label: string; compare: 'numeric' | 'text' }[] = [
  { key: 'ramGb', label: 'RAM', compare: 'numeric' },
  { key: 'storageGb', label: 'storage', compare: 'numeric' },
  { key: 'storageType', label: 'storage type', compare: 'text' },
  { key: 'soc', label: 'processor', compare: 'text' },
  { key: 'displaySizeIn', label: 'screen size', compare: 'numeric' },
  { key: 'generation', label: 'generation', compare: 'text' },
];

/** Soft configuration fields: a difference downgrades to a different variant. */
const SOFT_FIELDS: { key: keyof VariantSignature; label: string; compare: 'numeric' | 'text' }[] = [
  { key: 'colour', label: 'colour', compare: 'text' },
  { key: 'connectivity', label: 'network variant', compare: 'text' },
  { key: 'size', label: 'size', compare: 'text' },
];

/**
 * Category-agnostic variant-discriminating keys.
 *
 * Adapted from ValuSee (github.com/biheto/ValuSee, MIT licence,
 * app/shopping/identity.py). ValuSee's insight is that the set of fields
 * which distinguish two sellable items is broadly the same across
 * categories — version, interface, generation, colour, capacity, size, RAM
 * and storage — and that a category profile may extend it.
 *
 * The second idea taken from the same source is the one in its docstring:
 * "missing data is not agreement". A field that only one side knows about
 * cannot be used to declare two items identical.
 */
export const BASE_VARIANT_KEYS = [
  'version',
  'interface',
  'generation',
  'colour',
  'capacity',
  'size',
  'ram',
  'storage',
] as const;

/** Normalised condition buckets. A condition difference always separates. */
export function normaliseCondition(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.toLowerCase().trim();
  if (text === 'new' || text === 'brand new' || text === 'sealed') return 'new';
  if (text === 'refurbished' || text === 'renewed' || text === 'refurb') return 'refurbished';
  if (text === 'open box' || text === 'openbox' || text === 'open-box') return 'open_box';
  if (text === 'used' || text === 'second hand' || text === 'pre-owned') return 'used';
  return text;
}

/**
 * Connector families that are mutually exclusive.
 * A USB-C accessory is not a Lightning accessory, even on the same model line.
 */
const CONNECTOR_FAMILIES: { pattern: RegExp; family: string }[] = [
  { pattern: /\busb[\s-]?c\b/i, family: 'usb-c' },
  { pattern: /\blightning\b/i, family: 'lightning' },
  { pattern: /\b3\.5\s*mm\b|\bmicro[\s-]?usb\b|\bmini[\s-]?usb\b|\btype[\s-]?c\b/i, family: 'legacy' },
];

export function connectorFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const entry of CONNECTOR_FAMILIES) {
    if (entry.pattern.test(value)) return entry.family;
  }
  return null;
}

/**
 * Compare two variant signatures.
 * Returns an explainable match result.
 */
export function compareVariants(
  a: VariantSignature,
  b: VariantSignature,
  options: { modelSimilarity?: number } = {},
): MatchResult {
  const signals: MatchSignal[] = [];
  const differences: string[] = [];

  // --- Rule 0: condition and connector are hard separators ----------------
  // These are checked before identifiers, because a refurbished unit carries
  // the same manufacturer part number as a new one and a USB-C accessory
  // shares its model name with the Lightning variant. Neither is the same
  // item.
  // A listing that does not state a condition is, in practice, a new item —
  // that is the default across Indian retail listings. Treating an explicit
  // "refurbished" or "used" as conflicting with an unstated condition is
  // therefore safe: two unstated conditions still agree with each other.
  const leftCondition = normaliseCondition(a.condition) ?? 'new';
  const rightCondition = normaliseCondition(b.condition) ?? 'new';
  if (leftCondition !== rightCondition) {
    differences.push(`condition differs (${leftCondition} vs ${rightCondition})`);
    signals.push({
      name: 'condition',
      score: 0,
      weight: 3,
      detail: `Condition differs (${leftCondition} vs ${rightCondition})`,
    });
    return {
      verdict: 'same_model_different_variant',
      confidence: 0.95,
      signals,
      differences,
      explanation: `Condition differs (${leftCondition} vs ${rightCondition}), so these are not the same item.`,
    };
  }

  const leftConnector = connectorFamily(a.interface);
  const rightConnector = connectorFamily(b.interface);
  if (leftConnector && rightConnector && leftConnector !== rightConnector) {
    differences.push(`interface differs (${leftConnector} vs ${rightConnector})`);
    signals.push({
      name: 'interface',
      score: 0,
      weight: 3,
      detail: `Connector/interface differs (${leftConnector} vs ${rightConnector})`,
    });
    return {
      verdict: 'same_model_different_variant',
      confidence: 0.95,
      signals,
      differences,
      explanation: `Interface differs (${leftConnector} vs ${rightConnector}), so these are different variants.`,
    };
  }

  // --- Rule 1: manufacturer identifiers -----------------------------------
  const identifierPairs: { key: keyof VariantSignature; label: string }[] = [
    { key: 'gtin', label: 'GTIN' },
    { key: 'partNumber', label: 'part number' },
    { key: 'sku', label: 'SKU' },
  ];
  const identifierConflicts: string[] = [];
  for (const { key, label } of identifierPairs) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) continue;
    const same = String(left).toLowerCase().trim() === String(right).toLowerCase().trim();
    signals.push({
      name: `${label} match`,
      score: same ? 1 : 0,
      weight: 3,
      detail: same
        ? `Both listings carry the same ${label}: ${left}`
        : `${label} differs (${left} vs ${right})`,
    });
    if (same) {
      return {
        verdict: 'exact_same_variant',
        confidence: 0.99,
        signals,
        differences: [],
        explanation: `Identical ${label} (${left}) — treated as the same item.`,
      };
    }
    identifierConflicts.push(`${label} differs (${left} vs ${right})`);
    differences.push(`${label} differs (${left} vs ${right})`);
  }

  // A conflicting manufacturer identifier is decisive in the other direction:
  // the two listings are not the same SKU, however similar their specs look.
  if (identifierConflicts.length > 0) {
    return {
      verdict: 'same_model_different_variant',
      confidence: 0.93,
      signals,
      differences,
      explanation: `Manufacturer identifiers conflict (${identifierConflicts.join('; ')}), so these are different SKUs.`,
    };
  }

  // --- Rule 2: configuration comparison ------------------------------------
  const hardComparisons: { field: string; label: string; result: 'equal' | 'different' | 'unknown' }[] = [];
  for (const field of HARD_FIELDS) {
    const left = a[field.key];
    const right = b[field.key];
    const result =
      field.compare === 'numeric'
        ? compareNumeric(left as number | null, right as number | null)
        : compareText(left as string | null, right as string | null);
    hardComparisons.push({ field: String(field.key), label: field.label, result });    if (result === 'different') {
      differences.push(`${field.label} differs (${String(left)} vs ${String(right)})`);
    }
    signals.push({
      name: `${field.label}`,
      score: result === 'equal' ? 1 : result === 'unknown' ? 0.5 : 0,
      weight: 2,
      detail:
        result === 'equal'
          ? `${field.label} matches (${String(left)})`
          : result === 'unknown'
            ? `${field.label} not available on both listings`
            : `${field.label} differs (${String(left)} vs ${String(right)})`,
    });
  }

  const softDifferences: string[] = [];
  for (const field of SOFT_FIELDS) {
    const left = a[field.key];
    const right = b[field.key];
    const result =
      field.compare === 'numeric'
        ? compareNumeric(left as number | null, right as number | null)
        : compareText(left as string | null, right as string | null);
    if (result === 'different') {
      softDifferences.push(`${field.label} differs (${String(left)} vs ${String(right)})`);
    }
    signals.push({
      name: field.label,
      score: result === 'equal' ? 1 : result === 'unknown' ? 0.5 : 0,
      weight: 1,
      detail:
        result === 'equal'
          ? `${field.label} matches`
          : result === 'unknown'
            ? `${field.label} not available on both listings`
            : `${field.label} differs (${String(left)} vs ${String(right)})`,
    });
  }

  const hardConflicts = hardComparisons.filter((c) => c.result === 'different');
  const unknownCount = hardComparisons.filter((c) => c.result === 'unknown').length;

  // "Missing data is not agreement": a field known on only one side cannot
  // support an exact match. The confidence of an exact match therefore falls
  // as the number of comparable-but-unknown fields rises, and the result says
  // so explicitly.
  const bothKnown = hardComparisons.filter((c) => c.result === 'equal').length;
  const complete = unknownCount === 0 && bothKnown > 0;

  if (hardConflicts.length > 0) {
    return {
      verdict: 'same_model_different_variant',
      confidence: 0.95,
      signals,
      differences,
      explanation: `Same product line but a different configuration: ${hardConflicts
        .map((c) => c.label)
        .join(', ')}.`,
    };
  }

  // Soft differences.
  if (softDifferences.length > 0) {
    return {
      verdict: 'same_model_different_variant',
      confidence: 0.85,
      signals,
      differences: [...differences, ...softDifferences],
      explanation: `Same model and configuration, but a different ${softDifferences
        .map((d) => d.split(' ')[0])
        .join(' / ')} option.`,
    };
  }

  // All comparable configuration fields agree.
  const certainty = complete ? 0.96 : Math.max(0.6, 0.96 - unknownCount * 0.08);
  return {
    verdict: 'exact_same_variant',
    confidence: certainty,
    signals,
    differences,
    explanation: complete
      ? `Every compared configuration field matches (${bothKnown} field${bothKnown === 1 ? '' : 's'} checked: RAM, storage, processor, screen size).`
      : `Configuration matches on all comparable fields, but ${unknownCount} field${unknownCount === 1 ? ' was' : 's were'} unknown on one side — missing data is not treated as agreement.`,
  };
}

/**
 * Decide whether two product *models* are the same model.
 * Used before variant comparison.
 */
export function compareModels(
  a: { brand: string; model: string; generation?: string | null },
  b: { brand: string; model: string; generation?: string | null },
): { verdict: 'same_model' | 'related_model' | 'different_product'; similarity: number } {
  const brandA = stripModelNoise(normalizeModel(a.brand));
  const brandB = stripModelNoise(normalizeModel(b.brand));
  const modelA = stripModelNoise(normalizeModel(a.model));
  const modelB = stripModelNoise(normalizeModel(b.model));

  const brandSame = brandA === brandB;
  const similarity = fuzzySimilarity(modelA, modelB);

  const genA = a.generation ? String(a.generation) : null;
  const genB = b.generation ? String(b.generation) : null;

  if (brandSame && similarity >= 0.95 && (genA === null || genB === null || genA === genB)) {
    return { verdict: 'same_model', similarity };
  }
  if (brandSame && similarity >= 0.72) {
    return { verdict: 'related_model', similarity };
  }
  return { verdict: 'different_product', similarity };
}

/**
 * Ranking priority for match verdicts.
 *
 * Confidence alone cannot order verdicts: "different variant" legitimately
 * carries high confidence when a RAM or storage difference is proven, but an
 * exact match must still win. Verdict is therefore the primary sort key.
 */
export function verdictRank(verdict: MatchResult['verdict']): number {
  switch (verdict) {
    case 'exact_same_variant':
      return 0;
    case 'same_model_different_variant':
      return 1;
    case 'related_model':
      return 2;
    default:
      return 3;
  }
}

/**
 * Match a candidate variant against a list of known variants of one product.
 * Returns the best match: exact matches are preferred over proven-different
 * variants, and ties are broken by confidence.
 */
export function matchVariantAgainstProduct(
  candidate: VariantSignature,
  known: { id: string; signature: VariantSignature }[],
): { variantId: string | null; result: MatchResult } {
  let best: { variantId: string | null; result: MatchResult } = {
    variantId: null,
    result: {
      verdict: 'different_product',
      confidence: 0,
      signals: [],
      differences: [],
      explanation: 'No candidate variants to compare.',
    },
  };

  for (const option of known) {
    const result = compareVariants(candidate, option.signature);
    const better =
      verdictRank(result.verdict) < verdictRank(best.result.verdict) ||
      (verdictRank(result.verdict) === verdictRank(best.result.verdict) &&
        result.confidence > best.result.confidence);
    if (better) {
      best = { variantId: option.id, result };
    }
  }
  return best;
}

/** Convenience: build a signature directly from a stored variant record. */
export function signatureFromVariant(variant: ProductVariant): VariantSignature {
  return toVariantSignature(variant.specs, {
    partNumber: variant.partNumber,
    sku: variant.sku,
    gtin: variant.gtin,
  });
}
