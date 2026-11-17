/**
 * Specification normalisation.
 *
 * Retailer titles and spec sheets are messy: "16GB DDR4", "16 GB", "16GB RAM",
 * "1TB SSD", "1 TB", "1024GB", "6.8 inches", "6.8\"", "5000 mAh", "50MP".
 *
 * Every helper here is pure and deterministic. The goal is that scoring code
 * can do arithmetic on specs instead of string matching.
 */

import type { NormalizedSpecs } from '../../domain/types.ts';

const NUM = '(\\d+(?:[.,]\\d+)?)';

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Extract the first number in a string. */
export function firstNumber(input: string): number | null {
  const match = input.match(new RegExp(NUM));
  return match?.[1] ? toNumber(match[1] ?? '') : null;
}

/**
 * Parse a RAM capacity to gigabytes.
 * Handles "16GB", "16 GB", "16GB DDR4", "16 GB LPDDR5X", "8GB+8GB".
 */
export function parseRamGb(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.toLowerCase();
  // "8GB + 8GB" style virtual memory is still physical RAM in these listings.
  const additive = text.match(new RegExp(`${NUM}\\s*gb\\s*\\+\\s*${NUM}\\s*gb`));
  if (additive) {
    const a = toNumber(additive[1] ?? '');
    const b = toNumber(additive[2] ?? '');
    if (a !== null && b !== null) return a + b;
  }
  const mb = text.match(new RegExp(`${NUM}\\s*mb`));
  if (mb) {
    const value = toNumber(mb[1] ?? '');
    return value === null ? null : value / 1024;
  }
  const gb = text.match(new RegExp(`${NUM}\\s*gb`));
  if (gb) {
    const value = toNumber(gb[1] ?? '');
    return value === null ? null : value;
  }
  return null;
}

/**
 * Parse a storage capacity to gigabytes.
 * "1TB" -> 1024, "512GB" -> 512, "2 TB SSD" -> 2048.
 */
export function parseStorageGb(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.toLowerCase();
  const tb = text.match(new RegExp(`${NUM}\\s*tb`));
  if (tb) {
    const value = toNumber(tb[1] ?? '');
    return value === null ? null : Math.round(value * 1024);
  }
  const gb = text.match(new RegExp(`${NUM}\\s*gb`));
  if (gb) {
    const value = toNumber(gb[1] ?? '');
    return value === null ? null : Math.round(value);
  }
  const mb = text.match(new RegExp(`${NUM}\\s*mb`));
  if (mb) {
    const value = toNumber(mb[1] ?? '');
    return value === null ? null : Math.round(value / 1024);
  }
  return null;
}

/** Detect storage medium: 'SSD', 'HDD', 'UFS 3.1', 'eMMC', 'NVMe'. */
export function parseStorageType(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.toLowerCase();
  const ufs = text.match(/ufs\s*([0-9.]+)?/);
  if (ufs) return `UFS ${ufs[1] ?? ''}`.trim();
  if (/\bnvme\b/.test(text)) return 'NVMe';
  if (/\bssd\b/.test(text)) return 'SSD';
  if (/\b(hard disk|hdd)\b/.test(text)) return 'HDD';
  if (/\bemmc\b/.test(text)) return 'eMMC';
  return null;
}

export type SocFamily =
  | 'snapdragon'
  | 'exynos'
  | 'mediatek_dimensity'
  | 'mediatek_helio'
  | 'apple'
  | 'intel_core'
  | 'intel_core_ultra'
  | 'amd_ryzen'
  | 'amd_radeon'
  | 'qualcomm'
  | 'kirin'
  | 'tensor'
  | 'unknown';

/**
 * Normalise a chipset / processor name and detect its family.
 * Handles "Intel Core Ultra 7 155H", "Snapdragon 8 Gen 3", "Apple A17 Pro",
 * "AMD Ryzen 7 8845HS", "MediaTek Dimensity 9300".
 */
