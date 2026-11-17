/**
 * Text similarity helpers used by product matching.
 * Pure, deterministic, dependency-free.
 */

/** Token-level Jaccard similarity, 0..1. */
export function jaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

/** Containment: how much of `a` appears in `b`, 0..1. */
export function containment(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0) return 0;
  let hits = 0;
  for (const token of setA) if (setB.has(token)) hits += 1;
  return hits / setA.size;
}

/** Character trigram similarity, 0..1. Catches typos and formatting drift. */
export function trigramSimilarity(a: string, b: string): number {
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let hits = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) hits += 1;
  return hits / (gramsA.size + gramsB.size - hits);
}

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 0);
}

function trigrams(input: string): Set<string> {
  const padded = `  ${input.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

/**
 * Best-effort fuzzy string equality, 0..1.
 * Combines token overlap with character-level similarity so that
 * "Galaxy S24 Ultra" vs "S24 Ultra (Galaxy)" still scores highly while
 * "Galaxy S24 Ultra" vs "Galaxy S23 Ultra" stays distinguishable.
 */
export function fuzzySimilarity(a: string, b: string): number {
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  if (!left || !right) return 0;
  if (left === right) return 1;
  const tokenScore = Math.max(jaccard(left, right), containment(left, right));
  const charScore = trigramSimilarity(left, right);
  return tokenScore * 0.7 + charScore * 0.3;
}

/**
 * Compare two numeric-ish spec values with a tolerance.
 * Returns null when the values are not comparable.
 */
export function compareNumeric(
  a: number | null | undefined,
  b: number | null | undefined,
  toleranceRatio = 0.02,
): 'equal' | 'different' | 'unknown' {
  if (a === null || a === undefined || b === null || b === undefined) return 'unknown';
  if (a === b) return 'equal';
  const tolerance = Math.max(Math.abs(a), Math.abs(b)) * toleranceRatio;
  return Math.abs(a - b) <= tolerance ? 'equal' : 'different';
}

/** Compare two string spec values with fuzzy matching. */
export function compareText(
  a: string | null | undefined,
  b: string | null | undefined,
  threshold = 0.88,
): 'equal' | 'different' | 'unknown' {
  if (!a && !b) return 'unknown';
  if (!a || !b) return 'unknown';
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  if (left === right) return 'equal';
  return fuzzySimilarity(left, right) >= threshold ? 'equal' : 'different';
}
