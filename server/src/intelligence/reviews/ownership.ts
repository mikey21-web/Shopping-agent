/**
 * Ownership and review intelligence.
 *
 * This is the layer that turns a pile of reviews into something a
 * decision can be made on. It does four things that summarising star
 * ratings does not:
 *
 *  1. **Clusters complaints.** One person saying "the sole came off" is
 *     an anecdote. Twelve independent owners saying the same thing about
 *     the same model is a pattern. The cluster reports the *count of
 *     distinct sources*, never a made-up failure rate.
 *  2. **Detects syndication.** Retailers copy reviews between listings and
 *     between sites. Counted naively, one syndicated paragraph written by
 *     a marketer becomes twenty independent owners agreeing. Reviews that
 *     share near-identical wording *across different domains* are
 *     collapsed and flagged.
 *  3. **Tracks the variant and the date.** A complaint about the 2023
 *     model does not apply to the 2024 model. Every finding carries the
 *     variant it was observed on.
 *  4. **Separates experience from specification.** "Feels great" is an
 *     experience. "The midsole is EVA" is a specification. The decision
 *     engine weights them differently.
 *
 * Nothing here invents a failure rate. If there is one complaint, the
 * output says one complaint.
 */

import type { Review } from '../../domain/types.ts';
import { fuzzySimilarity } from '../matching/text-similarity.ts';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

/** Where a review came from, for independence checks. */
export interface ReviewSource {
  /** The domain the review was read from. */
  domain: string;
  /** The retailer or site name, when known. */
  site: string | null;
}

/** A cluster of complaints that say the same thing. */
export interface ComplaintCluster {
  /** A stable id for the cluster. */
  id: string;
  /** The complaint in plain language. */
  label: string;
  /** How many reviews mention it. */
  mentions: number;
  /** How many *independent* sources mention it. */
  independentSources: number;
  /** The review ids. */
  reviewIds: string[];
  /** The source domains. */
  domains: string[];
  /** The variants the complaint was observed on. */
  variants: string[];
  /** The date range of the complaints. */
  firstSeen: string | null;
  lastSeen: string | null;
  /** True when the complaint appears only in syndicated content. */
  syndicatedOnly: boolean;
  /** The excerpts, for the decision trace. */
  excerpts: string[];
  /** How serious the complaint is, 0..1. */
  severity: number;
  /** Which aspects of the product it bears on. */
  aspects: string[];
}

/** A recurring positive observation. */
export interface PraiseCluster {
  id: string;
  label: string;
  mentions: number;
  independentSources: number;
  reviewIds: string[];
  variants: string[];
  excerpts: string[];
  aspects: string[];
}

/** A review that duplicates content from another source. */
export interface SyndicatedReview {
  reviewId: string;
  /** The review this one duplicates. */
  duplicatesReviewId: string;
  /** The domains involved. */
  domains: string[];
  /** How similar the bodies are, 0..1. */
  similarity: number;
  /** The shared wording. */
  sharedExcerpt: string;
}

