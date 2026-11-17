/**
 * Footwear variant matching.
 *
 * The electronics matcher compares RAM, storage and screen size. None of
 * those exist on a shoe, and all of the equivalents do: size, size
 * standard, width and gender.
 *
 * The rule that matters most in this category: **two shoes of different
 * size are different products, not variants of one product.** A UK 9 and a
 * UK 10 are different sellable items. Merging them would tell the buyer
 * to buy a size they cannot wear.
 *
 * The matcher therefore separates three verdicts:
 *
 *   - `exact`     — the same sellable item. Safe to merge.
 *   - `variant`   — the same model, a different sellable item. Kept apart,
 *                   but linked so the shopper can compare them.
 *   - `different` — different models. Never linked.
 */

import type { Variant } from '../../research/extract/schema.ts';

/** The verdict of a footwear comparison. */
export type ShoeMatchVerdict = 'exact' | 'variant' | 'different' | 'insufficient';

/** The result of comparing two footwear listings. */
export interface ShoeMatchResult {
  verdict: ShoeMatchVerdict;
  /** The shared identity, when the two are the same model. */
  identityKey: string | null;
  /** The variant key, when the two are the same sellable item. */
  variantKey: string | null;
  /** The signals that produced the verdict. */
  signals: { signal: string; weight: number; detail: string }[];
  /** The fields that differ. */
  differences: { field: string; left: string | null; right: string | null; blocking: boolean }[];
  /** Fields neither side published. These are not agreement. */
  unknown: string[];
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                        */
/* ------------------------------------------------------------------ */

/** Normalise a size to a canonical form: "UK 9", "9.5", "EU 42.5". */
export function normaliseSize(size: string | null | undefined): string | null {
  if (!size) return null;
  const trimmed = String(size).trim();
  if (!trimmed) return null;

  // Keep a leading standard if there is one.
  const standardMatch = trimmed.match(/^(UK|US|EU|IND|IN)\s*[.\-]?\s*(.+)$/i);
  if (standardMatch) {
    const standard = standardMatch[1]?.toUpperCase() ?? '';
    const value = standardMatch[2]?.trim() ?? '';
    const numeric = normaliseSizeNumber(value);
    return numeric === null ? null : `${standard} ${numeric}`;
  }

  const numeric = normaliseSizeNumber(trimmed);
  return numeric;
}

/** Normalise the numeric part of a size. */
function normaliseSizeNumber(value: string): string | null {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed)) return null;
  // Drop a trailing ".0" so "9.0" and "9" are the same size.
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1);
}

/**
 * Normalise the size standard.
 *
 * "UK/US" and "UK" are treated as the same standard because retailers
 * publish both for the same shoe. "EU" and "India" are their own
 * standards — an EU 42 and an India 42 are different shoes.
 */
export function normaliseSizeStandard(
  standard: string | null | undefined,
  fallbackSize: string | null,
): string | null {
  if (standard) {
    const upper = String(standard).toUpperCase().replace(/[^A-Z/]/g, '');
    if (upper.includes('UK') || upper.includes('US')) return 'UK/US';
    if (upper.includes('EU')) return 'EU';
    if (upper.includes('IND') || upper === 'IN') return 'IN';
    if (upper.length > 0) return upper;
  }
  // Infer from the size string when the standard was not published.
  if (fallbackSize) {
    const match = fallbackSize.match(/^(UK|US|EU|IND|IN)\b/i);
    if (match?.[1]) {
      const value = match[1].toUpperCase();
      if (value === 'UK' || value === 'US') return 'UK/US';
      if (value === 'EU') return 'EU';
      if (value === 'IND' || value === 'IN') return 'IN';
    }
  }
  return null;
}

/** Normalise a width. */
export function normaliseWidth(width: string | null | undefined): string | null {
  if (!width) return null;
  const lower = String(width).toLowerCase().trim();
  if (!lower) return null;
  if (/extra\s*wide|2e|xxwide/.test(lower)) return 'extra_wide';
  if (/\bwide\b/.test(lower)) return 'wide';
  if (/narrow|\bnarrow fit\b/.test(lower)) return 'narrow';
  if (/standard|regular|medium|normal/.test(lower)) return 'standard';
  return lower.replace(/\s+/g, '_');
}

/** Normalise a gender. */
export function normaliseGender(gender: string | null | undefined): string | null {
  if (!gender) return null;
  const lower = String(gender).toLowerCase().trim();
  if (!lower) return null;
  if (/^m(en)?$|^mens/.test(lower)) return 'men';
  if (/^w(omen)?$|^womens/.test(lower)) return 'women';
  if (/unisex|men\s*&\s*women|men\/women/.test(lower)) return 'unisex';
  if (/kids|child|baby/.test(lower)) return 'kids';
  return lower.replace(/\s+/g, '_');
}