export function parseSoc(input: string | null | undefined): { name?: string; family: SocFamily } {
  if (!input) return { family: 'unknown' };
  const raw = input.replace(/\s+/g, ' ').trim();
  const text = raw.toLowerCase();

  let family: SocFamily = 'unknown';
  if (text.includes('snapdragon')) family = 'snapdragon';
  else if (text.includes('exynos')) family = 'exynos';
  else if (text.includes('dimensity')) family = 'mediatek_dimensity';
  else if (text.includes('helio')) family = 'mediatek_helio';
  else if (text.includes('tensor')) family = 'tensor';
  else if (text.includes('kirin')) family = 'kirin';
  else if (text.includes('core ultra')) family = 'intel_core_ultra';
  else if (text.includes('core')) family = 'intel_core';
  else if (text.includes('ryzen')) family = 'amd_ryzen';
  else if (text.includes('radeon')) family = 'amd_radeon';
  else if (text.includes('apple') || /^a1[0-9]\b/.test(text) || /\ba1[5-9]\s*pro\b/.test(text))
    family = 'apple';
  else if (text.includes('qualcomm')) family = 'qualcomm';

  return { name: raw, family };
}

/** Parse display size in inches. */
export function parseDisplaySizeIn(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(new RegExp(`${NUM}\\s*(?:\"|inch|inches|inchs|")`, 'i'));
  if (match?.[1]) return toNumber(match[1] ?? '');
  const fallback = input.match(new RegExp(NUM));
  return fallback?.[1] ? toNumber(fallback[1] ?? '') : null;
}

/** Parse refresh rate in Hz. */
export function parseRefreshHz(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(new RegExp(`${NUM}\\s*hz`, 'i'));
  return match?.[1] ? toNumber(match[1] ?? '') : null;
}

/** Parse battery capacity in mAh. */
export function parseBatteryMah(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(new RegExp(`${NUM}\\s*mah`, 'i'));
  return match?.[1] ? toNumber(match[1] ?? '') : null;
}

/**
 * Parse the main camera megapixel count.
 * Prefers an explicit "MP" number; falls back to the first of a set like
 * "50MP + 12MP + 10MP".
 */
