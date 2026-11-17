/**
 * Category scoring components.
 *
 * A generic "spec score" would treat a phone and a washing machine identically,
 * which is exactly the failure mode SahiPick is built to avoid. Each category
 * defines its own components, their base weights, and how a component reads
 * the product's specifications, review intelligence and price.
 *
 * Every component returns a 0..1 score *and* the evidence behind it, so a
 * recommendation can always be traced back to a fact.
 */

import type { NormalizedSpecs, ReviewIntelligence } from '../../domain/types.ts';
import type { ComponentDefinition, ScoreInput } from '../categories/types.ts';
import { lookupGpuTier, lookupSocTier, parseVramGb } from '../normalize/soc-tiers.ts';
import { formatPaise } from '../normalize/specs.ts';


/** Linear interpolation into 0..1 with a soft ideal ceiling. */
export function ramp(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

/** Ramp that peaks at `ideal` then declines slightly for extreme values. */
export function peakRamp(value: number, min: number, max: number, ideal: number): number {
  if (value < min) return 0;
  if (value <= ideal) return ramp(value, min, ideal);
  // Above the ideal, stay high but never exceed 1.
  return Math.min(1, ramp(value, min, max) * 0.3 + 0.7);
}

/** Sentiment for an aspect from review intelligence, or null when absent. */
export function aspectSentiment(reviews: ReviewIntelligence | null, aspect: string): number | null {
  if (!reviews) return null;
  const summary = reviews.aspects.find((a) => a.aspect === aspect);
  if (!summary || summary.mentionCount === 0) return null;
  return summary.sentiment;
}

/** Negative-rate for an aspect, or null when the aspect was never mentioned. */
export function aspectNegativity(reviews: ReviewIntelligence | null, aspect: string): number | null {
  if (!reviews) return null;
  const summary = reviews.aspects.find((a) => a.aspect === aspect);
  if (!summary || summary.mentionCount === 0) return null;
  return summary.negativeRate;
}

export function getExtra(specs: NormalizedSpecs, ...keys: string[]): string | undefined {
  const lowered = new Map(Object.entries(specs.extra).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (value !== undefined) return String(value);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Smartphone profile                                                  */
/* ------------------------------------------------------------------ */

export const SMARTPHONE_COMPONENTS: ComponentDefinition[] = [
  {
    key: 'performance',
    label: 'Performance',
    baseWeight: 0.2,
    priorityKey: 'performance',
    compute({ specs }) {
      const tier = lookupSocTier(specs.soc);
      const ram = specs.ramGb ?? 4;
      const cpuScore = tier.cpuIndex / 100;
      const ramScore = ramp(ram, 3, 16);
      const score = Math.min(1, cpuScore * 0.75 + ramScore * 0.25);
      const evidence: string[] = [];
      if (specs.soc) evidence.push(`${specs.soc} (${tier.tier} class)`);
      evidence.push(`${ram}GB RAM`);
      if (tier.tier === 'unknown' && specs.soc) {
        evidence.push('Processor not in the performance index — score based on RAM alone');
      }
      return { score, evidence };
    },
  },
  {
    key: 'camera',
    label: 'Camera',
    baseWeight: 0.18,
    priorityKey: 'camera',
    compute({ specs, reviews }) {
      const mp = specs.cameraMainMp ?? 0;
      const mpScore = peakRamp(mp, 5, 200, 50);
      const countScore = ramp(specs.rearCameraCount ?? 1, 1, 4);
      const reviewScore = aspectSentiment(reviews, 'camera');
      const base = mpScore * 0.6 + countScore * 0.2;
      const score = reviewScore === null ? base : Math.min(1, base * 0.7 + (reviewScore + 1) / 2 * 0.3);
      const evidence: string[] = [];
      if (mp > 0) evidence.push(`${mp}MP main camera`);
      if (specs.rearCameraCount) evidence.push(`${specs.rearCameraCount} rear cameras`);
      if (reviewScore !== null) {
        const summary = reviews?.aspects.find((a) => a.aspect === 'camera');
        evidence.push(
          `Owner sentiment on camera: ${reviewScore >= 0 ? 'mostly positive' : 'mostly negative'} (${summary?.mentionCount ?? 0} mentions)`,
        );
      }
      return { score, evidence };
    },
  },
  {
    key: 'battery',
    label: 'Battery',
    baseWeight: 0.17,
    priorityKey: 'battery',
    compute({ specs, reviews }) {
      const mah = specs.batteryMah ?? 0;
      const capacityScore = peakRamp(mah, 2500, 7000, 5000);
      const reviewScore = aspectSentiment(reviews, 'battery');
      const score = reviewScore === null ? capacityScore : Math.min(1, capacityScore * 0.6 + (reviewScore + 1) / 2 * 0.4);
      const evidence: string[] = [];
      if (mah > 0) evidence.push(`${mah}mAh battery`);
      if (reviewScore !== null) {
        const summary = reviews?.aspects.find((a) => a.aspect === 'battery');
        evidence.push(
          `Owner sentiment on battery: ${reviewScore >= 0 ? 'mostly positive' : 'mostly negative'} (${summary?.mentionCount ?? 0} mentions)`,
        );
      }
      if (reviews?.longTermConcerns.some((c) => c.includes('battery'))) {
        evidence.push('Battery degradation reported in longer-term reviews');
      }
      return { score, evidence };
    },
  },
  {
    key: 'display',
    label: 'Display',
    baseWeight: 0.13,
    priorityKey: 'display',
    compute({ specs }) {
      const refresh = specs.refreshHz ?? 60;
      const refreshScore = ramp(refresh, 60, 144);
      const panelScore = specs.displayPanel?.toUpperCase().includes('AMOLED') ? 1 : specs.displayPanel ? 0.6 : 0.4;
      const sizeScore = specs.displaySizeIn ? peakRamp(specs.displaySizeIn, 4.5, 7.5, 6.4) : 0.5;
      const score = Math.min(1, refreshScore * 0.45 + panelScore * 0.35 + sizeScore * 0.2);
      const evidence: string[] = [];
      if (specs.refreshHz) evidence.push(`${specs.refreshHz}Hz refresh rate`);
      if (specs.displayPanel) evidence.push(`${specs.displayPanel} panel`);
      if (specs.displaySizeIn) evidence.push(`${specs.displaySizeIn}" display`);
      return { score, evidence };
    },
  },
  {
    key: 'software_support',
    label: 'Software & support',
    baseWeight: 0.1,
    priorityKey: 'software',
    compute({ specs, reviews }) {
      const osScore = specs.os === 'iOS' ? 0.95 : specs.os === 'Android' ? 0.7 : 0.5;
      const warrantyScore = specs.warrantyMonths ? ramp(specs.warrantyMonths, 6, 36) : 0.5;
      const reviewScore = aspectSentiment(reviews, 'software');
      const base = osScore * 0.5 + warrantyScore * 0.2;
      const score = reviewScore === null ? base : Math.min(1, base * 0.6 + (reviewScore + 1) / 2 * 0.4);
      const evidence: string[] = [];
      if (specs.os) evidence.push(`${specs.os}`);
      if (specs.warrantyMonths) evidence.push(`${specs.warrantyMonths}-month warranty`);
      if (reviewScore !== null) evidence.push('Owner sentiment on software is mixed');
      return { score, evidence };
    },
  },
  {
    key: 'build_quality',
    label: 'Build quality & reliability',
    baseWeight: 0.09,
    priorityKey: 'build_quality',
    compute({ specs, reviews }) {
      const reviewScore = aspectSentiment(reviews, 'build_quality');
      const durability = aspectSentiment(reviews, 'durability');
      const service = aspectSentiment(reviews, 'service');
      const scores = [reviewScore, durability, service].filter((s): s is number => s !== null);
      const base = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.55;
      const evidence: string[] = [];
      if (reviewScore !== null) evidence.push(`Build quality sentiment ${reviewScore >= 0 ? 'positive' : 'negative'}`);
      if (durability !== null) evidence.push(`Durability sentiment ${durability >= 0 ? 'positive' : 'negative'}`);
      if (service !== null) evidence.push(`Service experience ${service >= 0 ? 'positive' : 'negative'}`);
      if (reviews && reviews.authenticityRisk > 0.4) {
        evidence.push('Review authenticity risk is elevated, so these signals carry less weight');
      }
      return { score: (base + 1) / 2, evidence };
    },
  },
  {
    key: 'value',
    label: 'Value for money',
    baseWeight: 0.13,
    priorityKey: 'value',
    compute({ specs, pricePaise, referencePricePaise }) {
      if (pricePaise === null) {
        return { score: 0.5, evidence: ['No confirmed price available, so value could not be computed'] };
      }
      const reference = referencePricePaise ?? pricePaise;
      const tier = lookupSocTier(specs.soc);
      const capability = (tier.cpuIndex / 100) * 0.6 + ramp(specs.ramGb ?? 4, 3, 16) * 0.2 + peakRamp(specs.cameraMainMp ?? 0, 5, 200, 50) * 0.2;
      // Cheaper than the reference price for the same capability scores higher.
      const priceRatio = reference > 0 ? pricePaise / reference : 1;
      const efficiency = capability / Math.max(0.35, priceRatio);
      const score = Math.min(1, efficiency);
      return {
        score,
        evidence: [
          `${formatPaise(pricePaise)}${reference !== pricePaise ? ` vs ${formatPaise(reference)} for comparable candidates` : ''}`,
          `Capability index ${Math.round(capability * 100)}/100`,
        ],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Laptop profile                                                      */
/* ------------------------------------------------------------------ */

export const LAPTOP_COMPONENTS: ComponentDefinition[] = [
  {
    key: 'cpu',
    label: 'Processor',
    baseWeight: 0.18,
    priorityKey: 'performance',
    compute({ specs }) {
      const tier = lookupSocTier(specs.soc);
      const cores = specs.cpuCores ?? 0;
      const coreScore = cores > 0 ? ramp(cores, 2, 16) : 0.5;
      const score = Math.min(1, (tier.cpuIndex / 100) * 0.85 + coreScore * 0.15);
      const evidence: string[] = [];
      if (specs.soc) evidence.push(`${specs.soc} (${tier.tier} class)`);
      if (cores > 0) evidence.push(`${cores} CPU cores`);
      return { score, evidence };
    },
  },
  {
    key: 'gpu',
    label: 'Graphics',
    baseWeight: 0.13,
    priorityKey: 'performance',
    workloads: ['gaming', 'local_ai', 'video_editing', 'design'],
    compute({ specs }) {
      const gpuName = getExtra(specs, 'gpu', 'graphics', 'gpu model', 'graphics card');
      const tier = lookupGpuTier(gpuName);
      const vram = parseVramGb(getExtra(specs, 'vram', 'dedicated graphics memory', 'gpu memory'));
      let score = tier.gpuIndex / 100;
      const evidence: string[] = [];
      if (gpuName) evidence.push(`${gpuName} (${tier.tier})`);
      else evidence.push('No discrete GPU listed');
      if (vram !== null && vram > 0) {
        score = Math.min(1, score * 0.7 + ramp(vram, 2, 16) * 0.3);
        evidence.push(`${vram}GB dedicated graphics memory`);
      }
      return { score, evidence };
    },
  },
  {
    key: 'memory',
    label: 'Memory & upgradeability',
    baseWeight: 0.14,
    priorityKey: 'memory',
    compute({ specs }) {
      const ram = specs.ramGb ?? 0;
      const ramScore = peakRamp(ram, 4, 64, 32);
      const slots = getExtra(specs, 'ram slots', 'memory slots', 'ram slot');
      const expandable = getExtra(specs, 'expandable', 'ram expandable', 'upgradeable');
      let upgradeScore = 0.5;
      const evidence: string[] = [`${ram || '?'}GB RAM`];
      if (slots) {
        const slotCount = Number.parseInt(slots, 10);
        if (Number.isFinite(slotCount)) {
          upgradeScore = Math.min(1, slotCount / 4);
          evidence.push(`${slotCount} RAM slot${slotCount === 1 ? '' : 's'}`);
        }
      }
      if (expandable) {
        const truthy = /yes|true|support/i.test(expandable);
        upgradeScore = truthy ? 1 : upgradeScore;
        evidence.push(truthy ? 'RAM is expandable' : 'RAM is not expandable');
      }
      return { score: Math.min(1, ramScore * 0.75 + upgradeScore * 0.25), evidence };
    },
  },
  {
    key: 'storage',
    label: 'Storage',
    baseWeight: 0.1,
    priorityKey: 'storage',
    compute({ specs }) {
      const size = specs.storageGb ?? 0;
      const sizeScore = peakRamp(size, 128, 4096, 1024);
      const type = specs.storageType?.toLowerCase() ?? '';
      const typeScore = type.includes('ssd') || type.includes('nvme') ? 1 : type.includes('emmc') ? 0.35 : 0.6;
      const evidence: string[] = [`${size || '?'}GB storage`];
      if (specs.storageType) evidence.push(`${specs.storageType} drive`);
      const slots = getExtra(specs, 'ssd slots', 'storage slots');
      if (slots) evidence.push(`${slots} storage slot(s)`);
      return { score: Math.min(1, sizeScore * 0.7 + typeScore * 0.3), evidence };
    },
  },
  {
    key: 'display',
    label: 'Display',
    baseWeight: 0.1,
    priorityKey: 'display',
    compute({ specs }) {
      const refresh = specs.refreshHz ?? 60;
      const refreshScore = ramp(refresh, 60, 165);
      const resolution = getExtra(specs, 'resolution', 'screen resolution');
      const resolutionScore = resolution
        ? /4k|3840|2160/i.test(resolution)
          ? 1
          : /qhd|2560|1440/i.test(resolution)
            ? 0.85
            : /fhd|1920|1080/i.test(resolution)
              ? 0.65
              : 0.5
        : 0.5;
      const panel = getExtra(specs, 'panel', 'display type', 'screen type');
      const panelScore = panel && /ips|oled|mini-?led|amoled/i.test(panel) ? 1 : panel ? 0.7 : 0.5;
      const evidence: string[] = [];
      if (specs.displaySizeIn) evidence.push(`${specs.displaySizeIn}" panel`);
      if (refresh > 0) evidence.push(`${refresh}Hz refresh rate`);
      if (resolution) evidence.push(`${resolution} resolution`);
      return { score: Math.min(1, refreshScore * 0.3 + resolutionScore * 0.4 + panelScore * 0.3), evidence };
    },
  },
  {
    key: 'portability',
    label: 'Battery life & portability',
    baseWeight: 0.12,
    priorityKey: 'battery',
    compute({ specs, reviews }) {
      const mah = specs.batteryMah ?? 0;
      const capacityScore = peakRamp(mah, 30, 100, 70);
      const weightText = getExtra(specs, 'weight', 'weight kg', 'product weight');
      const weight = weightText ? Number.parseFloat(weightText) : null;
      const weightScore = weight === null || !Number.isFinite(weight) ? 0.6 : 1 - ramp(weight, 1.1, 2.4);
      const reviewScore = aspectSentiment(reviews, 'battery');
      const base = capacityScore * 0.4 + weightScore * 0.25;
      const score =
        reviewScore === null ? base : Math.min(1, base * 0.6 + (reviewScore + 1) / 2 * 0.4);
      const evidence: string[] = [];
      if (mah > 0) evidence.push(`${mah}mAh battery`);
      if (weight !== null && Number.isFinite(weight)) evidence.push(`${weight}kg chassis`);
      if (reviewScore !== null) evidence.push('Owner sentiment on battery is captured from reviews');
      return { score, evidence };
    },
  },
  {
    key: 'thermals',
    label: 'Thermal behaviour',
    baseWeight: 0.08,
    priorityKey: 'heating',
    compute({ reviews }) {
      const negativity = aspectNegativity(reviews, 'heating');
      if (negativity === null) {
        return { score: 0.55, evidence: ['No thermal feedback in the available reviews'] };
      }
      const score = 1 - negativity;
      const summary = reviews?.aspects.find((a) => a.aspect === 'heating');
      return {
        score,
        evidence: [
          `${Math.round(negativity * 100)}% of heating mentions are complaints (${summary?.mentionCount ?? 0} mentions)`,
        ],
      };
    },
  },
  {
    key: 'build_quality',
    label: 'Build quality & reliability',
    baseWeight: 0.09,
    priorityKey: 'build_quality',
    compute({ specs, reviews }) {
      const reviewScore = aspectSentiment(reviews, 'build_quality');
      const durability = aspectSentiment(reviews, 'durability');
      const service = aspectSentiment(reviews, 'service');
      const scores = [reviewScore, durability, service].filter((s): s is number => s !== null);
      const warranty = specs.warrantyMonths ? ramp(specs.warrantyMonths, 6, 36) : 0.5;
      const base = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length + 1) / 2 : 0.55;
      const evidence: string[] = [];
      if (scores.length === 0) evidence.push('No reliability feedback in the available reviews');
      if (durability !== null) evidence.push(`Durability sentiment ${durability >= 0 ? 'positive' : 'negative'}`);
      if (service !== null) evidence.push(`Service experience ${service >= 0 ? 'positive' : 'negative'}`);
      if (specs.warrantyMonths) evidence.push(`${specs.warrantyMonths}-month warranty`);
      return { score: Math.min(1, base * 0.8 + warranty * 0.2), evidence };
    },
  },
  {
    key: 'local_ai',
    label: 'Local AI model capability',
    // A small base weight so the component contributes whenever the workload
    // applies; the user's own priority then multiplies it.
    baseWeight: 0.07,
    priorityKey: 'local_ai',
    workloads: ['local_ai'],
    compute({ specs }) {
      const vram = parseVramGb(getExtra(specs, 'vram', 'dedicated graphics memory', 'gpu memory'));
      const ram = specs.ramGb ?? 0;
      const total = (vram ?? 0) + ram;
      const memoryScore = ramp(total, 8, 80);
      const tier = lookupSocTier(specs.soc);
      const cpuScore = tier.cpuIndex / 100;
      const score = Math.min(1, memoryScore * 0.7 + cpuScore * 0.3);
      const evidence: string[] = [
        vram !== null && vram > 0
          ? `${vram}GB VRAM + ${ram}GB RAM`
          : `${ram}GB system memory, no dedicated VRAM`,
        `Memory bandwidth proxy score ${Math.round(memoryScore * 100)}/100`,
      ];
      if (!vram) {
        evidence.push('Without dedicated VRAM, large models must run on system memory, which is markedly slower');
      }
      return { score, evidence };
    },
  },
  {
    key: 'value',
    label: 'Value for money',
    baseWeight: 0.06,
    priorityKey: 'value',
    compute({ specs, pricePaise, referencePricePaise }) {
      if (pricePaise === null) {
        return { score: 0.5, evidence: ['No confirmed price available, so value could not be computed'] };
      }
      const reference = referencePricePaise ?? pricePaise;
      const tier = lookupSocTier(specs.soc);
      const gpuTier = lookupGpuTier(getExtra(specs, 'gpu', 'graphics', 'gpu model'));
      const ram = specs.ramGb ?? 0;
      const storage = specs.storageGb ?? 0;
      const capability =
        (tier.cpuIndex / 100) * 0.45 +
        (gpuTier.gpuIndex / 100) * 0.2 +
        ramp(ram, 4, 64) * 0.2 +
        ramp(storage, 128, 2048) * 0.15;
      const priceRatio = reference > 0 ? pricePaise / reference : 1;
      const efficiency = capability / Math.max(0.35, priceRatio);
      return {
        score: Math.min(1, efficiency),
        evidence: [
          `${formatPaise(pricePaise)}${reference !== pricePaise ? ` vs ${formatPaise(reference)} median` : ''}`,
          `Capability index ${Math.round(capability * 100)}/100`,
        ],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Generic profile (categories not yet specialised)                     */
/* ------------------------------------------------------------------ */

export const GENERIC_COMPONENTS: ComponentDefinition[] = [
  {
    key: 'specifications',
    label: 'Specifications',
    baseWeight: 0.5,
    compute({ specs }) {
      const filled = Object.entries(specs).filter(
        ([key, value]) => key !== 'extra' && value !== undefined && value !== null,
      ).length;
      return {
        score: Math.min(1, filled / 6),
        evidence: [`${filled} specification fields available`],
      };
    },
  },
  {
    key: 'reliability',
    label: 'Reliability',
    baseWeight: 0.25,
    compute({ reviews }) {
      const negativity = aspectNegativity(reviews, 'durability');
      if (negativity === null) return { score: 0.55, evidence: ['No reliability feedback available'] };
      return { score: 1 - negativity, evidence: ['Derived from durability mentions in reviews'] };
    },
  },
  {
    key: 'value',
    label: 'Value for money',
    baseWeight: 0.25,
    priorityKey: 'value',
    compute({ pricePaise, referencePricePaise }) {
      if (pricePaise === null || !referencePricePaise || referencePricePaise <= 0) {
        return { score: 0.5, evidence: ['No price comparison available'] };
      }
      const ratio = pricePaise / referencePricePaise;
      return {
        score: Math.min(1, Math.max(0, 1 - ratio * 0.8 + 0.4)),
        evidence: [`${formatPaise(pricePaise)} vs ${formatPaise(referencePricePaise)} median`],
      };
    },
  },
];