/** Normalise a colour. */
export function normaliseColour(colour: string | null | undefined): string | null {
  if (!colour) return null;
  const lower = String(colour).toLowerCase().trim();
  if (!lower) return null;
  return lower.replace(/\s+/g, '_');
}

/** Normalise a material. */
export function normaliseMaterial(material: string | null | undefined): string | null {
  if (!material) return null;
  const lower = String(material).toLowerCase().trim();
  if (!lower) return null;
  return lower.replace(/[^a-z0-9]+/g, '_');
}

/* ------------------------------------------------------------------ */
/* Keys                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The identity of a shoe *model*.
 *
 * The model is the thing without a size: "Nike Air Zoom Pegasus 40".
 * Two listings of the same model at different sizes share this key.
 */
export function buildShoeIdentityKey(
  brand: string | null,
  model: string | null,
  generation: string | null = null,
): string {
  const brandToken = tokenise(brand) ?? 'unknown';
  const modelToken = tokenise(model) ?? 'unknown';
  const gen = generation ? tokenise(generation) : null;
  return gen ? `${brandToken}::${modelToken}::${gen}` : `${brandToken}::${modelToken}`;
}

/**
 * The identity of a shoe *variant* — the sellable item.
 *
 * Includes size, standard and width, because a UK 9 narrow and a UK 9
 * wide are different items.
 */
export function buildShoeVariantKey(
  identityKey: string,
  variant: Partial<Variant> & { sizeStandard?: string | null },
): string {
  const size = normaliseSize(variant.size) ?? 'unknown_size';
  const standard = normaliseSizeStandard(variant.sizeStandard ?? null, variant.size ?? null) ?? 'unknown_standard';
  const width = normaliseWidth(variant.width) ?? 'unknown_width';
  return `${identityKey}|${standard}|${size}|${width}`;
}

/** Reduce a string to a comparable token. */
function tokenise(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.split(/\s+/).join(' ').replace(/\s+(gym|shoes?|sneakers?)$/, '').trim() || null;
}

/* ------------------------------------------------------------------ */
/* Matching                                                             */
/* ------------------------------------------------------------------ */

/**
 * Compare two footwear listings.
 *
 * The order of the checks is the order of how much they matter:
 *
 *  1. A shared manufacturer identifier (GTIN, MPN, SKU) is decisive.
 *  2. Otherwise compare the model identity.
 *  3. Within the same model, compare the sellable attributes. A size
 *     difference is *blocking*: the two are different sellable items.
 */
