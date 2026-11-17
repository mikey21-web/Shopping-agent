/**
 * Review intelligence.
 *
 * Turns raw customer reviews into structured, evidence-backed signals:
 * recurring complaints, recurring praise, long-term ownership concerns and
 * cautious authenticity warnings.
 *
 * Two hard rules from the product brief are enforced here:
 *  1. Nothing is invented. If a product has no reviews, the result says so.
 *  2. A review is never declared "fake". We report *patterns* with the
 *     evidence that produced them and an explicit caveat.
 */

import type {
  AspectSummary,
  Provenance,
  Review,
  ReviewAspect,
  ReviewEvidence,
  ReviewIntelligence,
  ReviewLanguage,
  ReviewSignal,
} from '../../domain/types.ts';
import {
  ASPECT_LEXICON,
  INCENTIVE_PHRASES,
  LONG_TERM_MARKERS,
  SHORT_TERM_MARKERS,
  type AspectPhrase,
} from './lexicon.ts';
import { jaccard, tokenize } from '../matching/text-similarity.ts';
import { analyseOwnership, type ReviewSource } from './ownership.ts';

const DEVANAGARI = /[\u0900-\u097F]/g;
const HINGLISH_MARKERS = [
  'hai',
  'nahi',
  'nahin',
  'kya',
  'koi',
  'bahut',
  'acha',
  'accha',
  'acche',
  'bura',
  'sasta',
  'masta',
  'mast',
  'kharab',
  'bakwas',
  'paisa',
  'waala',
  'wala',
  'ka',
  'ki',
  'ke',
  'mein',
  'mere',
  'mera',
  'apna',
  'phir',
  'bhi',
  'hi',
  'to',
  'aur',
  'sab',
  'bahut',
  'jaldi',
  'abhi',
  'waqt',
  'time',
  'dono',
  'bhi',
];

export function detectLanguage(text: string): ReviewLanguage {
  if (!text) return 'other';
  DEVANAGARI.lastIndex = 0;
  const devanagari = (text.match(DEVANAGARI) ?? []).length;
  const letters = text.replace(/\s/g, '').length || 1;
  const devanagariRatio = devanagari / letters;

  if (devanagariRatio > 0.25) return 'hi';

  const words = tokenize(text);
  if (words.length === 0) return 'other';
  const markerHits = words.filter((word) => HINGLISH_MARKERS.includes(word)).length;
  const markerRatio = markerHits / words.length;

  // A meaningful share of code-mixed markers indicates Hinglish.
  if (markerRatio > 0.06 && words.length >= 6) return 'hinglish';
  return 'en';
}

export interface AspectMention {
  aspect: ReviewAspect;
  sentiment: -1 | 0 | 1;
  phrase: string;
  strength: number;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word boundaries only work for latin phrases; Devanagari needs a plain match.
  if (/[\u0900-\u097F]/.test(phrase)) return haystack.includes(phrase);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack);
}

/** Find every aspect mentioned in a review body. */
export function extractAspects(body: string): AspectMention[] {
  const haystack = ` ${body.toLowerCase().replace(/\s+/g, ' ')} `;
  const mentions: AspectMention[] = [];

  for (const entry of ASPECT_LEXICON) {
    for (const group of [entry.negative, entry.positive] as AspectPhrase[][]) {
      for (const candidate of group) {
        if (containsPhrase(haystack, candidate.phrase)) {
          mentions.push({
            aspect: entry.aspect,
            sentiment: candidate.polarity,
            phrase: candidate.phrase,
            strength: candidate.strength,
          });
        }
      }
    }
  }
  return mentions;
}

