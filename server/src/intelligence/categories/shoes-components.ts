/**
 * The footwear decision evaluator.
 *
 * A shoe is judged on things a specification table does not contain:
 * whether the size runs true, whether the midsole gives back after a
 * month, whether the sole separates at the seam. This evaluator reads
 * what the retailer published *and* what owners reported, and scores
 * each shoe on the dimensions that actually decide a shoe purchase.
 *
 * The scoring is deterministic. Nothing here calls a model. A dimension
 * with no evidence is reported as unknown rather than guessed, and an
 * unknown dimension never penalises the shoe.
 */

import type { ComponentDefinition, ScoreInput } from '../categories/types.ts';
import { SHOE_TYPES, detectShoeType, type ShoeType } from './shoe-types.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Read a specification value in a case-insensitive, space-insensitive way. */
export function spec(
  input: ScoreInput,
  ...keys: string[]
): string | number | boolean | undefined {
  const wanted = keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // An exact label match first: "Upper Material" for "upperMaterial".
  const entries = Object.entries(input.specs ?? {});
  for (const [key, value] of entries) {
    const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.includes(normalised) && value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  // Then a looser match, because retailers publish "Shoe Size", "Upper
  // Material (Mesh)" and similar extensions of the canonical label.
  for (const [key, value] of entries) {
    const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      wanted.some(
        (wantedKey) =>
          wantedKey.length >= 3 &&
          (normalised.startsWith(wantedKey) || normalised.endsWith(wantedKey)),
      ) &&
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      return value;
    }
  }

  return undefined;
}

/**
 * The owner complaints recorded for this product.
 *
 * Both the complaint phrases and the long-term concerns are read,
 * because a shoe can fail two ways: the phrases owners reach for
 * ("runs small") and the problems that appear over time ("sole
 * separated").
 */
export function complaints(input: ScoreInput): string[] {
  const reviews = input.reviews as unknown as {
    complaints?: string[];
    longTermConcerns?: string[];
  } | null;
  return [...(reviews?.complaints ?? []), ...(reviews?.longTermConcerns ?? [])];
}

/**
 * The review aspects recorded for this product, keyed by aspect name.
 *
 * The analysis returns a list, so it is indexed here. The sentiment is
 * a number from -1 to 1.
 */
export function aspects(
  input: ScoreInput,
): Record<string, { sentiment: number; mentions: number; negativeRate: number }> {
  const reviews = input.reviews as unknown as {
    aspects?: {
      aspect: string;
      sentiment: number;
      mentionCount: number;
      negativeRate: number;
    }[];
  } | null;

  const out: Record<string, { sentiment: number; mentions: number; negativeRate: number }> = {};
  for (const aspect of reviews?.aspects ?? []) {
    out[aspect.aspect] = {
      sentiment: aspect.sentiment,
      mentions: aspect.mentionCount,
      negativeRate: aspect.negativeRate,
    };
  }
  return out;
}

/** Score 0..1 from a numeric value against an acceptable range. */
function rangeScore(
  value: number,
  best: { min: number; max: number },
  fallback: number,
): number {
  if (value < best.min) {
    // Below the ideal range. Penalise proportionally but never below 0.
    const span = best.min - fallback;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - (best.min - value) / span));
  }
  if (value > best.max) {
    const span = 1.5 - best.max;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - (value - best.max) / span));
  }
  return 1;
}

/**
 * Turn a weighted sentiment (-1..1) into a 0..1 score.
 *
 * A sentiment of zero means the owners did not say either way, which is
 * not the same as neutral satisfaction — but it is the only honest
 * reading of "no signal", so it maps to the midpoint.
 */
function sentimentScore(sentiment: number): number {
  if (!Number.isFinite(sentiment)) return 0.5;
  return Math.max(0, Math.min(1, (sentiment + 1) / 2));
}

