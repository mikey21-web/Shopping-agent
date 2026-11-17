/**
 * Chipset and GPU performance tiers.
 *
 * Specification lists give you a processor *name*, not a performance number.
 * To score a laptop for "running local AI models" we need a relative
 * performance index, plus a separate GPU index and the VRAM figure that
 * actually decides which local models fit.
 *
 * The indices below are relative (0..100) and approximate. They are ordered
 * consistently with published benchmark families; they are intentionally not
 * presented to users as exact benchmark scores.
 */

export interface SocTier {
  /** Relative CPU performance index, 0..100. */
  cpuIndex: number;
  /** Relative GPU performance index, 0..100 (0 when not applicable). */
  gpuIndex: number;
  /** Human-readable tier name. */
  tier: string;
  /** Year of release, used to judge generation. */
  year: number;
  /** Notes shown to the user, e.g. efficiency caveats. */
  note?: string;
}

const UNKNOWN: SocTier = { cpuIndex: 25, gpuIndex: 0, tier: 'unknown', year: 0 };

interface TierRule {
  pattern: RegExp;
  tier: SocTier;
}

/**
 * Ordered rules — the first match wins, so more specific patterns come first.
 */
const CPU_RULES: TierRule[] = [
  // --- Apple silicon ---
  { pattern: /\bm4\s*pro\b/i, tier: { cpuIndex: 100, gpuIndex: 92, tier: 'Apple M4 Pro', year: 2024 } },
  { pattern: /\bm4\b/i, tier: { cpuIndex: 92, gpuIndex: 85, tier: 'Apple M4', year: 2024 } },
  { pattern: /\bm3\s*pro\b/i, tier: { cpuIndex: 88, gpuIndex: 80, tier: 'Apple M3 Pro', year: 2023 } },
  { pattern: /\bm3\b/i, tier: { cpuIndex: 80, gpuIndex: 72, tier: 'Apple M3', year: 2023 } },
  { pattern: /\bm2\s*pro\b/i, tier: { cpuIndex: 76, gpuIndex: 68, tier: 'Apple M2 Pro', year: 2023 } },
  { pattern: /\bm2\b/i, tier: { cpuIndex: 66, gpuIndex: 58, tier: 'Apple M2', year: 2022 } },
  { pattern: /\bm1\b/i, tier: { cpuIndex: 56, gpuIndex: 46, tier: 'Apple M1', year: 2020 } },

  // --- Intel Core Ultra (Meteor Lake / Arrow Lake) ---
  { pattern: /core\s*ultra\s*9/i, tier: { cpuIndex: 88, gpuIndex: 55, tier: 'Intel Core Ultra 9', year: 2024 } },
  { pattern: /core\s*ultra\s*7/i, tier: { cpuIndex: 80, gpuIndex: 48, tier: 'Intel Core Ultra 7', year: 2024 } },
  { pattern: /core\s*ultra\s*5/i, tier: { cpuIndex: 68, gpuIndex: 38, tier: 'Intel Core Ultra 5', year: 2024 } },

  // --- Intel Core (13th/14th gen H/U) ---
  { pattern: /core\s*i9/i, tier: { cpuIndex: 78, gpuIndex: 25, tier: 'Intel Core i9', year: 2023 } },
  { pattern: /core\s*i7/i, tier: { cpuIndex: 70, gpuIndex: 22, tier: 'Intel Core i7', year: 2023 } },
  { pattern: /core\s*i5/i, tier: { cpuIndex: 56, gpuIndex: 18, tier: 'Intel Core i5', year: 2023 } },
  { pattern: /core\s*i3/i, tier: { cpuIndex: 42, gpuIndex: 12, tier: 'Intel Core i3', year: 2023 } },
  { pattern: /pentium/i, tier: { cpuIndex: 28, gpuIndex: 8, tier: 'Intel Pentium', year: 2022 } },
  { pattern: /celeron/i, tier: { cpuIndex: 20, gpuIndex: 6, tier: 'Intel Celeron', year: 2022 } },

  // --- AMD Ryzen ---
  { pattern: /ryzen\s*9/i, tier: { cpuIndex: 86, gpuIndex: 52, tier: 'AMD Ryzen 9', year: 2024 } },
  { pattern: /ryzen\s*7/i, tier: { cpuIndex: 78, gpuIndex: 48, tier: 'AMD Ryzen 7', year: 2024 } },
  { pattern: /ryzen\s*5/i, tier: { cpuIndex: 62, gpuIndex: 32, tier: 'AMD Ryzen 5', year: 2024 } },
  { pattern: /ryzen\s*3/i, tier: { cpuIndex: 45, gpuIndex: 22, tier: 'AMD Ryzen 3', year: 2023 } },

  // --- Qualcomm Snapdragon (laptop + mobile) ---
  { pattern: /snapdragon\s*x\s*elite/i, tier: { cpuIndex: 90, gpuIndex: 60, tier: 'Snapdragon X Elite', year: 2024 } },
  { pattern: /snapdragon\s*x\s*plus/i, tier: { cpuIndex: 84, gpuIndex: 55, tier: 'Snapdragon X Plus', year: 2024 } },
  { pattern: /snapdragon\s*8\s*gen\s*4/i, tier: { cpuIndex: 80, gpuIndex: 72, tier: 'Snapdragon 8 Gen 4', year: 2024 } },
  { pattern: /snapdragon\s*8\s*gen\s*3/i, tier: { cpuIndex: 74, gpuIndex: 66, tier: 'Snapdragon 8 Gen 3', year: 2023 } },
  { pattern: /snapdragon\s*8s\s*gen\s*3/i, tier: { cpuIndex: 70, gpuIndex: 60, tier: 'Snapdragon 8s Gen 3', year: 2023 } },
  { pattern: /snapdragon\s*8\s*gen\s*2/i, tier: { cpuIndex: 66, gpuIndex: 58, tier: 'Snapdragon 8 Gen 2', year: 2022 } },
  { pattern: /snapdragon\s*7\+?\s*gen\s*3/i, tier: { cpuIndex: 68, gpuIndex: 58, tier: 'Snapdragon 7+ Gen 3', year: 2023 } },
  { pattern: /snapdragon\s*7\s*gen\s*3/i, tier: { cpuIndex: 62, gpuIndex: 54, tier: 'Snapdragon 7 Gen 3', year: 2022 } },
  { pattern: /snapdragon\s*6\s*gen\s*1/i, tier: { cpuIndex: 44, gpuIndex: 36, tier: 'Snapdragon 6 Gen 1', year: 2022 } },
  { pattern: /snapdragon\s*4\s*gen\s*2/i, tier: { cpuIndex: 34, gpuIndex: 28, tier: 'Snapdragon 4 Gen 2', year: 2023 } },

  // --- MediaTek ---
  { pattern: /dimensity\s*9400/i, tier: { cpuIndex: 82, gpuIndex: 74, tier: 'Dimensity 9400', year: 2024 } },
  { pattern: /dimensity\s*9300/i, tier: { cpuIndex: 78, gpuIndex: 70, tier: 'Dimensity 9300', year: 2024 } },
  { pattern: /dimensity\s*9200/i, tier: { cpuIndex: 72, gpuIndex: 64, tier: 'Dimensity 9200', year: 2023 } },
  { pattern: /dimensity\s*8300/i, tier: { cpuIndex: 66, gpuIndex: 52, tier: 'Dimensity 8300', year: 2023 } },
  { pattern: /dimensity\s*6100/i, tier: { cpuIndex: 48, gpuIndex: 34, tier: 'Dimensity 6100+', year: 2023 } },
  { pattern: /dimensity\s*7050/i, tier: { cpuIndex: 58, gpuIndex: 40, tier: 'Dimensity 7050', year: 2023 } },
  { pattern: /helio\s*p70/i, tier: { cpuIndex: 46, gpuIndex: 30, tier: 'Helio P70', year: 2023 } },
  { pattern: /helio\s*g99/i, tier: { cpuIndex: 34, gpuIndex: 22, tier: 'Helio G99', year: 2022 } },

  // --- Samsung Exynos ---
  { pattern: /exynos\s*2400/i, tier: { cpuIndex: 74, gpuIndex: 62, tier: 'Exynos 2400', year: 2024 } },
  { pattern: /exynos\s*1380/i, tier: { cpuIndex: 60, gpuIndex: 46, tier: 'Exynos 1380', year: 2023 } },
  { pattern: /exynos\s*1280/i, tier: { cpuIndex: 52, gpuIndex: 38, tier: 'Exynos 1280', year: 2022 } },
  { pattern: /exynos\s*9820/i, tier: { cpuIndex: 64, gpuIndex: 50, tier: 'Exynos 9820', year: 2020 } },

  // --- Google Tensor ---
  { pattern: /tensor\s*g5/i, tier: { cpuIndex: 78, gpuIndex: 66, tier: 'Tensor G5', year: 2025 } },
  { pattern: /tensor\s*g4/i, tier: { cpuIndex: 72, gpuIndex: 58, tier: 'Tensor G4', year: 2024 } },
  { pattern: /tensor\s*g3/i, tier: { cpuIndex: 66, gpuIndex: 52, tier: 'Tensor G3', year: 2023 } },
];