function normaliseBody(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Authenticity signals                                                */
/* ------------------------------------------------------------------ */

/** Detect near-duplicate review content. */
function detectDuplicates(reviews: Review[]): ReviewSignal | null {
  const normalised = reviews.map((review) => ({ review, body: normaliseBody(review.body) }));
  const groups = new Map<string, { review: Review; others: Review[] }>();

  for (let i = 0; i < normalised.length; i += 1) {
    const entry = normalised[i];
    if (!entry) continue;
    let matched = false;
    for (const [key, group] of groups) {
      if (entry.body && jaccard(key, entry.body) >= 0.85) {
        group.others.push(entry.review);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(entry.body, { review: entry.review, others: [] });
    }
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.others.length > 0);
  if (duplicateGroups.length === 0) return null;

  const affected = duplicateGroups.reduce((sum, group) => sum + group.others.length + 1, 0);
  const severity = Math.min(1, affected / Math.max(10, reviews.length));

  return {
    kind: 'duplicate_content',
    score: Number(severity.toFixed(2)),
    explanation: `${affected} review${affected === 1 ? '' : 's'} across ${duplicateGroups.length} group${duplicateGroups.length === 1 ? '' : 's'} use near-identical wording.`,
    affectedReviews: affected,
    evidenceReviewIds: duplicateGroups.flatMap((group) => [group.review.id, ...group.others.map((r) => r.id)]).slice(0, 12),
  };
}

/** Detect a burst of reviews concentrated on a single day. */
function detectBurst(reviews: Review[]): ReviewSignal | null {
  const dated = reviews.filter((review) => review.reviewedAt);
  if (dated.length < 10) return null;

  const byDay = new Map<string, Review[]>();
  for (const review of dated) {
    const day = review.reviewedAt!.slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(review);
    byDay.set(day, bucket);
  }

  const busiest = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!busiest) return null;
  const [day, dayReviews] = busiest;
  const share = dayReviews.length / dated.length;
  if (dayReviews.length < 5 || share < 0.15) return null;

  return {
    kind: 'burst_pattern',
    score: Number(Math.min(1, share).toFixed(2)),
    explanation: `${dayReviews.length} of ${dated.length} dated reviews (${Math.round(share * 100)}%) were posted on ${day}.`,
    affectedReviews: dayReviews.length,
    evidenceReviewIds: dayReviews.map((review) => review.id).slice(0, 12),
  };
}

/** Detect heavily reused phrasing across reviews. */
function detectRepetitiveLanguage(reviews: Review[]): ReviewSignal | null {
  if (reviews.length < 8) return null;
  const grams = new Map<string, number>();
  let total = 0;
  for (const review of reviews) {
    const words = tokenize(normaliseBody(review.body));
    for (let i = 0; i + 4 <= words.length; i += 1) {
      const gram = words.slice(i, i + 4).join(' ');
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return null;

  let repeated = 0;
  const offenders: { gram: string; count: number }[] = [];
  for (const [gram, count] of grams) {
    if (count >= 3) {
      repeated += count - 1;
      offenders.push({ gram, count });
    }
  }

  const ratio = repeated / total;
  if (ratio < 0.02 || offenders.length === 0) return null;

  offenders.sort((a, b) => b.count - a.count);
  return {
    kind: 'repetitive_language',
    score: Number(Math.min(1, ratio * 10).toFixed(2)),
    explanation: `${offenders.length} phrase${offenders.length === 1 ? '' : 's'} of four or more words recur across reviews (most reused: "${offenders[0]?.gram}" × ${offenders[0]?.count}).`,
    affectedReviews: offenders.length,
    evidenceReviewIds: [],
  };
}

/** Detect an implausibly favourable rating distribution. */
function detectRatingDistribution(reviews: Review[]): ReviewSignal | null {
  if (reviews.length < 10) return null;
  const buckets = [0, 0, 0, 0, 0];
  for (const review of reviews) {
    const index = Math.min(4, Math.max(0, Math.round(review.rating) - 1));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  const total = reviews.length;
  const fiveStarShare = (buckets[4] ?? 0) / total;
  const oneTwoStarShare = ((buckets[0] ?? 0) + (buckets[1] ?? 0)) / total;
  const midShare = ((buckets[2] ?? 0) + (buckets[3] ?? 0)) / total;

  // A genuine product catalogue almost always has some mid-range ratings.
  if (fiveStarShare > 0.85 && midShare < 0.05 && oneTwoStarShare < 0.05) {
    return {
      kind: 'rating_distribution',
      score: Number(Math.min(1, (fiveStarShare - 0.85) * 5).toFixed(2)),
      explanation: `${Math.round(fiveStarShare * 100)}% of reviews are 5-star with almost no 3-star or 4-star ratings, which is unusual for a real product.`,
      affectedReviews: total,
      evidenceReviewIds: [],
    };
  }
  return null;
}

/** Detect a low share of verified purchases. */
function detectVerifiedRatio(reviews: Review[]): ReviewSignal | null {
  const withFlag = reviews.filter((review) => review.verifiedPurchase !== null);
  if (withFlag.length < 5) return null;
  const verified = withFlag.filter((review) => review.verifiedPurchase === true).length;
  const ratio = verified / withFlag.length;
  if (ratio >= 0.5) return null;

  return {
    kind: 'low_verified_ratio',
    score: Number((0.5 - ratio).toFixed(2)),
    explanation: `Only ${Math.round(ratio * 100)}% of ${withFlag.length} reviews carrying a verification flag are marked as verified purchases.`,
    affectedReviews: withFlag.length - verified,
    evidenceReviewIds: [],
  };
}

/** Detect campaign / incentivised review language. */
function detectIncentiveLanguage(reviews: Review[]): ReviewSignal | null {
  if (reviews.length < 5) return null;
  const hits = reviews.filter((review) => {
    const body = review.body.toLowerCase();
    return INCENTIVE_PHRASES.some((phrase) => body.includes(phrase));
  });
  if (hits.length === 0) return null;
  const ratio = hits.length / reviews.length;
  if (ratio < 0.05) return null;

  return {
    kind: 'incentive_language',
    score: Number(Math.min(1, ratio).toFixed(2)),
    explanation: `${hits.length} review${hits.length === 1 ? '' : 's'} use promotional phrasing typical of campaign-driven reviews.`,
    affectedReviews: hits.length,
    evidenceReviewIds: hits.map((review) => review.id).slice(0, 12),
  };
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export interface ReviewAnalysisOptions {
  /** Maximum evidence items kept per aspect. */
  maxEvidencePerAspect?: number;
  /** Minimum occurrences for a phrase to count as "recurring". */
  recurrenceThreshold?: number;
}

export function analyzeReviews(
  reviews: Review[],
  options: ReviewAnalysisOptions = {},
): ReviewIntelligence {
  const maxEvidence = options.maxEvidencePerAspect ?? 6;
  const recurrenceThreshold = options.recurrenceThreshold ?? 2;

  const provenance: Provenance = {
    origin: reviews.length > 0 ? 'live' : 'unknown',
    source: 'reviews',
    observedAt: new Date().toISOString(),
    confidence: reviews.length === 0 ? 0 : Math.min(1, 0.4 + reviews.length / 50),
    note: reviews.length === 0 ? 'No reviews are available for this product yet.' : null,
  };

  if (reviews.length === 0) {
    return {
      productId: '',
      listingId: null,
      reviewCount: 0,
      verifiedRatio: 0,
      averageRating: 0,
      negativeShare: 0,
      authenticityRisk: 0,
      authenticityCaveat:
        'No reviews were available, so no authenticity assessment could be made.',
      signals: [],
      aspects: [],
      positives: [],
      complaints: [],
      longTermConcerns: [],
      languageBreakdown: {},
      provenance,
    };
  }

  const languageBreakdown: Record<string, number> = {};
  const aspectBuckets = new Map<ReviewAspect, AspectMention[]>();
  const perReview = new Map<string, AspectMention[]>();
  const phraseCounts = new Map<
    string,
    { phrase: string; count: number; sentiment: -1 | 0 | 1; strength: number; reviewIds: string[] }
  >();

  for (const review of reviews) {
    languageBreakdown[review.language] = (languageBreakdown[review.language] ?? 0) + 1;
    const mentions = extractAspects(`${review.title ?? ''} ${review.body}`);
    perReview.set(review.id, mentions);

    for (const mention of mentions) {
      const bucket = aspectBuckets.get(mention.aspect) ?? [];
      bucket.push(mention);
      aspectBuckets.set(mention.aspect, bucket);

      const key = `${mention.aspect}::${mention.phrase}::${mention.sentiment}`;
      const entry = phraseCounts.get(key) ?? {
        phrase: mention.phrase,
        count: 0,
        sentiment: mention.sentiment,
        strength: mention.strength,
        reviewIds: [],
      };
      entry.count += 1;
      entry.strength = Math.max(entry.strength, mention.strength);
      entry.reviewIds.push(review.id);
      phraseCounts.set(key, entry);
    }
  }

  const aspects: AspectSummary[] = [];
  for (const [aspect, mentions] of aspectBuckets) {
    let positive = 0;
    let negative = 0;
    let weighted = 0;
    let totalStrength = 0;
    const evidence: ReviewEvidence[] = [];

    for (const mention of mentions) {
      const weight = mention.strength;
      totalStrength += weight;
      if (mention.sentiment > 0) positive += weight;
      else negative += weight;
      weighted += mention.sentiment * weight;
    }

    const aspectPhrases = [...phraseCounts.entries()].filter(([key]) => key.startsWith(`${aspect}::`));
    const topComplaints = aspectPhrases
      .filter(([, value]) => value.sentiment === -1)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([, value]) => value);
    const topPraises = aspectPhrases
      .filter(([, value]) => value.sentiment === 1)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([, value]) => value);

    // Attach evidence quotes for this aspect.
    for (const review of reviews) {
      const mentionsForReview = perReview.get(review.id) ?? [];
      const relevant = mentionsForReview.filter((mention) => mention.aspect === aspect);
      if (relevant.length === 0) continue;
      const sentiment: -1 | 0 | 1 = relevant.some((m) => m.sentiment === -1)
        ? -1
        : relevant.some((m) => m.sentiment === 1)
          ? 1
          : 0;
      const snippet = review.body.length > 180 ? `${review.body.slice(0, 180)}…` : review.body;
      evidence.push({
        reviewId: review.id,
        quote: snippet,
        rating: review.rating,
        reviewedAt: review.reviewedAt ?? null,
        verifiedPurchase: review.verifiedPurchase,
        language: review.language,
        aspect,
        sentiment,
      });
      if (evidence.length >= maxEvidence * 3) break;
    }

    aspects.push({
      aspect,
      negativeRate: totalStrength > 0 ? negative / totalStrength : 0,
      positiveRate: totalStrength > 0 ? positive / totalStrength : 0,
      mentionCount: mentions.length,
      sentiment: totalStrength > 0 ? Number((weighted / totalStrength).toFixed(3)) : 0,
      topComplaints: topComplaints.map((entry) => entry.phrase ?? ''),
      topPraises: topPraises.map((entry) => entry.phrase ?? ''),
      evidence: evidence.slice(0, maxEvidence),
    });
  }

  aspects.sort((a, b) => b.mentionCount - a.mentionCount);

  // Recurring complaints / praise: a phrase must appear in >= threshold reviews.
  const complaints: string[] = [];
  const positives: string[] = [];
  for (const [, entry] of phraseCounts) {
    if (entry.count < recurrenceThreshold) continue;
    if (entry.sentiment === -1) complaints.push(entry.phrase);
    else positives.push(entry.phrase);
  }

  // Long-term concerns: complaints that appear in older reviews or reviews
  // that explicitly describe long-term ownership.
  const longTermConcerns: string[] = [];
  const sortedByDate = [...reviews].sort(
    (a, b) => new Date(a.reviewedAt ?? 0).getTime() - new Date(b.reviewedAt ?? 0).getTime(),
  );
  const medianIndex = Math.floor(sortedByDate.length / 2);
  for (const complaint of complaints) {
    const matching = reviews.filter((review) =>
      extractAspects(review.body).some(
        (mention) => mention.sentiment === -1 && mention.phrase === complaint,
      ),
    );
    if (matching.length === 0) continue;
    const olderCount = matching.filter(
      (review) => sortedByDate.findIndex((r) => r.id === review.id) >= medianIndex,
    ).length;
    const mentionsLongTerm = matching.some((review) => {
      const body = review.body.toLowerCase();
      return LONG_TERM_MARKERS.some((marker) => body.includes(marker));
    });
    if (mentionsLongTerm || (olderCount >= matching.length / 2 && matching.length >= 2)) {
      longTermConcerns.push(complaint);
    }
  }

  const signals: ReviewSignal[] = [];
  const duplicates = detectDuplicates(reviews);
  if (duplicates) signals.push(duplicates);
  const burst = detectBurst(reviews);
  if (burst) signals.push(burst);
  const repetitive = detectRepetitiveLanguage(reviews);
  if (repetitive) signals.push(repetitive);
  const distribution = detectRatingDistribution(reviews);
  if (distribution) signals.push(distribution);
  const incentive = detectIncentiveLanguage(reviews);
  if (incentive) signals.push(incentive);
  const verified = detectVerifiedRatio(reviews);
  if (verified) signals.push(verified);

  // Weighted risk. Individual signals never dominate on their own.
  const signalWeights: Record<ReviewSignal['kind'], number> = {
    duplicate_content: 0.3,
    burst_pattern: 0.15,
    repetitive_language: 0.15,
    rating_distribution: 0.12,
    low_verified_ratio: 0.08,
    incentive_language: 0.1,
    extreme_burst: 0.1,
    new_account_volume: 0.1,
  };
  const authenticityRisk = Math.min(
    1,
    signals.reduce((sum, signal) => sum + signal.score * (signalWeights[signal.kind] ?? 0.1), 0),
  );

  const withFlag = reviews.filter((review) => review.verifiedPurchase !== null);
  const verifiedRatio =
    withFlag.length > 0
      ? withFlag.filter((review) => review.verifiedPurchase === true).length / withFlag.length
      : 0;

  const averageRating = Number(
    (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(2),
  );
  const negativeShare = reviews.filter((review) => review.rating <= 2).length / reviews.length;

  return {
    productId: reviews[0]?.productId ?? '',
    listingId: reviews[0]?.listingId ?? null,
    reviewCount: reviews.length,
    verifiedRatio: Number(verifiedRatio.toFixed(2)),
    averageRating,
    negativeShare: Number(negativeShare.toFixed(2)),
    authenticityRisk: Number(authenticityRisk.toFixed(2)),
    authenticityCaveat:
      'These are statistical signals about review patterns, not proof that any review is fake. Treat them as a reason to weight verified, detailed reviews more heavily.',
    signals,
    aspects,
    positives: positives.slice(0, 8),
    complaints: complaints.slice(0, 10),
    longTermConcerns: longTermConcerns.slice(0, 6),
    languageBreakdown,
    provenance,
  };
}

/**
 * The domain a review came from.
 *
 * The provenance records a URL when there is one and a retailer id
 * otherwise, so the domain is derived from whichever is present.
 */
function domainOf(url: string | null, fallback: string): string {
  if (url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      /* fall through to the retailer id */
    }
  }
  return fallback.toLowerCase().replace(/^www\./, '');
}

/**
 * Add the ownership analysis to a review intelligence record.
 *
 * The phrase-based analysis finds what owners *say*. The ownership
 * analysis finds what owners *report repeatedly*, removes the copies
 * that retailers syndicate between listings, and reports the count of
 * independent sources rather than a phrase that happened to repeat.
 *
 * Both are kept: the phrases are what the shopper reads, and the
 * clusters are what the decision engine weights.
 */
export function withOwnership(
  intelligence: ReviewIntelligence,
  reviews: Review[],
  options: { variantOf?: (review: Review) => string | null } = {},
): ReviewIntelligence {
  const sources = new Map<string, ReviewSource>();
  for (const review of reviews) {
    sources.set(review.id, {
      domain: domainOf(review.provenance.url ?? null, review.provenance.source),
      site: review.provenance.source ?? null,
    });
  }

  const ownership = analyseOwnership(intelligence.productId, reviews, sources, options);

  // The clustered complaints are stated in plain language, which is what
  // the shopper reads. The phrase list stays as the raw signal.
  const clusteredComplaints = ownership.complaints
    .filter((cluster) => !cluster.syndicatedOnly)
    .map(
      (cluster) =>
        `${cluster.label} (reported by ${cluster.independentSources} independent source${cluster.independentSources === 1 ? '' : 's'})`,
    );

  const clusteredPraise = ownership.praise
    .filter((cluster) => cluster.independentSources > 0)
    .map(
      (cluster) =>
        `${cluster.label} (reported by ${cluster.independentSources} independent source${cluster.independentSources === 1 ? '' : 's'})`,
    );

  const clusteredLongTerm = ownership.longTermConcerns;

  return {
    ...intelligence,
    positives: clusteredPraise.length > 0 ? clusteredPraise : intelligence.positives,
    complaints: clusteredComplaints.length > 0 ? clusteredComplaints : intelligence.complaints,
    longTermConcerns:
      clusteredLongTerm.length > 0 ? clusteredLongTerm : intelligence.longTermConcerns,
  };
}

/** Recover the human-readable phrase from a phrase-count entry. */
export function entryPhrase(entry: { phrase: string }): string {
  return entry.phrase;
}