export function compareShoes(
  left: {
    brand: string | null;
    model: string | null;
    generation?: string | null;
    variant: Partial<Variant> & { sizeStandard?: string | null };
    gtin?: string | null;
    mpn?: string | null;
    sku?: string | null;
  },
  right: {
    brand: string | null;
    model: string | null;
    generation?: string | null;
    variant: Partial<Variant> & { sizeStandard?: string | null };
    gtin?: string | null;
    mpn?: string | null;
    sku?: string | null;
  },
): ShoeMatchResult {
  const signals: ShoeMatchResult['signals'] = [];
  const differences: ShoeMatchResult['differences'] = [];
  const unknown: string[] = [];

  /* ---- 1. Shared identifiers ---- */
  const leftIds = [left.gtin, left.mpn, left.sku].filter((v): v is string => Boolean(v && v.trim()));
  const rightIds = [right.gtin, right.mpn, right.sku].filter((v): v is string => Boolean(v && v.trim()));

  const sharedId = leftIds.find((id) => rightIds.some((other) => other.toLowerCase() === id.toLowerCase()));

  const leftIdentity = buildShoeIdentityKey(left.brand, left.model, left.generation ?? null);
  const rightIdentity = buildShoeIdentityKey(right.brand, right.model, right.generation ?? null);

  if (sharedId) {
    signals.push({
      signal: 'shared_identifier',
      weight: 1,
      detail: `Both listings publish the same manufacturer identifier (${sharedId}).`,
    });
    const variantKey = buildShoeVariantKey(leftIdentity, left.variant);
    return {
      verdict: 'exact',
      identityKey: leftIdentity,
      variantKey: variantKey,
      signals,
      differences: [],
      unknown: [],
    };
  }

  /* ---- 2. Model identity ---- */
  const sameModel = leftIdentity === rightIdentity;
  const brandsDiffer =
    tokenise(left.brand) !== tokenise(right.brand) &&
    left.brand !== null &&
    right.brand !== null;

  if (!sameModel) {
    signals.push({
      signal: 'model_differs',
      weight: 0.9,
      detail: `The model names do not match: "${left.model ?? 'unknown'}" against "${right.model ?? 'unknown'}".`,
    });
    if (brandsDiffer) {
      differences.push({
        field: 'brand',
        left: left.brand,
        right: right.brand,
        blocking: true,
      });
    }
    return {
      verdict: 'different',
      identityKey: null,
      variantKey: null,
      signals,
      differences,
      unknown,
    };
  }

  signals.push({
    signal: 'same_model',
    weight: 0.8,
    detail: `Both listings describe the same model (${leftIdentity}).`,
  });

  /* ---- 3. Sellable attributes ---- */
  const leftSize = normaliseSize(left.variant.size);
  const rightSize = normaliseSize(right.variant.size);
  const leftStandard = normaliseSizeStandard(
    left.variant.sizeStandard ?? null,
    left.variant.size ?? null,
  );
  const rightStandard = normaliseSizeStandard(
    right.variant.sizeStandard ?? null,
    right.variant.size ?? null,
  );
  const leftWidth = normaliseWidth(left.variant.width);
  const rightWidth = normaliseWidth(right.variant.width);
  const leftGender = normaliseGender(left.variant.gender);
  const rightGender = normaliseGender(right.variant.gender);

  // Size. Blocking when both sides declare it.
  if (leftSize && rightSize) {
    const sameStandard =
      !leftStandard || !rightStandard || leftStandard === rightStandard;
    if (leftSize === rightSize && sameStandard) {
      signals.push({
        signal: 'same_size',
        weight: 1,
        detail: `Both listings are size ${leftSize}${leftStandard ? ` (${leftStandard})` : ''}.`,
      });
    } else {
      differences.push({
        field: 'size',
        left: leftSize,
        right: rightSize,
        blocking: true,
      });
      signals.push({
        signal: 'size_differs',
        weight: 1,
        detail: `The sizes differ: ${leftSize} against ${rightSize}. These are different sellable items.`,
      });
    }
  } else if (leftSize || rightSize) {
    unknown.push('size');
    signals.push({
      signal: 'size_unknown',
      weight: 0.4,
      detail: 'Only one listing published a size, so the sizes cannot be compared.',
    });
  } else {
    unknown.push('size');
  }

  // Width. Blocking: a narrow and a wide shoe of the same size are
  // different items.
  if (leftWidth && rightWidth) {
    if (leftWidth === rightWidth) {
      signals.push({
        signal: 'same_width',
        weight: 0.8,
        detail: `Both listings are ${leftWidth.replace('_', ' ')} width.`,
      });
    } else {
      differences.push({
        field: 'width',
        left: leftWidth,
        right: rightWidth,
        blocking: true,
      });
    }
  } else if (leftWidth || rightWidth) {
    unknown.push('width');
  } else {
    unknown.push('width');
  }

  // Gender. Blocking, because a men's and a women's shoe are different
  // lasts even at the same size.
  if (leftGender && rightGender) {
    if (leftGender === rightGender || leftGender === 'unisex' || rightGender === 'unisex') {
      signals.push({
        signal: 'same_gender',
        weight: 0.8,
        detail: `Both listings are ${leftGender}.`,
      });
    } else {
      differences.push({
        field: 'gender',
        left: leftGender,
        right: rightGender,
        blocking: true,
      });
    }
  } else if (leftGender || rightGender) {
    unknown.push('gender');
  } else {
    unknown.push('gender');
  }

  // Colour and material: soft. They make a different variant, not a
  // different product.
  const leftColour = normaliseColour(left.variant.colour);
  const rightColour = normaliseColour(right.variant.colour);
  if (leftColour && rightColour && leftColour !== rightColour) {
    differences.push({
      field: 'colour',
      left: leftColour,
      right: rightColour,
      blocking: false,
    });
    signals.push({
      signal: 'colour_differs',
      weight: 0.3,
      detail: `The colours differ: ${leftColour} against ${rightColour}.`,
    });
  }

  const leftMaterial = normaliseMaterial(left.variant.material);
  const rightMaterial = normaliseMaterial(right.variant.material);
  if (leftMaterial && rightMaterial && leftMaterial !== rightMaterial) {
    differences.push({
      field: 'material',
      left: leftMaterial,
      right: rightMaterial,
      blocking: false,
    });
  }

  const blocking = differences.filter((difference) => difference.blocking);

  if (blocking.length > 0) {
    return {
      verdict: 'variant',
      identityKey: leftIdentity,
      variantKey: null,
      signals,
      differences,
      unknown,
    };
  }

  return {
    verdict: 'exact',
    identityKey: leftIdentity,
    variantKey: buildShoeVariantKey(leftIdentity, left.variant),
    signals,
    differences,
    unknown,
  };
}