/** The complete ownership picture for one product. */
export interface OwnershipIntelligence {
  /** The product the analysis covers. */
  productId: string;
  /** The complaints, most severe first. */
  complaints: ComplaintCluster[];
  /** The recurring praise. */
  praise: PraiseCluster[];
  /** Reviews that duplicate content from another source. */
  syndicated: SyndicatedReview[];
  /** The reviews that counted, after syndication removal. */
  independentReviewCount: number;
  /** The reviews that were removed as duplicates. */
  removedReviewCount: number;
  /** The distinct sources that contributed an independent review. */
  independentSourceCount: number;
  /** The variants the reviews covered. */
  variantsCovered: string[];
  /** The date range of the reviews. */
  period: { from: string | null; to: string | null };
  /** The recurring long-term problems. */
  longTermConcerns: string[];
  /** True when there is not enough evidence to say anything. */
  insufficientEvidence: boolean;
  /** Why there is not enough evidence. */
  insufficientReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Complaint taxonomy                                                   */
/* ------------------------------------------------------------------ */

/**
 * The complaint patterns worth watching for.
 *
 * Each pattern has the phrases that indicate it and the aspects it
 * bears on. The patterns are deliberately specific — "runs small" is a
 * complaint, "size" is not.
 */
const COMPLAINT_PATTERNS: {
  key: string;
  label: string;
  severity: number;
  aspects: string[];
  patterns: RegExp[];
}[] = [
  {
    key: 'sole_separation',
    label: 'The sole separated from the upper',
    severity: 0.95,
    aspects: ['durability', 'build_quality'],
    patterns: [
      /sole\s+(?:separat\w*|c(?:ome|ame)\s+(?:off|apart|loose|away)|peel\w*|fell\s+off)/i,
      /outsole\s+(?:separat\w*|c(?:ome|ame)\w*|peel\w*)/i,
      /delaminat\w*/i,
      /fell\s+apart/i,
      /glued\s+(?:badly|poorly|only)/i,
    ],
  },
  {
    key: 'stitching_failure',
    label: 'The stitching or seams failed',
    severity: 0.75,
    aspects: ['build_quality', 'durability'],
    patterns: [
      /stitch\w*\s+(?:came|gave|broke|failed|poor|open)/i,
      /thread\s+came/i,
      /seam\w*\s+(?:came\s+apart|failed|burst|open)/i,
      /poor\s+stitching/i,
      /stitching\s+(?:was|is)\s+(?:poor|bad|sloppy)/i,
    ],
  },
  {
    key: 'runs_small',
    label: 'The size runs small',
    severity: 0.7,
    aspects: ['fit', 'comfort'],
    patterns: [
      /runs?\s+(?:very\s+)?small/i,
      /size\s+is\s+(?:too\s+)?small/i,
      /too\s+(?:small|tight|narrow)/i,
      /half\s+(?:a\s+)?size\s+up/i,
      /one\s+size\s+up/i,
      /tight\s+fit/i,
    ],
  },
  {
    key: 'size_chart_wrong',
    label: 'The published size chart does not match the shoe',
    severity: 0.6,
    aspects: ['fit'],
    patterns: [
      /size\s+chart\s+(?:is\s+)?(?:wrong|incorrect|off|unreliable)/i,
      /size\s+chart\s+(?:does\s?n[o']?t|does\s+not)\s+(?:match|help)/i,
      /sizing\s+(?:is\s+)?(?:awkward|a\s+guess)/i,
    ],
  },
  {
    key: 'runs_large',
    label: 'The size runs large',
    severity: 0.7,
    aspects: ['fit'],
    patterns: [
      /runs?\s+(?:very\s+)?large/i,
      /size\s+is\s+(?:too\s+)?big/i,
      /too\s+(?:big|loose|wide)/i,
      /falls?\s+off/i,
    ],
  },
  {
    key: 'sole_wear',
    label: 'The sole wore out quickly',
    severity: 0.65,
    aspects: ['durability'],
    patterns: [
      /sole\s+wore\s+(?:out|through)/i,
      /wore\s+out\s+(?:in|after|within)\s+(?:a\s+|just\s+|only\s+)?(?:few|weeks?|months?|two|three|six)/i,
      /sole\s+(?:is\s+|was\s+)?(?:worn|torn)/i,
      /tread\s+wore/i,
      /not\s+durable/i,
      /poor\s+quality/i,
    ],
  },
  {
    key: 'heel_collapse',
    label: 'The heel or the collar collapsed',
    severity: 0.7,
    aspects: ['durability', 'comfort'],
    patterns: [
      /heel\s+(?:collas\w+|fell\s+apart|came\s+off|dropped)/i,
      /collar\s+(?:collas\w*|wore)/i,
      /no\s+(?:heel|ankle)\s+support/i,
    ],
  },
  {
    key: 'no_cushioning',
    label: 'The cushioning gave out or was insufficient',
    severity: 0.6,
    aspects: ['comfort', 'performance'],
    patterns: [
      /cushion\w*\s+(?:is\s+)?(?:gone|wore\s+out|dead|flat)/i,
      /no\s+cushioning/i,
      /midsole\s+(?:is\s+)?(?:flat|dead|worn)/i,
      /not\s+(?:comfortable|cushioned)\s+(?:at\s+all|from\s+the\s+start)/i,
      /uncomfortable\s+from\s+day\s+one/i,
    ],
  },
  {
    key: 'slipping',
    label: 'The grip failed',
    severity: 0.7,
    aspects: ['performance', 'safety'],
    patterns: [
      /slip\w*/i,
      /no\s+grip/i,
      /slippery/i,
      /lost\s+traction/i,
    ],
  },
  {
    key: 'breathability',
    label: 'The shoe was not breathable',
    severity: 0.45,
    aspects: ['comfort'],
    patterns: [
      /not\s+breathable/i,
      /(?:feet|foot)\s+(?:get|got|become|became)\s+(?:hot|sweaty|wet)/i,
      /smell\w*/i,
      /odor|odour/i,
      /no\s+ventilation/i,
    ],
  },
  {
    key: 'noise',
    label: 'The shoe made noise',
    severity: 0.3,
    aspects: ['comfort'],
    patterns: [/squeak\w*/i, /squeaking/i, /noisy\s+sole/i, /floppy/i],
  },
  {
    key: 'warranty_ignored',
    label: 'The warranty was not honoured',
    severity: 0.85,
    aspects: ['service'],
    patterns: [
      /warranty\s+(?:claim\w*\s+)?(?:was\s+)?(?:rejected|denied|refused|ignored|useless)/i,
      /no\s+(?:after[- ]sales|after\s+sales)\s+service/i,
      /customer\s+care\s+(?:was\s+)?(?:useless|unhelpful|rude)/i,
      /could\s+not\s+(?:get|find)\s+(?:it\s+)?replaced/i,
    ],
  },
  {
    key: 'defective',
    label: 'The product was defective on arrival',
    severity: 0.9,
    aspects: ['build_quality', 'service'],
    patterns: [
      /defective/i,
      /arrived\s+(?:broken|damaged|with\s+a\s+defect)/i,
      /dead\s+on\s+arrival/i,
      /doa/i,
    ],
  },
  {
    key: 'colour_mismatch',
    label: 'The colour did not match the listing',
    severity: 0.5,
    aspects: ['design'],
    patterns: [
      /colou?r\s+(?:is\s+)?(?:different|not\s+as\s+shown|darker|lighter)/i,
      /not\s+the\s+(?:colou?r|shade)\s+(?:shown|in\s+the\s+picture)/i,
      /looks\s+different/i,
    ],
  },
];

/** The praise patterns worth watching for. */
const PRAISE_PATTERNS: {
  key: string;
  label: string;
  aspects: string[];
  patterns: RegExp[];
}[] = [
  {
    key: 'comfortable',
    label: 'Owners describe the shoe as comfortable',
    aspects: ['comfort'],
    patterns: [
      /very\s+comfortable/i,
      /so\s+comfortable/i,
      /extremely\s+comfortable/i,
      /comfortable\s+for\s+(?:long|all)/i,
      /wearing\s+them\s+(?:all\s+day|for\s+hours)\s+(?:and\s+)?(?:no|my\s+feet\s+(?:were|are)\s+not)\s*(?:pain|sore|tired)/i,
    ],
  },
  {
    key: 'lightweight',
    label: 'Owners describe the shoe as lightweight',
    aspects: ['performance'],
    patterns: [/light\s*weight/i, /very\s+light/i, /feels\s+light/i],
  },
  {
    key: 'good_grip',
    label: 'Owners report good grip',
    aspects: ['performance'],
    patterns: [/great\s+grip/i, /good\s+grip/i, /excellent\s+traction/i, /sturdy\s+on\s+(?:the\s+)?(?:ground|wet)/i],
  },
  {
    key: 'durable',
    label: 'Owners report the shoe holds up well',
    aspects: ['durability', 'build_quality'],
    patterns: [
      /very\s+durable/i,
      /sturdy/i,
      /well\s+made/i,
      /great\s+quality/i,
      /excellent\s+build\s+quality/i,
      /still\s+looks\s+new/i,
      /holds\s+up\s+well/i,
    ],
  },
  {
    key: 'good_value',
    label: 'Owners consider it good value',
    aspects: ['value'],
    patterns: [/value\s+for\s+money/i, /worth\s+the\s+(?:money|price)/i, /great\s+value/i, /good\s+value/i],
  },
  {
    key: 'true_to_size',
    label: 'Owners report the size runs true',
    aspects: ['fit'],
    patterns: [/true\s+to\s+size/i, /fits?\s+(?:perfectly|true)/i, /perfect\s+fit/i],
  },
  {
    key: 'breathable',
    label: 'Owners report the shoe is breathable',
    aspects: ['comfort'],
    patterns: [/very\s+breathable/i, /breathable/i, /keeps\s+(?:my\s+)?feet\s+cool/i],
  },
];

/* ------------------------------------------------------------------ */
/* Syndication detection                                                */
/* ------------------------------------------------------------------ */

/**
 * Detect reviews that are copies of each other.
 *
 * Two reviews are syndicated when their bodies are near-identical *and*
 * they come from different domains — the same retailer copying its own
 * review between listings is a within-domain duplicate, which the
 * existing near-duplicate detection already handles; cross-domain
 * duplication is a syndication network.
 */
export function detectSyndication(
  reviews: Review[],
  sources: Map<string, ReviewSource>,
  threshold = 0.82,
): SyndicatedReview[] {
  const findings: SyndicatedReview[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < reviews.length; i += 1) {
    const left = reviews[i];
    if (!left) continue;

    for (let j = i + 1; j < reviews.length; j += 1) {
      const right = reviews[j];
      if (!right) continue;

      const leftSource = sources.get(left.id);
      const rightSource = sources.get(right.id);
      if (!leftSource || !rightSource) continue;

      // Within the same domain, the existing near-duplicate detection
      // covers it. Cross-domain duplication is the syndication signal.
      if (leftSource.domain === rightSource.domain) continue;

      const key = `${left.id}:${right.id}`;
      if (seen.has(key)) continue;

      const similarity = bodySimilarity(left.body, right.body);
      if (similarity < threshold) continue;

      seen.add(key);
      findings.push({
        reviewId: right.id,
        duplicatesReviewId: left.id,
        domains: [leftSource.domain, rightSource.domain],
        similarity: Number(similarity.toFixed(3)),
        sharedExcerpt: sharedPassage(left.body, right.body),
      });
    }
  }

  return findings;
}

/**
 * The similarity of two review bodies.
 *
 * A token-set comparison is used rather than a character-level one,
 * because syndicated reviews are often lightly reformatted — a changed
 * brand name, a reordered sentence — but keep the same vocabulary.
 */
export function bodySimilarity(left: string, right: string): number {
  const leftTokens = tokeniseBody(left);
  const rightTokens = tokeniseBody(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }

  const jaccard = shared / (leftTokens.size + rightTokens.size - shared);
  // Combine with a character-level score so that a short review sharing
  // a common vocabulary does not look syndicated.
  const character = fuzzySimilarity(left, right);
  return jaccard * 0.6 + character * 0.4;
}

/** The significant tokens of a review body. */
function tokeniseBody(body: string): Set<string> {
  const tokens = body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);

  // Common filler words carry no signal about whether two reviews are
  // the same text.
  const stop = new Set([
    'the', 'and', 'for', 'this', 'that', 'with', 'are', 'was', 'were', 'have',
    'has', 'had', 'not', 'but', 'you', 'your', 'its', 'it', 'they', 'them',
    'very', 'really', 'just', 'also', 'there', 'here', 'when', 'what', 'from',
    'would', 'could', 'should', 'will', 'can', 'my', 'me', 'we', 'our',
    'product', 'shoe', 'shoes', 'pair', 'buy', 'bought', 'purchase', 'ordered',
  ]);

  return new Set(tokens.filter((token) => !stop.has(token)));
}

/** The longest passage the two bodies share. */
function sharedPassage(left: string, right: string): string {
  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);

  let best = '';
  for (const length of [12, 10, 8, 6]) {
    for (let i = 0; i + length <= leftWords.length; i += 1) {
      const candidate = leftWords.slice(i, i + length).join(' ');
      const normalised = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, '');
      for (let j = 0; j + length <= rightWords.length; j += 1) {
        const other = rightWords.slice(j, j + length).join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, '');
        if (normalised === other && candidate.length > best.length) {
          best = candidate;
        }
      }
    }
    if (best) break;
  }

  return best.slice(0, 240);
}