/** Discrete and integrated GPU tiers. */
const GPU_RULES: TierRule[] = [
  { pattern: /rtx\s*4090/i, tier: { cpuIndex: 0, gpuIndex: 100, tier: 'RTX 4090', year: 2022 } },
  { pattern: /rtx\s*4080/i, tier: { cpuIndex: 0, gpuIndex: 93, tier: 'RTX 4080', year: 2023 } },
  { pattern: /rtx\s*4070\s*ti/i, tier: { cpuIndex: 0, gpuIndex: 85, tier: 'RTX 4070 Ti', year: 2023 } },
  { pattern: /rtx\s*4070/i, tier: { cpuIndex: 0, gpuIndex: 78, tier: 'RTX 4070', year: 2023 } },
  { pattern: /rtx\s*4060\s*ti/i, tier: { cpuIndex: 0, gpuIndex: 68, tier: 'RTX 4060 Ti', year: 2023 } },
  { pattern: /rtx\s*4060/i, tier: { cpuIndex: 0, gpuIndex: 60, tier: 'RTX 4060', year: 2023 } },
  { pattern: /rtx\s*3050\s*ti/i, tier: { cpuIndex: 0, gpuIndex: 45, tier: 'RTX 3050 Ti', year: 2022 } },
  { pattern: /rtx\s*3050/i, tier: { cpuIndex: 0, gpuIndex: 38, tier: 'RTX 3050', year: 2022 } },
  { pattern: /rtx\s*2060/i, tier: { cpuIndex: 0, gpuIndex: 34, tier: 'RTX 2060', year: 2019 } },
  { pattern: /gtx\s*1650/i, tier: { cpuIndex: 0, gpuIndex: 22, tier: 'GTX 1650', year: 2019 } },
  { pattern: /rx\s*7900/i, tier: { cpuIndex: 0, gpuIndex: 92, tier: 'RX 7900', year: 2022 } },
  { pattern: /rx\s*7800/i, tier: { cpuIndex: 0, gpuIndex: 76, tier: 'RX 7800', year: 2023 } },
  { pattern: /rx\s*7700/i, tier: { cpuIndex: 0, gpuIndex: 69, tier: 'RX 7700', year: 2023 } },
  { pattern: /rx\s*7600/i, tier: { cpuIndex: 0, gpuIndex: 56, tier: 'RX 7600', year: 2023 } },
  { pattern: /radeon\s*780m/i, tier: { cpuIndex: 0, gpuIndex: 45, tier: 'Radeon 780M', year: 2023 } },
  { pattern: /radeon\s*760m/i, tier: { cpuIndex: 0, gpuIndex: 40, tier: 'Radeon 760M', year: 2023 } },
  { pattern: /radeon\s*680m/i, tier: { cpuIndex: 0, gpuIndex: 36, tier: 'Radeon 680M', year: 2021 } },
  { pattern: /iris\s*xe/i, tier: { cpuIndex: 0, gpuIndex: 20, tier: 'Intel Iris Xe', year: 2020 } },
  { pattern: /arc\s*a770/i, tier: { cpuIndex: 0, gpuIndex: 78, tier: 'Arc A770', year: 2022 } },
  { pattern: /intel\s*arc/i, tier: { cpuIndex: 0, gpuIndex: 55, tier: 'Intel Arc', year: 2022 } },
  { pattern: /vega\s*\d/i, tier: { cpuIndex: 0, gpuIndex: 15, tier: 'AMD Vega', year: 2019 } },
  { pattern: /mali/i, tier: { cpuIndex: 0, gpuIndex: 25, tier: 'ARM Mali', year: 2020 } },
  { pattern: /adreno/i, tier: { cpuIndex: 0, gpuIndex: 28, tier: 'Qualcomm Adreno', year: 2020 } },
];