/* ------------------------------------------------------------------ */
/* The components                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fit and sizing.
 *
 * The size itself is not quality — the *fit* is. Two shoes of the same
 * size can fit completely differently. The evidence is owner reports of
 * "runs small", "runs large", "narrow" and "true to size".
 */
const fitComponent: ComponentDefinition = {
  key: 'fit',
  label: 'Fit & Sizing',
  baseWeight: 0.2,
  priorityKey: 'fit',
  compute(input) {
    const evidence: string[] = [];

    const size = spec(input, 'size', 'shoeSize');
    const standard = spec(input, 'sizeStandard', 'sizeChart');
    const width = spec(input, 'width');

    if (size !== undefined) {
      evidence.push(`Size ${String(size)}${standard ? ` (${String(standard)})` : ''}`);
    }
    if (width !== undefined) evidence.push(`Width: ${String(width)}`);

    const reviewAspects = aspects(input);
    const fitAspect = reviewAspects.fit;
    let score: number | null = null;

    if (fitAspect && fitAspect.mentions > 0) {
      score = sentimentScore(fitAspect.sentiment);
      evidence.push(
        `Owners report on fit: ${fitAspect.mentions} mention${fitAspect.mentions === 1 ? '' : 's'}, ${fitAspect.negativeRate > 0.5 ? 'mostly negative' : 'mostly positive'}.`,
      );
    }

    // Sizing complaints pull the score down, because a shoe that cannot
    // be worn is not a shoe.
    const complaintsList = complaints(input);
    const runsSmall = complaintsList.some((c) => /runs? small|runs? narrow|too (?:small|tight)/i.test(c));
    const runsLarge = complaintsList.some((c) => /runs? large|too big|falls? off/i.test(c));
    const wrongChart = complaintsList.some((c) => /size chart (?:is )?wrong|size chart (?:does ?n[o']t|match)/i.test(c));

    if (runsSmall) {
      score = score === null ? 0.4 : Math.min(score, 0.4);
      evidence.push('Recurring complaint: the size runs small.');
    }
    if (runsLarge) {
      score = score === null ? 0.4 : Math.min(score, 0.4);
      evidence.push('Recurring complaint: the size runs large.');
    }
    if (wrongChart) {
      score = score === null ? 0.5 : Math.min(score, 0.5);
      evidence.push('Recurring complaint: the published size chart does not match the actual shoe.');
    }

    // A published width is worth something on its own.
    if (score === null && width !== undefined) {
      score = String(width).toLowerCase().includes('wide') ? 0.7 : 0.6;
    }

    return { score: score ?? 0.5, evidence };
  },
};

/**
 * Comfort.
 *
 * Comfort comes from owner reports more than from a spec sheet. A shoe
 * that says "memory foam" is a claim; a hundred owners saying the shoe
 * is comfortable all day is evidence.
 */
const comfortComponent: ComponentDefinition = {
  key: 'comfort',
  label: 'Comfort',
  baseWeight: 0.18,
  priorityKey: 'comfort',
  compute(input) {
    const evidence: string[] = [];
    const reviewAspects = aspects(input);
    const comfortAspect = reviewAspects.comfort;
    const buildAspect = reviewAspects.build_quality;

    let score: number | null = null;

    if (comfortAspect && comfortAspect.mentions > 0) {
      score = sentimentScore(comfortAspect.sentiment);
      evidence.push(
        `Owners report on comfort: ${comfortAspect.mentions} mention${comfortAspect.mentions === 1 ? '' : 's'}, ${comfortAspect.negativeRate > 0.5 ? 'mostly negative' : 'mostly positive'}.`,
      );
    }

    // The midsole material is a weak signal about cushioning.
    const midsole = spec(input, 'midsoleMaterial', 'midsole', 'cushioningMaterial');
    if (midsole !== undefined) {
      evidence.push(`Midsole: ${String(midsole)}`);
      if (score === null) {
        const lower = String(midsole).toLowerCase();
        if (/foam|eva|boost|air|max|gel|zoom/.test(lower)) score = 0.7;
        else if (/phylon|pua|eva/.test(lower)) score = 0.6;
        else score = 0.5;
      }
    }

    // Break-in is a comfort factor: a shoe that needs a month to get
    // comfortable is a real cost.
    const complaintsList = complaints(input);
    const breakIn = complaintsList.find((c) => /break[- ]?in|initially (?:tight|uncomfortable)|took (?:a )?(?:week|month)/i.test(c));
    if (breakIn) {
      score = score === null ? 0.45 : Math.min(score, 0.55);
      evidence.push(`Owner report: ${breakIn}`);
    }

    if (buildAspect && buildAspect.mentions > 0 && score === null) {
      score = sentimentScore(buildAspect.sentiment) * 0.9;
    }

    return { score: score ?? 0.5, evidence };
  },
};

/**
 * Cushioning and support.
 *
 * Read from the midsole, the drop, and owner reports of how the shoe
 * feels over distance.
 */
const cushioningComponent: ComponentDefinition = {
  key: 'cushioning',
  label: 'Cushioning & Support',
  baseWeight: 0.15,
  priorityKey: 'cushioning',
  compute(input) {
    const evidence: string[] = [];
    let score: number | null = null;

    const drop = spec(input, 'soleThicknessMm', 'stackHeight', 'drop');
    if (typeof drop === 'number') {
      evidence.push(`Sole thickness / drop: ${drop}mm`);
      // A visible drop suits running; a flat sole suits gym and court.
      score = rangeScore(drop, { min: 6, max: 12 }, 0);
    }

    const midsole = spec(input, 'midsoleMaterial', 'midsole');
    if (midsole !== undefined) {
      evidence.push(`Midsole: ${String(midsole)}`);
      if (score === null) {
        const lower = String(midsole).toLowerCase();
        score = /boost|air|max|zoom|luxe|supercritical/.test(lower)
          ? 0.85
          : /foam|eva|gel/.test(lower)
            ? 0.7
            : /phylon|pua/.test(lower)
              ? 0.6
              : 0.5;
      }
    }

    const reviewAspects = aspects(input);
    const performanceAspect = reviewAspects.performance;
    if (performanceAspect && performanceAspect.mentions > 0) {
      const fromReviews = sentimentScore(performanceAspect.sentiment);
      score = score === null ? fromReviews : (score + fromReviews) / 2;
      evidence.push(
        `Owners report on performance: ${performanceAspect.mentions} mention${performanceAspect.mentions === 1 ? '' : 's'}.`,
      );
    }

    return { score: score ?? 0.5, evidence };
  },
};

/**
 * Grip and traction.
 *
 * The outsole material and the surface the shoe is intended for. A
 * road-running outsole on a wet floor is a mismatch, and a trail outsole
 * on a treadmill is overkill.
 */
const gripComponent: ComponentDefinition = {
  key: 'grip',
  label: 'Grip & Traction',
  baseWeight: 0.12,
  priorityKey: 'grip',
  compute(input) {
    const evidence: string[] = [];
    let score: number | null = null;

    const outsole = spec(input, 'outsoleMaterial', 'outsole', 'soleMaterial');
    const surface = spec(input, 'surface', 'terrain', 'treadPattern');

    if (outsole !== undefined) {
      evidence.push(`Outsole: ${String(outsole)}`);
      const lower = String(outsole).toLowerCase();
      score = / Vibram|sticky|rubber|gum/.test(lower) ? 0.8 : /rubber/.test(lower) ? 0.7 : 0.5;
    }

    if (surface !== undefined) {
      evidence.push(`Intended surface: ${String(surface)}`);
      if (score === null) score = 0.65;
    }

    const complaintsList = complaints(input);
    const slippery = complaintsList.find((c) => /slip|slipped|no grip|slippery/i.test(c));
    if (slippery) {
      score = score === null ? 0.35 : Math.min(score, 0.45);
      evidence.push(`Owner report: ${slippery}`);
    }

    return { score: score ?? 0.5, evidence };
  },
};

/**
 * Material and breathability.
 */
const materialComponent: ComponentDefinition = {
  key: 'material',
  label: 'Material & Breathability',
  baseWeight: 0.1,
  priorityKey: 'breathability',
  compute(input) {
    const evidence: string[] = [];
    let score: number | null = null;

    const upper = spec(input, 'upperMaterial', 'material', 'outerMaterial');
    if (upper !== undefined) {
      evidence.push(`Upper: ${String(upper)}`);
      const lower = String(upper).toLowerCase();
      if (/mesh|knit|engineered|flyknit|knitted|breathable/.test(lower)) score = 0.8;
      else if (/canvas|leather|suede/.test(lower)) score = 0.55;
      else score = 0.6;
    }

    const complaintsList = complaints(input);
    const notBreathable = complaintsList.find((c) =>
      /not breathable|hot|smelly|sweat|odor|odour/i.test(c),
    );
    if (notBreathable) {
      score = score === null ? 0.35 : Math.min(score, 0.45);
      evidence.push(`Owner report: ${notBreathable}`);
    }

    const buildAspect = aspects(input).build_quality;
    if (buildAspect && buildAspect.mentions > 0 && score === null) {
      score = sentimentScore(buildAspect.sentiment);
      evidence.push(
        `Owners report on build quality: ${buildAspect.mentions} mention${buildAspect.mentions === 1 ? '' : 's'}.`,
      );
    }

    return { score: score ?? 0.5, evidence };
  },
};

/**
 * Durability and sole wear.
 *
 * The most consequential dimension in this category, because a shoe that
 * falls apart in three months has a much higher cost of ownership than
 * its price suggests.
 */
const durabilityComponent: ComponentDefinition = {
  key: 'durability',
  label: 'Durability & Sole Wear',
  baseWeight: 0.13,
  priorityKey: 'durability',
  compute(input) {
    const evidence: string[] = [];
    let score: number | null = null;

    const buildAspect = aspects(input).build_quality;
    if (buildAspect && buildAspect.mentions > 0) {
      score = sentimentScore(buildAspect.sentiment);
      evidence.push(
        `Owners report on build quality: ${buildAspect.mentions} mention${buildAspect.mentions === 1 ? '' : 's'}.`,
      );
    }

    const complaintsList = complaints(input);
    const structural = complaintsList.find((c) =>
      /sole (?:separat|come|came|peel)|falls? apart|outsole (?:came|separat)|delaminat/i.test(c),
    );
    const stitching = complaintsList.find((c) => /stitch|thread came|seam (?:came|failed)/i.test(c));
    const woreOut = complaintsList.find((c) =>
      /wore out|sole (?:is )?(?:worn|tore)|after \d+ (?:months|weeks)|fell apart/i.test(c),
    );

    if (structural) {
      score = score === null ? 0.15 : Math.min(score, 0.25);
      evidence.push(`Owner report: ${structural}`);
    } else if (stitching) {
      score = score === null ? 0.35 : Math.min(score, 0.45);
      evidence.push(`Owner report: ${stitching}`);
    } else if (woreOut) {
      score = score === null ? 0.4 : Math.min(score, 0.5);
      evidence.push(`Owner report: ${woreOut}`);
    }

    const warranty = spec(input, 'warranty');
    if (warranty !== undefined && score !== null) {
      evidence.push(`Warranty: ${String(warranty)}`);
    }

    return { score: score ?? 0.5, evidence };
  },
};

/**
 * Weight.
 *
 * A lighter shoe is easier over distance. The threshold depends on the
 * intended use: a runner notices 30g, a casual wearer does not.
 */
const weightComponent: ComponentDefinition = {
  key: 'weight',
  label: 'Weight',
  baseWeight: 0.05,
  priorityKey: 'weight',
  compute(input) {
    const grams = spec(input, 'weightGrams', 'weight');
    if (typeof grams !== 'number') return { score: 0.5, evidence: [] };

    // The weight is usually published per shoe or per pair. Anything
    // under 400g is almost certainly per shoe.
    const perShoe = grams < 400 ? grams : grams / 2;

    const use = detectShoeType(
      [
        String(spec(input, 'surface') ?? ''),
        String(spec(input, 'intendedUse') ?? ''),
        String(spec(input, 'activity') ?? ''),
      ].join(' '),
    );

    const ideal: Record<string, number> = {
      running: 240,
      sports: 270,
      gym: 300,
      walking: 280,
      hiking: 340,
      casual: 320,
      formal: 320,
    };

    const target = ideal[use ?? 'casual'] ?? 300;
    const score = rangeScore(perShoe, { min: target - 60, max: target + 80 }, target * 1.5);

    return {
      score,
      evidence: [`Weight: ${Math.round(perShoe)}g per shoe`],
    };
  },
};

/**
 * Style.
 *
 * Only meaningful when the shoe is bought for its appearance. It reads
 * from the design reviews and, weakly, from the upper material.
 */
const styleComponent: ComponentDefinition = {
  key: 'style',
  label: 'Style',
  baseWeight: 0.05,
  priorityKey: 'style',
  compute(input) {
    const designAspect = aspects(input).design;
    if (designAspect && designAspect.mentions > 0) {
      return {
        score: sentimentScore(designAspect.sentiment),
        evidence: [
          `Owners report on appearance: ${designAspect.mentions} mention${designAspect.mentions === 1 ? '' : 's'}.`,
        ],
      };
    }
    return { score: 0.5, evidence: [] };
  },
};

/**
 * Value for money.
 *
 * A shoe's honest measure is cost per wear. Without a wear estimate this
 * stays at the price comparison, which is the weaker but still valid
 * measure.
 */
const valueComponent: ComponentDefinition = {
  key: 'value',
  label: 'Value for Money',
  baseWeight: 0.02,
  priorityKey: 'value',
  compute(input) {
    const evidence: string[] = [];
    if (input.pricePaise === null || input.referencePricePaise === null) {
      return { score: 0.5, evidence };
    }

    if (input.pricePaise <= 0) return { score: 0.5, evidence };

    // Cheaper than the set median is good value.
    const ratio = input.pricePaise / input.referencePricePaise;
    const score = ratio <= 0.85 ? 0.9 : ratio <= 1 ? 0.7 : ratio <= 1.2 ? 0.5 : 0.3;

    evidence.push(
      `Payable price is ${Math.round(ratio * 100)}% of the candidate set's median price`,
    );

    return { score, evidence };
  },
};

/* ------------------------------------------------------------------ */
/* The evaluator                                                        */
/* ------------------------------------------------------------------ */

/** Every footwear component, in weight order. */
export const SHOE_COMPONENTS: ComponentDefinition[] = [
  fitComponent,
  comfortComponent,
  cushioningComponent,
  gripComponent,
  materialComponent,
  durabilityComponent,
  weightComponent,
  styleComponent,
  valueComponent,
];

/**
 * The intended use a product's own text implies.
 *
 * Exposed so the decision engine can explain *why* a shoe was judged on
 * the dimensions it was judged on.
 */
export function intendedUseOf(input: ScoreInput): ShoeType | null {
  const text = [
    String(spec(input, 'intendedUse') ?? ''),
    String(spec(input, 'activity') ?? ''),
    String(spec(input, 'surface') ?? ''),
    String(spec(input, 'shoeType') ?? ''),
    String(spec(input, 'subType') ?? ''),
  ].join(' ');

  return detectShoeType(text);
}

/**
 * The description of a shoe type, for the explanation.
 */
export function describeShoeType(type: ShoeType | null): string {
  if (!type) return 'General-purpose footwear';
  return SHOE_TYPES[type].label;
}