export function parseCameraMainMp(input: string | null | undefined): number | null {
  if (!input) return null;
  const matches = [...input.matchAll(new RegExp(`${NUM}\\s*mp`, 'gi'))];
  if (matches.length === 0) return null;
  let best: number | null = null;
  for (const match of matches) {
    const value = toNumber(match[1] ?? '');
    if (value === null) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

/** Count rear cameras mentioned as "triple camera", "quad camera", "3 cameras". */
export function parseRearCameraCount(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.toLowerCase();
  const named: Record<string, number> = {
    'single camera': 1,
    'dual camera': 2,
    'twin camera': 2,
    'triple camera': 3,
    'tri-camera': 3,
    'quad camera': 4,
    'quad-camera': 4,
    'penta camera': 5,
  };
  for (const [needle, count] of Object.entries(named)) {
    if (text.includes(needle)) return count;
  }
  const digit = text.match(new RegExp(`${NUM}\\s*(?:rear\s+)?cameras?`, 'i'));
  if (digit?.[1]) {
    const value = toNumber(digit[1] ?? '');
    if (value !== null && value >= 1 && value <= 10) return Math.round(value);
  }
  return null;
}

/** Parse warranty duration in months. */
export function parseWarrantyMonths(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.toLowerCase();
  const years = text.match(new RegExp(`${NUM}\\s*(?:year|yr|years)`));
  if (years?.[1]) {
    const value = toNumber(years[1] ?? '');
    return value === null ? null : Math.round(value * 12);
  }
  const months = text.match(new RegExp(`${NUM}\\s*month`));
  if (months?.[1]) {
    const value = toNumber(months[1] ?? '');
    return value === null ? null : Math.round(value);
  }
  return null;
}

/** Detect network generation. */
export function parseNetwork(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.toLowerCase();
  if (/\b5g\b/.test(text)) return '5G';
  if (/\b4g\b|lte/.test(text)) return '4G';
  if (/\b3g\b/.test(text)) return '3G';
  return null;
}

/** Detect operating system family. */
export function parseOs(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.toLowerCase();
  if (text.includes('android')) return 'Android';
  if (text.includes('ios') || text.includes('iphone os')) return 'iOS';
  if (text.includes('windows')) return 'Windows';
  if (text.includes('macos') || text.includes('mac os')) return 'macOS';
  if (text.includes('watchos')) return 'watchOS';
  if (text.includes('harmony')) return 'HarmonyOS';
  return null;
}

/**
 * Normalise a colour name to a comparable token.
 *
 * Deliberately conservative: the full marketing phrase is preserved so that
 * genuinely different colours ("Titanium Grey" vs "Space Black") are never
 * collapsed into one. Only filler adjectives and the grey/gray spelling
 * difference are removed.
 */
export function normalizeColour(input: string | null | undefined): string | null {
  if (!input) return null;
  let text = input
    .toLowerCase()
    .replace(/gray/g, 'grey')
    .replace(/\b(deep|light|bright|soft|pale|dark)\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  // Multi-word colours are checked first because they contain single colours.
  const multiWord = [
    'titanium grey',
    'space black',
    'midnight black',
    'jet black',
    'rose gold',
    'sage green',
    'phantom purple',
    'cloud mint',
    'deep purple',
  ];
  for (const colour of multiWord) {
    if (text.includes(colour)) return colour;
  }

  const single = [
    'black',
    'white',
    'silver',
    'grey',
    'gold',
    'blue',
    'green',
    'purple',
    'pink',
    'red',
    'orange',
    'navy',
    'beige',
    'graphite',
    'onyx',
    'platinum',
    'titanium',
    'starlight',
    'porcelain',
    'lavender',
    'mint',
    'brown',
    'cream',
    'sand',
  ];
  for (const colour of single) {
    if (text.includes(colour)) return colour;
  }
  return text;
}

/**
 * Normalise a model name: lowercase, strip punctuation, collapse whitespace,
 * and drop marketing noise words that retailers append inconsistently.
 */
const MODEL_NOISE = new Set([
  'new',
  'latest',
  'pack',
  'packed',
  'with',
  'and',
  'for',
  'in',
  'india',
  'official',
  'store',
  'online',
  'buy',
  'price',
  'free',
  'shipping',
  'delivery',
  '2024',
  '2025',
  '2026',
]);

export function normalizeModel(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove noise words from a normalised model string. */
export function stripModelNoise(model: string): string {
  return model
    .split(' ')
    .filter((token) => token.length > 0 && !MODEL_NOISE.has(token))
    .join(' ')
    .trim();
}

/**
 * Normalise a raw price string to paise.
 *
 * Handles Indian digit grouping ("₹1,29,999"), currency words ("Rs. 129999.50")
 * and plain numbers. The conversion is done in integer arithmetic so no
 * floating-point error can enter a price.
 */
export function parsePriceToPaise(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    // Split into rupees and paise without float multiplication.
    const negative = input < 0;
    const abs = Math.abs(input);
    const rupees = Math.trunc(abs);
    const paise = Math.round((abs - rupees) * 100);
    const total = rupees * 100 + paise;
    return negative ? -total : total;
  }

  // Keep only digits, separators and the decimal point; drop currency symbols
  // and words, then start from the first digit so "Rs." does not leak in.
  const cleaned = input.replace(/[^\d.,]/g, '');
  const firstDigit = cleaned.search(/\d/);
  if (firstDigit === -1) return null;

  let numeric = cleaned.slice(firstDigit).replace(/,/g, '');
  const dots = numeric.split('.');
  if (dots.length > 2) {
    // Keep only the final dot as the decimal separator.
    numeric = `${dots.slice(0, -1).join('')}.${dots[dots.length - 1] ?? ''}`;
  }

  const [rupeesPart = '', fractionPart = ''] = numeric.split('.');
  const rupees = Number.parseInt(rupeesPart, 10);
  if (!Number.isFinite(rupees)) return null;
  const paise = Number.parseInt(`${fractionPart}00`.slice(0, 2), 10) || 0;
  return rupees * 100 + paise;
}

/** Format paise as an Indian-formatted rupee string, e.g. 12999900 -> '₹1,29,999'. */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Extract a colour token from a product title.
 * Looks for known colour words in the title.
 */
export function extractColourFromTitle(title: string): string | null {
  const known = [
    'titanium grey',
    'titanium gray',
    'titanium',
    'graphite',
    'midnight',
    'onyx',
    'silver',
    'platinum',
    'rose gold',
    'space black',
    'starlight',
    'sage green',
    'lavender',
    'porcelain',
    'jet black',
    'phantom purple',
    'cloud mint',
    'navy',
    'beige',
    'gold',
    'black',
    'white',
    'blue',
    'green',
    'pink',
    'purple',
    'red',
    'grey',
    'gray',
  ];
  const text = title.toLowerCase();
  for (const colour of known) {
    if (text.includes(colour)) return normalizeColour(colour);
  }
  return null;
}

/**
 * Build a NormalizedSpecs object from a loose map of raw spec strings.
 * Keys are matched case-insensitively against known aliases.
 */
const SPEC_ALIASES: Record<keyof NormalizedSpecs, string[]> = {
  ramGb: ['ram', 'ram size', 'memory', 'memory size', 'ramgb'],
  storageGb: ['storage', 'storage capacity', 'internal storage', 'rom'],
  storageType: ['storage type', 'rom type'],
  soc: ['processor', 'cpu', 'chipset', 'processor name', 'soc'],
  socFamily: [],
  cpuCores: ['cpu cores', 'cores', 'number of cores', 'core count'],
  displaySizeIn: ['display size', 'screen size', 'screen', 'display'],
  displayPanel: ['display type', 'panel type', 'display technology', 'screen type'],
  refreshHz: ['refresh rate', 'display refresh rate'],
  batteryMah: ['battery capacity', 'battery', 'batteries'],
  cameraMainMp: ['camera', 'primary camera', 'rear camera', 'main camera', 'megapixel'],
  rearCameraCount: ['number of rear cameras', 'rear cameras', 'camera count'],
  colour: ['colour', 'color'],
  network: ['network', 'network type', 'sim type'],
  os: ['os', 'operating system', 'os version'],
  generation: ['generation', 'model year', 'year'],
  warrantyMonths: ['warranty', 'warranty period'],
  extra: [],
};

export function normalizeSpecs(raw: Record<string, string>): NormalizedSpecs {
  const specs: NormalizedSpecs = { extra: {} };
  const lowered = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    lowered.set(key.toLowerCase().trim(), value);
  }

  const find = (alias: string): string | undefined => {
    for (const [key, value] of lowered) {
      if (key === alias) return value;
    }
    for (const [key, value] of lowered) {
      if (key.includes(alias)) return value;
    }
    return undefined;
  };

  const ram = find('ram') ?? find('memory');
  if (ram) specs.ramGb = parseRamGb(ram) ?? undefined;

  const storage = find('storage') ?? find('rom');
  if (storage) {
    specs.storageGb = parseStorageGb(storage) ?? undefined;
    specs.storageType = parseStorageType(storage) ?? undefined;
  }

  const soc = find('processor') ?? find('chipset') ?? find('cpu');
  if (soc) {
    const parsed = parseSoc(soc);
    specs.soc = parsed.name;
    specs.socFamily = parsed.family;
  }

  const cores = find('cpu cores') ?? find('core count') ?? find('cores');
  if (cores) specs.cpuCores = firstNumber(cores) ?? undefined;

  const display = find('display size') ?? find('screen size');
  if (display) {
    specs.displaySizeIn = parseDisplaySizeIn(display) ?? undefined;
    specs.displayPanel = find('display type') ?? find('panel type') ?? undefined;
  }
  const refresh = find('refresh rate');
  if (refresh) specs.refreshHz = parseRefreshHz(refresh) ?? undefined;

  const battery = find('battery capacity') ?? find('battery');
  if (battery) specs.batteryMah = parseBatteryMah(battery) ?? undefined;

  const camera = find('primary camera') ?? find('main camera') ?? find('camera');
  if (camera) {
    specs.cameraMainMp = parseCameraMainMp(camera) ?? undefined;
    specs.rearCameraCount = parseRearCameraCount(camera) ?? undefined;
  }

  const colour = find('colour') ?? find('color');
  if (colour) specs.colour = normalizeColour(colour) ?? undefined;

  const network = find('network');
  if (network) specs.network = parseNetwork(network) ?? undefined;

  const os = find('operating system') ?? find('os');
  if (os) specs.os = parseOs(os) ?? undefined;

  const generation = find('generation') ?? find('model year');
  if (generation) specs.generation = firstNumber(generation)?.toString() ?? undefined;

  const warranty = find('warranty');
  if (warranty) specs.warrantyMonths = parseWarrantyMonths(warranty) ?? undefined;

  // Anything we did not understand is preserved in `extra` so it is never lost.
  const understood = new Set<string>();
  for (const aliases of Object.values(SPEC_ALIASES)) {
    for (const alias of aliases) understood.add(alias);
  }
  for (const [key, value] of lowered) {
    if (understood.has(key)) continue;
    specs.extra[key] = value;
  }

  return specs;
}