/** Look up the performance tier for a processor name. */
export function lookupSocTier(socName: string | null | undefined): SocTier {
  if (!socName) return UNKNOWN;
  for (const rule of CPU_RULES) {
    if (rule.pattern.test(socName)) return rule.tier;
  }
  return UNKNOWN;
}

/** Look up the performance tier for a GPU name. */
export function lookupGpuTier(gpuName: string | null | undefined): SocTier {
  if (!gpuName) return { cpuIndex: 0, gpuIndex: 0, tier: 'no discrete GPU', year: 0 };
  for (const rule of GPU_RULES) {
    if (rule.pattern.test(gpuName)) return rule.tier;
  }
  return { cpuIndex: 0, gpuIndex: 0, tier: 'unrecognised GPU', year: 0 };
}

/**
 * VRAM in GB, parsed from a spec value like "8GB GDDR6", "dedicated 6GB".
 */
export function parseVramGb(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const match = value.match(/(\d+(?:\.\d+)?)\s*gb/i);
  return match?.[1] ? Number.parseFloat(match[1]) : null;
}

/**
 * Which local LLM sizes a machine can plausibly run, based on available memory.
 * This is a rough guide: full fine-tuning is not assumed, only inference.
 */
export function localModelCapacity(options: {
  ramGb?: number | null;
  vramGb?: number | null;
}): { models: string[]; note: string } {
  const vram = options.vramGb ?? 0;
  const ram = options.ramGb ?? 0;
  const totalMemory = vram + ram;

  const models: string[] = [];
  if (totalMemory >= 80) models.push('70B-class (4-bit)');
  if (totalMemory >= 48) models.push('32B-class (4-bit)');
  if (totalMemory >= 28) models.push('14B-class (4-bit)');
  if (totalMemory >= 18) models.push('7B-class (4-bit)');
  if (totalMemory >= 11) models.push('7B-class (8-bit)');
  if (totalMemory >= 8) models.push('3B-class (4-bit)');

  if (models.length === 0) {
    return {
      models: [],
      note: `With ${totalMemory}GB of combined memory this machine is not a practical target for local LLM inference.`,
    };
  }
  return {
    models,
    note: `Based on ${vram > 0 ? `${vram}GB dedicated VRAM + ` : ''}${ram}GB system memory. Roughly, 4-bit quantised weights need ~1.5× the parameter count in gigabytes.`,
  };
}