/* ------------------------------------------------------------------ */
/* Complaint clustering                                                  */
/* ------------------------------------------------------------------ */

/**
 * Find the recurring complaints.
 *
 * A complaint counts once per review. The number reported is the number
 * of *reviews*, and the independent-source count is the number of
 * *distinct domains*. Neither is a failure rate and neither is
 * extrapolated to a population.
 */
export function clusterComplaints(
  reviews: Review[],
  sources: Map<string, ReviewSource>,
  options: { variantOf?: (review: Review) => string | null } = {},
): ComplaintCluster[] {
  const clusters: ComplaintCluster[] = [];

  for (const pattern of COMPLAINT_PATTERNS) {
    const matching = reviews.filter((review) =>
      pattern.patterns.some((regex) => regex.test(review.body)),
    );
    if (matching.length === 0) continue;

    const domains = new Set<string>();
    const variants = new Set<string>();
    const dates: string[] = [];
    const excerpts: string[] = [];

    for (const review of matching) {
      const source = sources.get(review.id);
      if (source) domains.add(source.domain);

      const variant = options.variantOf?.(review) ?? null;
      if (variant) variants.add(variant);

      if (review.reviewedAt) dates.push(review.reviewedAt);

      const excerpt = excerptAround(review.body, pattern.patterns);
      if (excerpt) excerpts.push(excerpt);
    }

    // A complaint that only ever appears in syndicated content is not
    // independent evidence.
    const syndicatedIds = new Set(
      matching
        .filter((review) => {
          const source = sources.get(review.id);
          if (!source) return false;
          // A review whose domain is unique among the matching set is
          // independent; one that shares a domain with another is not.
          const sameDomain = matching.filter((other) => {
            const otherSource = sources.get(other.id);
            return otherSource?.domain === source.domain;
          });
          return sameDomain.length > 1;
        })
        .map((review) => review.id),
    );

    const independentReviews = matching.filter((review) => !syndicatedIds.has(review.id));
    const independentDomains = new Set(
      independentReviews
        .map((review) => sources.get(review.id)?.domain)
        .filter((domain): domain is string => Boolean(domain)),
    );

    const sortedDates = [...dates].sort();
    const severity = pattern.severity * Math.min(1, 0.55 + independentDomains.size * 0.15);

    clusters.push({
      id: pattern.key,
      label: pattern.label,
      mentions: matching.length,
      independentSources: independentDomains.size,
      reviewIds: matching.map((review) => review.id),
      domains: [...domains],
      variants: [...variants],
      firstSeen: sortedDates[0] ?? null,
      lastSeen: sortedDates[sortedDates.length - 1] ?? null,
      syndicatedOnly: independentReviews.length === 0 && matching.length > 0,
      excerpts: excerpts.slice(0, 5),
      severity: Number(severity.toFixed(3)),
      aspects: pattern.aspects,
    });
  }

  clusters.sort((a, b) => b.severity - a.severity || b.independentSources - a.independentSources);
  return clusters;
}

