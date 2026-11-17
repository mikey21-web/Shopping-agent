/**
 * Evidence construction.
 *
 * This turns the raw material SahiPick already has — catalogue
 * specifications, research facts gathered from the open web, price engine
 * output, price history and review intelligence — into *classified* evidence.
 *
 * The classification is the whole point. A specification from the
 * manufacturer's own spec table is a `manufacturer_claim`; the same number
 * read from a spec aggregator is a `manufacturer_claim` too, but with lower
 * confidence because nobody checked the original. A price computed by the
 * paise engine from a live retailer page is an `objective_fact`. A recurring
 * complaint across twenty independent reviews is a `customer_experience`.
 *
 * Nothing here creates a fact. Every piece of evidence points at something
 * that was actually retrieved or actually computed.
 */

import type {
  PriceBreakdown,
  Product,
  ReviewIntelligence,
} from '../../domain/types.ts';
import { freshnessOf } from '../../research/store.ts';
import type { ResearchFact } from '../../research/types.ts';
import { formatPaise } from '../normalize/specs.ts';
import type {
  DecisionEvidence,
  EvidenceClass,
  IntelligenceDimensionId,
} from './types.ts';

export interface EvidenceInput {
  product: Product;
  /** Verified research facts for this product. */
  facts: ResearchFact[];
  /** The price breakdown for the best listing, when known. */
  breakdown: PriceBreakdown | null;
  /** Review intelligence, when any. */
  reviews: ReviewIntelligence | null;
  /** Price history statistics. */
  priceHistory: {
    observations: number;
    avgPaise: number;
    minPaise: number;
    maxPaise: number;
    latestPaise: number;
    discountVsAvg: number;
  } | null;
  /** Whether the price came from the bundled sample catalogue. */
  priceIsSample: boolean;
  /** The retailer's name, when known. */
  retailer: string | null;
}

let counter = 0;

/** A stable-enough unique id for an evidence record. */
function evidenceId(productId: string, dimension: string, key: string): string {
  counter += 1;
  return `${productId}:${dimension}:${key}:${counter}`;
}

/** Build one evidence record. */
function evidence(
  dimension: IntelligenceDimensionId,
  evidenceClass: EvidenceClass,
  statement: string,
  source: {
    domain: string | null;
    url: string | null;
    label: string;
    origin: 'catalogue' | 'research' | 'derived' | 'review_analysis' | 'price_engine';
  },
  options: {
    value?: string | number | boolean | null;
    observedAt?: string | null;
    freshness?: DecisionEvidence['freshness'];
    confidence?: number;
    corroborated?: boolean;
    disputed?: boolean;
    excerpt?: string | null;
    productId: string;
    key: string;
  },
): DecisionEvidence {
  return {
    id: evidenceId(options.productId, dimension, options.key),
    dimension,
    class: evidenceClass,
    statement,
    value: options.value ?? null,
    source,
    observedAt: options.observedAt ?? null,
    freshness: options.freshness ?? 'unknown',
    confidence: options.confidence ?? 0.5,
    corroborated: options.corroborated ?? false,
    disputed: options.disputed ?? false,
    excerpt: options.excerpt ?? null,
  };
}

/**
 * Which evidence class does a research fact represent?
 *
 * A fact retrieved from a retailer or the manufacturer is a claim by that
 * party. A fact retrieved from a review or testing site is an independent
 * observation. A fact retrieved from a community site is an experience.
 */
export function classifyFact(fact: ResearchFact): EvidenceClass {
  const domain = fact.sourceDomain.toLowerCase();

  const manufacturerDomains = [
    'samsung.com',
    'apple.com',
    'oneplus.com',
    'mi.com',
    'vivo.com',
    'oppo.com',
    'realme.com',
    'lenovo.com',
    'dell.com',
    'hp.com',
    'asus.com',
    'lg.com',
    'sony.com',
    'panasonic.com',
    'whirlpool.in',
    'bosch-home.in',
    'havells.com',
    'godrej.com',
    'ifbcare.com',
    'bajaj.com',
    'voltas.com',
  ];
  const reviewDomains = [
    'smartprix.com',
    '91mobiles.com',
    'gadget360.com',
    'digit.in',
    'rtings.com',
    'notebookcheck.net',
    'gsmarena.com',
    'techradar.com',
    'indiatoday.in',
  ];
  const communityDomains = ['reddit.com', 'quora.com', '4chan.com', 'youtube.com', 'medium.com'];

  if (manufacturerDomains.some((entry) => domain.includes(entry))) return 'manufacturer_claim';
  if (reviewDomains.some((entry) => domain.includes(entry))) return 'independent_test';
  if (communityDomains.some((entry) => domain.includes(entry))) return 'customer_experience';

  // Retailer pages are authoritative for price and stock, and are the
  // merchant's own statements about their own product.
  if (fact.kind === 'price' || fact.kind === 'stock' || fact.kind === 'offer') {
    return 'objective_fact';
  }

  return 'manufacturer_claim';
}