/** The recurring praise. */
export function clusterPraise(
  reviews: Review[],
  sources: Map<string, ReviewSource>,
  options: { variantOf?: (review: Review) => string | null } = {},
): PraiseCluster[] {
  const clusters: PraiseCluster[] = [];

  for (const pattern of PRAISE_PATTERNS) {
    const matching = reviews.filter((review) =>
      pattern.patterns.some((regex) => regex.test(review.body)),
    );
    if (matching.length === 0) continue;

    const domains = new Set<string>();
    const variants = new Set<string>();
    const excerpts: string[] = [];

    for (const review of matching) {
      const source = sources.get(review.id);
      if (source) domains.add(source.domain);
      const variant = options.variantOf?.(review) ?? null;
      if (variant) variants.add(variant);
      const excerpt = excerptAround(review.body, pattern.patterns);
      if (excerpt) excerpts.push(excerpt);
    }

    clusters.push({
      id: pattern.key,
      label: pattern.label,
      mentions: matching.length,
      independentSources: domains.size,
      reviewIds: matching.map((review) => review.id),
      variants: [...variants],
      excerpts: excerpts.slice(0, 5),
      aspects: pattern.aspects,
    });
  }

  clusters.sort((a, b) => b.independentSources - a.independentSources);
  return clusters;
}

/** The passage of a review around the first pattern match. */
function excerptAround(body: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (!match || match.index === undefined) continue;

    const start = Math.max(0, match.index - 60);
    const end = Math.min(body.length, match.index + match[0].length + 60);
    const excerpt = body.slice(start, end).replace(/\s+/g, ' ').trim();
    return excerpt.length > 0 ? excerpt : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The ownership analysis                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the ownership picture for a product.
 *
 * `sources` maps a review id to the site it came from, so independence
 * can be judged. `variantOf` maps a review to the variant it describes,
 * so a complaint on one variant is not attributed to another.
 */
export function analyseOwnership(
  productId: string,
  reviews: Review[],
  sources: Map<string, ReviewSource>,
  options: { variantOf?: (review: Review) => string | null } = {},
): OwnershipIntelligence {
  const syndicated = detectSyndication(reviews, sources);

  // A review that duplicates content from another source does not count
  // as an independent opinion. Keep the earlier one, drop the copy.
  const removed = new Set(syndicated.map((entry) => entry.reviewId));
  const independent = reviews.filter((review) => !removed.has(review.id));

  const complaints = clusterComplaints(independent, sources, options);
  const praise = clusterPraise(independent, sources, options);

  const domains = new Set<string>();
  for (const review of independent) {
    const source = sources.get(review.id);
    if (source) domains.add(source.domain);
  }

  const variants = new Set<string>();
  for (const review of independent) {
    const variant = options.variantOf?.(review) ?? null;
    if (variant) variants.add(variant);
  }

  const dates = independent
    .map((review) => review.reviewedAt)
    .filter((date): date is string => Boolean(date))
    .sort();

  // The long-term concerns are the complaints that describe a problem
  // which appears over time rather than a preference.
  const longTermConcerns = complaints
    .filter(
      (cluster) =>
        cluster.aspects.includes('durability') ||
        cluster.aspects.includes('service') ||
        cluster.id === 'runs_small' ||
        cluster.id === 'sole_wear',
    )
    .map((cluster) =>
      cluster.syndicatedOnly
        ? `${cluster.label} (reported ${cluster.mentions} time${cluster.mentions === 1 ? '' : 's'}, but only in duplicated content)`
        : `${cluster.label} (reported by ${cluster.independentSources} independent source${cluster.independentSources === 1 ? '' : 's'})`,
    );

  const insufficient = independent.length < 3;

  return {
    productId,
    complaints,
    praise,
    syndicated,
    independentReviewCount: independent.length,
    removedReviewCount: removed.size,
    independentSourceCount: domains.size,
    variantsCovered: [...variants],
    period: {
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
    },
    longTermConcerns,
    insufficientEvidence: insufficient,
    insufficientReason:
      independent.length === 0
        ? 'No independent owner reviews were found for this product.'
        : `Only ${independent.length} independent review${independent.length === 1 ? '' : 's'} were found, which is too few to identify a pattern.`,
  };
}