/**
 * Build the full evidence set for a candidate.
 */
export function buildEvidence(input: EvidenceInput): DecisionEvidence[] {
  const { product, facts, breakdown, reviews, priceHistory } = input;
  const out: DecisionEvidence[] = [];

  /* ---------------- Product intelligence ---------------- */
  const specs = product.specs;
  const specStatements: [string, string | number | boolean | undefined][] = [
    ['processor', specs.soc],
    ['RAM', specs.ramGb ? `${specs.ramGb} GB` : undefined],
    ['storage', specs.storageGb ? `${specs.storageGb} GB${specs.storageType ? ` ${specs.storageType}` : ''}` : undefined],
    ['display', specs.displaySizeIn ? `${specs.displaySizeIn} inch${specs.displayPanel ? ` ${specs.displayPanel}` : ''}` : undefined],
    ['refresh rate', specs.refreshHz ? `${specs.refreshHz} Hz` : undefined],
    ['battery', specs.batteryMah ? `${specs.batteryMah} mAh` : undefined],
    ['camera', specs.cameraMainMp ? `${specs.cameraMainMp} MP` : undefined],
    ['operating system', specs.os],
    ['network', specs.network],
  ];

  for (const [label, value] of specStatements) {
    if (value === undefined || value === null || value === '') continue;
    out.push(
      evidence(
        'product',
        'objective_fact',
        `${label}: ${value}`,
        {
          domain: null,
          url: null,
          label: 'Published specification',
          origin: 'catalogue',
        },
        {
          productId: product.id,
          key: `spec-${label}`,
          value: String(value),
          confidence: 0.75,
          excerpt: `${label}: ${value}`,
        },
      ),
    );
  }

  for (const [key, value] of Object.entries(specs.extra)) {
    if (value === null || value === undefined || value === '') continue;
    out.push(
      evidence(
        'product',
        'objective_fact',
        `${key}: ${String(value)}`,
        { domain: null, url: null, label: 'Published specification', origin: 'catalogue' },
        {
          productId: product.id,
          key: `extra-${key}`,
          value: String(value),
          confidence: 0.7,
          excerpt: `${key}: ${String(value)}`,
        },
      ),
    );
  }

  /* ---------------- Research facts ---------------- */
  for (const fact of facts) {
    const evidenceClass = classifyFact(fact);
    const dimension = dimensionForFactKind(fact.kind);
    const freshness = freshnessOf(fact);

    out.push(
      evidence(
        dimension,
        evidenceClass,
        fact.kind === 'price'
          ? `Price ${formatPaise(typeof fact.value === 'number' ? fact.value : null)}`
          : `${humanise(fact.key)}: ${String(fact.value ?? 'unknown')}`,
        {
          domain: fact.sourceDomain,
          url: fact.sourceUrl,
          label: fact.sourceDomain,
          origin: 'research',
        },
        {
          productId: product.id,
          key: `${fact.kind}-${fact.key}`,
          value: fact.value,
          observedAt: fact.retrievedAt,
          freshness,
          confidence: fact.confidence,
          corroborated: fact.corroboratingSources >= 2,
          disputed: fact.verification === 'conflicting',
          excerpt: fact.evidence?.excerpt ?? null,
        },
      ),
    );
  }

  /* ---------------- Financial intelligence ---------------- */
  if (breakdown) {
    out.push(
      evidence(
        'financial',
        'objective_fact',
        `Payable price ${formatPaise(breakdown.payablePaise)} after ${formatPaise(breakdown.guaranteedDiscountPaise)} of guaranteed discount`,
        {
          domain: null,
          url: null,
          label: 'Price engine',
          origin: 'price_engine',
        },
        {
          productId: product.id,
          key: 'payable',
          value: breakdown.payablePaise,
          confidence: input.priceIsSample ? 0.4 : 0.92,
          excerpt: `Payable ${formatPaise(breakdown.payablePaise)}`,
        },
      ),
    );

    if (breakdown.conditionalDiscountPaise > 0) {
      out.push(
        evidence(
          'financial',
          'objective_fact',
          `A further ${formatPaise(breakdown.conditionalDiscountPaise)} is available only if the eligible bank or card offer applies`,
          { domain: null, url: null, label: 'Price engine', origin: 'price_engine' },
          {
            productId: product.id,
            key: 'conditional',
            value: breakdown.conditionalDiscountPaise,
            confidence: 0.85,
          },
        ),
      );
    }

    if (breakdown.emi) {
      out.push(
        evidence(
          'financial',
          'objective_fact',
          `EMI available: ${formatPaise(breakdown.emi.monthlyPaise)} per month for ${breakdown.emi.months} months at ${breakdown.emi.interestRatePercent}%`,
          { domain: null, url: null, label: 'Price engine', origin: 'price_engine' },
          {
            productId: product.id,
            key: 'emi',
            value: breakdown.emi.monthlyPaise,
            confidence: 0.9,
          },
        ),
      );
    }

    if (!breakdown.applied.some((offer) => offer.certainty === 'guaranteed')) {
      out.push(
        evidence(
          'financial',
          'objective_fact',
          'No discount applies automatically — the listed price is the payable price',
          { domain: null, url: null, label: 'Price engine', origin: 'price_engine' },
          { productId: product.id, key: 'no-guaranteed-discount', value: true, confidence: 0.9 },
        ),
      );
    }
  }

  /* ---------------- Ownership intelligence ---------------- */
  if (reviews) {
    for (const complaint of reviews.complaints.slice(0, 4)) {
      out.push(
        evidence(
          'ownership',
          'customer_experience',
          `Owners frequently report: ${complaint}`,
          { domain: null, url: null, label: `${reviews.reviewCount} owner reviews`, origin: 'review_analysis' },
          {
            productId: product.id,
            key: `complaint-${complaint.slice(0, 24)}`,
            confidence: Math.min(0.75, 0.3 + reviews.negativeShare * 0.4),
            excerpt: complaint,
          },
        ),
      );
    }

    for (const positive of reviews.positives.slice(0, 3)) {
      out.push(
        evidence(
          'ownership',
          'customer_experience',
          `Owners frequently praise: ${positive}`,
          { domain: null, url: null, label: `${reviews.reviewCount} owner reviews`, origin: 'review_analysis' },
          {
            productId: product.id,
            key: `praise-${positive.slice(0, 24)}`,
            confidence: Math.min(0.75, 0.35 + (1 - reviews.negativeShare) * 0.35),
            excerpt: positive,
          },
        ),
      );
    }

    for (const concern of reviews.longTermConcerns.slice(0, 3)) {
      out.push(
        evidence(
          'ownership',
          'customer_experience',
          `Reported mainly by longer-term owners: ${concern}`,
          { domain: null, url: null, label: `${reviews.reviewCount} owner reviews`, origin: 'review_analysis' },
          {
            productId: product.id,
            key: `longterm-${concern.slice(0, 24)}`,
            confidence: 0.55,
            excerpt: concern,
          },
        ),
      );
    }

    if (reviews.verifiedRatio < 0.5 && reviews.reviewCount >= 20) {
      out.push(
        evidence(
          'risk',
          'customer_experience',
          `Only ${Math.round(reviews.verifiedRatio * 100)}% of the reviews are marked as verified purchases`,
          { domain: null, url: null, label: 'Review analysis', origin: 'review_analysis' },
          { productId: product.id, key: 'low-verified-ratio', value: reviews.verifiedRatio, confidence: 0.8 },
        ),
      );
    }
  }

  if (specs.warrantyMonths !== undefined) {
    out.push(
      evidence(
        'ownership',
        'objective_fact',
        `Manufacturer warranty: ${specs.warrantyMonths} months`,
        { domain: null, url: null, label: 'Published specification', origin: 'catalogue' },
        {
          productId: product.id,
          key: 'warranty',
          value: specs.warrantyMonths,
          confidence: 0.8,
          excerpt: `Warranty: ${specs.warrantyMonths} months`,
        },
      ),
    );
  }

  /* ---------------- Market intelligence ---------------- */
  if (priceHistory && priceHistory.observations >= 3) {
    out.push(
      evidence(
        'market',
        'market_observation',
        `Price has been observed ${priceHistory.observations} times, averaging ${formatPaise(priceHistory.avgPaise)} against a current ${formatPaise(priceHistory.latestPaise)}`,
        { domain: null, url: null, label: 'Price history', origin: 'derived' },
        {
          productId: product.id,
          key: 'price-history',
          value: priceHistory.discountVsAvg,
          confidence: 0.7,
        },
      ),
    );
  }

  return out;
}

/** Which dimension does a research fact kind support? */
export function dimensionForFactKind(kind: string): IntelligenceDimensionId {
  switch (kind) {
    case 'price':
    case 'offer':
    case 'delivery':
      return 'financial';
    case 'stock':
      return 'market';
    case 'warranty':
      return 'ownership';
    case 'compatibility':
      return 'compatibility';
    case 'certification':
    case 'ingredients':
    case 'nutrition':
      return 'risk';
    case 'review_theme':
    case 'review_complaint':
    case 'review_praise':
    case 'owner_experience':
      return 'ownership';
    case 'model_identification':
    case 'variant_identification':
      return 'product';
    default:
      return 'product';
  }
}

/** Turn a fact key into a readable label. */
function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
