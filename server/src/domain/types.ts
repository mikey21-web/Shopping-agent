/**
 * SahiPick domain model.
 *
 * Design rules encoded here:
 *  - Product identity separates the *model* from the *configuration*. A 16GB/1TB
 *    and an 8GB/512GB unit of the same model are different variants and must
 *    never be merged.
 *  - Every externally sourced fact carries provenance (`DataOrigin`) so the UI
 *    can distinguish verified live data from sample data and from derived values.
 *  - Money is always integer paise. No floats anywhere near a price.
 */

/** Where a piece of data came from. Drives the trust badge in the UI. */
export type DataOrigin =
  | 'live' // fetched from a retailer/feed at a known time
  | 'sample' // bundled demonstration data — must be labelled as such
  | 'derived' // computed by SahiPick from other facts (e.g. final payable price)
  | 'model_est' // produced by an AI model (never treated as fact)
  | 'unknown'; // no usable provenance

export interface Provenance {
  origin: DataOrigin;
  /** Retailer/feed identifier, e.g. 'amazon.in', 'croma', 'sample'. */
  source: string;
  /** ISO-8601 timestamp of last observation. */
  observedAt: string | null;
  /** 0..1 — how much we trust this record's completeness. */
  confidence: number;
  /** Where the record physically lives (URL) when known. */
  url?: string | null;
  note?: string | null;
}

export type CategoryId =
  | 'smartphone'
  | 'laptop'
  | 'tv'
  | 'audio'
  | 'smartwatch'
  | 'camera'
  | 'gaming'
  | 'appliance'
  | 'fashion'
  | 'beauty'
  | 'furniture'
  | 'grocery'
  | 'automotive'
  | 'shoes';

export const CATEGORY_IDS: readonly CategoryId[] = [
  'smartphone',
  'laptop',
  'tv',
  'audio',
  'smartwatch',
  'camera',
  'gaming',
  'appliance',
  'fashion',
  'beauty',
  'furniture',
  'grocery',
  'automotive',
  'shoes',
];

/** Retailer / marketplace identifiers we build adapters for. */
export type RetailerId =
  | 'amazon_in'
  | 'flipkart'
  | 'croma'
  | 'reliance_digital'
  | 'vijay_sales'
  | 'myntra'
  | 'ajio'
  | 'tatacliq'
  | 'decathlon'
  | 'roadster'
  | 'blinkit'
  | 'zepto'
  | 'sample';

/* ------------------------------------------------------------------ */
/* Specifications                                                      */
/* ------------------------------------------------------------------ */

/**
 * Normalised specification values.
 * Scalars are kept as numbers (already normalised, e.g. storage in GB) so that
 * comparisons are arithmetic, not string matching.
 */
export interface NormalizedSpecs {
  /** RAM capacity in GB. */
  ramGb?: number;
  /** Storage capacity in GB. */
  storageGb?: number;
  /** Storage type, e.g. 'SSD', 'UFS 3.1', 'eMMC'. */
  storageType?: string;
  /** Chipset / SoC marketing name, e.g. 'Snapdragon 8 Gen 3'. */
  soc?: string;
  /** SoC family, e.g. 'snapdragon', 'exynos', 'mediatek_dimensity', 'apple', 'intel_core', 'amd_ryzen'. */
  socFamily?: string;
  /** CPU cores (physical). */
  cpuCores?: number;
  /** Display diagonal in inches. */
  displaySizeIn?: number;
  /** Display panel technology, e.g. 'AMOLED'. */
  displayPanel?: string;
  /** Display refresh rate in Hz. */
  refreshHz?: number;
  /** Battery capacity in mAh. */
  batteryMah?: number;
  /** Camera megapixels of the primary/rear main sensor. */
  cameraMainMp?: number;
  /** Number of rear cameras. */
  rearCameraCount?: number;
  /** Colour option. */
  colour?: string;
  /** Network generation supported, e.g. '5G'. */
  network?: string;
  /** OS family, e.g. 'Android', 'iOS', 'Windows'. */
  os?: string;
  /** Generation marker of the model line, e.g. '2024'. */
  generation?: string;
  /** Warranty length in months. */
  warrantyMonths?: number;
  /** Free-form category-specific fields (e.g. GPU model, VRAM in GB, tonnage). */
  extra: Record<string, string | number | boolean>;
}

/** A raw specification as extracted from a retailer page/feed. */
export interface RawSpec {
  key: string;
  value: string;
  /** Where this particular key/value pair came from. */
  source: string;
}

/* ------------------------------------------------------------------ */
/* Products and variants                                               */
/* ------------------------------------------------------------------ */

/**
 * The *model*. E.g. "Samsung Galaxy S24 Ultra".
 * Identity key is brand + canonical model + generation.
 */
export interface Product {
  id: string;
  brand: string;
  /** Canonical model name, normalised (e.g. 'galaxy s24 ultra'). */
  model: string;
  /** Human display name. */
  displayName: string;
  category: CategoryId;
  /** Identity key used for cross-retailer matching. */
  identityKey: string;
  /** Variant-signature key: identity + configuration fingerprint. */
  variantKey?: string | null;
  specs: NormalizedSpecs;
  /** True when specs were confirmed by a human/curated source rather than parsed. */
  specsVerified: boolean;
  /** Specification provenance summary. */
  specSources: string[];
  /** Distinct features useful for comparison. */
  highlights: string[];
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A sellable configuration of a product. The unit that carries a price.
 * `configSignature` is a sorted, normalised description of the configuration
 * that must be equal for two listings to be considered the *same* item.
 */
export interface ProductVariant {
  id: string;
  productId: string;
  /** e.g. '16GB / 1TB / Titanium Gray' */
  label: string;
  configSignature: string;
  specs: NormalizedSpecs;
  /** e.g. 'SM-S928B' — manufacturer model/part number. */
  partNumber?: string | null;
  /** e.g. 'SM-S928BINDTUA' — manufacturer SKU. */
  sku?: string | null;
  /** GTIN/EAN/UPC barcode when the retailer provides one. */
  gtin?: string | null;
  colour?: string | null;
  imageUrl?: string | null;
}

export type ListingCondition = 'new' | 'refurbished' | 'used' | 'open_box';

export interface RetailerListing {
  id: string;
  variantId: string;
  productId: string;
  retailer: RetailerId;
  /** Retailer's own product id. */
  retailerProductId: string;
  title: string;
  url: string;
  /** Listed selling price in paise (integer). */
  listPricePaise: number;
  /** Price struck through by the retailer (MRP reference), if any. */
  mrpPaise?: number | null;
  condition: ListingCondition;
  inStock: boolean;
  /** Seller name when the retailer sells from multiple sellers (marketplace). */
  seller?: string | null;
  /** Star rating shown by the retailer, 0..5. */
  rating?: number | null;
  ratingCount?: number | null;
  /** Number of reviews the retailer holds for this listing. */
  reviewCount?: number | null;
  imageUrl?: string | null;
  /** Delivery or shipping fee in paise. */
  deliveryFeePaise?: number | null;
  provenance: Provenance;
  firstSeenAt: string;
  lastSeenAt: string;
}

/* ------------------------------------------------------------------ */
/* Offers and pricing                                                  */
/* ------------------------------------------------------------------ */

export type OfferKind =
  | 'coupon' // retailer coupon (percentage or flat)
  | 'bank_discount' // instant discount via bank card
  | 'card_offer' // credit/debit card offer
  | 'cashback' // wallet/UTR cashback
  | 'emi' // EMI with an effective discount
  | 'no_cost_emi'
  | 'exchange' // exchange/buyback benefit
  | 'delivery' // free delivery or shipping
  | 'membership'; // membership-gated price drop

export type OfferStackability = 'stackable' | 'exclusive' | 'primary_only';

/** Eligibility conditions attached to an offer. */
export interface OfferConditions {
  /** Minimum spend in paise. */
  minSpendPaise?: number;
  /** Maximum discount cap in paise (for percentage offers). */
  maxDiscountPaise?: number;
  /** Required payment methods, e.g. ['HDFC Credit Card']. */
  paymentMethods?: string[];
  /** Bank code the offer belongs to. */
  bank?: string | null;
  /** Membership tier required, e.g. 'Prime', 'Flipkart Plus'. */
  membershipTier?: string | null;
  /** Exclusive card type, e.g. 'credit' | 'debit'. */
  cardType?: 'credit' | 'debit' | null;
  /** EMI tenure in months when the offer is an EMI offer. */
  emiTenureMonths?: number | null;
  /** Annual interest rate for EMI offers, e.g. 10.5. */
  emiInterestRatePercent?: number | null;
  /** One-time EMI processing fee in paise. */
  emiProcessingFeePaise?: number | null;
  /** Minimum EMI tenure that qualifies for this offer, in months. */
  emiMinTenureMonths?: number | null;
  /** Bank selection required for no-cost EMI, e.g. 'HDFC Bank'. */
  emiBank?: string | null;
  /** Exchange requires a qualifying old device. */
  requiresExchange?: boolean;
  /** Discount value on exchange in paise (not applied to cart, informational). */
  exchangeBonusPaise?: number | null;
  /** Coupon code the shopper must apply manually. */
  couponCode?: string | null;
  /** Free-text terms from the retailer. */
  terms?: string | null;
}

export interface Offer {
  id: string;
  listingId: string;
  kind: OfferKind;
  title: string;
  description?: string | null;
  /** Percentage discount, e.g. 10 means 10%. */
  percentOff?: number | null;
  /** Flat discount in paise. */
  flatOffPaise?: number | null;
  /** Cashback in paise (not a price reduction; reported separately). */
  cashbackPaise?: number | null;
  conditions: OfferConditions;
  stackability: OfferStackability;
  /** True when the benefit is applied automatically at checkout. */
  automatic: boolean;
  validityStart?: string | null;
  validityEnd?: string | null;
  provenance: Provenance;
}

/** The result of applying offers to a listing. Deterministic, in paise. */
export interface PriceBreakdown {
  listingId: string;
  productId: string;
  variantId: string;
  retailer: RetailerId;
  /** Retailer's listed price. */
  listPricePaise: number;
  /** MRP for reference. */
  mrpPaise: number | null;
  /** Sum of guaranteed price reductions actually applied. */
  guaranteedDiscountPaise: number;
  /** Sum of conditional reductions that apply only if conditions are met. */
  conditionalDiscountPaise: number;
  /** Total reduction if all conditional offers qualify. */
  potentialDiscountPaise: number;
  /** Lowest payable = list - guaranteed - conditional (never below 0). */
  bestCasePaise: number;
  /** Highest payable = list - guaranteed. */
  guaranteedPaise: number;
  /** Cashback earned (separate from price, not subtracted). */
  cashbackPaise: number;
  /** Exchange benefit (informational, not subtracted from cart). */
  exchangeBonusPaise: number;
  deliveryFeePaise: number;
  /** Final payable incl. delivery at the guaranteed level. */
  payablePaise: number;
  /** Final payable incl. delivery in the best case. */
  bestCasePayablePaise: number;
  /** Each applied offer with its contribution, for the explanation trail. */
  applied: AppliedOffer[];
  /** Offers that exist but were not applied, with the reason. */
  skipped: SkippedOffer[];
  /** Effective cost per month for EMI. */
  emi?: EmiPlan | null;
  /** Number of offers evaluated. */
  offerCount: number;
}

export interface AppliedOffer {
  offerId: string;
  kind: OfferKind;
  title: string;
  discountPaise: number;
  /** Whether this reduction is guaranteed or conditional. */
  certainty: 'guaranteed' | 'conditional';
  conditions: OfferConditions;
  stackability: OfferStackability;
}

export interface SkippedOffer {
  offerId: string;
  kind: OfferKind;
  title: string;
  reason: string;
}

export interface EmiPlan {
  months: number;
  monthlyPaise: number;
  interestRatePercent: number;
  totalPaise: number;
  processingFeePaise: number;
}

/* ------------------------------------------------------------------ */
/* Price history                                                       */
/* ------------------------------------------------------------------ */

export interface PricePoint {
  listingId: string;
  pricePaise: number;
  recordedAt: string;
  provenance: Provenance;
}

export interface PriceStats {
  listingId: string;
  /** Number of observations. */
  observations: number;
  minPaise: number;
  maxPaise: number;
  /** Simple arithmetic mean, rounded to nearest paise. */
  avgPaise: number;
  /** Median observation. */
  medianPaise: number;
  latestPaise: number;
  latestAt: string;
  /** How far the current price is below the recorded average, 0..1. */
  discountVsAvg: number;
  /** How far the current price is below the recorded low, 0..1 (0 when at low). */
  belowLowPaise: number;
  /** Coefficient of variation of observed prices. */
  volatility: number;
  /** True when there are enough observations to reason about. */
  reliable: boolean;
}

export type BuyWaitVerdict = 'buy_now' | 'fair_price' | 'wait' | 'insufficient_data';

export interface BuyWaitAssessment {
  verdict: BuyWaitVerdict;
  /** 0..1 confidence in the verdict. */
  confidence: number;
  /** Human-readable reasoning lines. */
  reasons: string[];
  /** The historical low price, when known. */
  historicalLowPaise: number | null;
  /** Expected wait time for a better price, in days, when it can be bounded. */
  expectedImprovementDays: number | null;
  /** 0..1 — how trustworthy the price history is overall. */
  historyQuality: number;
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export type ReviewLanguage = 'en' | 'hi' | 'hinglish' | 'other';

export interface Review {
  id: string;
  /** Null when the review is attached to the product rather than one listing. */
  listingId: string | null;
  productId: string;
  title?: string | null;
  body: string;
  rating: number;
  author?: string | null;
  /** Retailer's "verified purchase" marker when present. */
  verifiedPurchase: boolean | null;
  /** Review date as reported by the retailer. */
  reviewedAt?: string | null;
  helpfulVotes?: number | null;
  language: ReviewLanguage;
  /** Per-aspect star ratings when the retailer exposes them. */
  aspectRatings?: Record<string, number> | null;
  provenance: Provenance;
}

/** The product aspects we mine reviews for. */
export type ReviewAspect =
  | 'battery'
  | 'heating'
  | 'camera'
  | 'display'
  | 'performance'
  | 'build_quality'
  | 'software'
  | 'storage'
  | 'durability'
  | 'service'
  | 'value'
  | 'network'
  | 'audio'
  | 'design'
  | 'compatibility'
  // Category-neutral aspects used by non-electronics categories.
  | 'comfort'
  | 'fit'
  | 'noise_cancellation'
  | 'running_cost'
  | 'authenticity'
  | 'safety'
  | 'noise'
  | 'cleaning'
  | 'freshness'
  | 'accuracy';

export const REVIEW_ASPECTS: readonly ReviewAspect[] = [
  'battery',
  'heating',
  'camera',
  'display',
  'performance',
  'build_quality',
  'software',
  'storage',
  'durability',
  'service',
  'value',
  'network',
  'audio',
  'design',
  'compatibility',
  'comfort',
  'fit',
  'noise_cancellation',
  'running_cost',
  'authenticity',
  'safety',
  'noise',
  'cleaning',
  'freshness',
  'accuracy',
];

export interface ReviewEvidence {
  reviewId: string;
  quote: string;
  rating: number;
  reviewedAt?: string | null;
  verifiedPurchase: boolean | null;
  language: ReviewLanguage;
  aspect: ReviewAspect;
  /** +1 positive, -1 negative. */
  sentiment: -1 | 0 | 1;
}

export interface AspectSummary {
  aspect: ReviewAspect;
  /** 0..1 share of mentions that are negative. */
  negativeRate: number;
  positiveRate: number;
  mentionCount: number;
  /** Weighted sentiment, -1..1. */
  sentiment: number;
  /** Most common complaint phrases (English/Hinglish normalised). */
  topComplaints: string[];
  /** Most common praise phrases. */
  topPraises: string[];
  evidence: ReviewEvidence[];
}

export type ReviewSignalKind =
  | 'duplicate_content'
  | 'burst_pattern'
  | 'repetitive_language'
  | 'rating_distribution'
  | 'low_verified_ratio'
  | 'extreme_burst'
  | 'incentive_language'
  | 'new_account_volume';

export interface ReviewSignal {
  kind: ReviewSignalKind;
  /** 0..1 severity for this signal. */
  score: number;
  /** Plain-language explanation shown to the user. */
  explanation: string;
  /** How many reviews contributed to this signal. */
  affectedReviews: number;
  /** Supporting review ids. */
  evidenceReviewIds: string[];
}

export interface ReviewIntelligence {
  productId: string;
  listingId: string | null;
  /** Number of reviews analysed. */
  reviewCount: number;
  /** Verified-purchase share, 0..1. */
  verifiedRatio: number;
  /** Mean rating across analysed reviews. */
  averageRating: number;
  /** Share of reviews that are negative (1-2 stars), 0..1. */
  negativeShare: number;
  /** 0..1 — higher means the review corpus looks less trustworthy. */
  authenticityRisk: number;
  /** Explicit caveat: authenticity signals never prove a review is fake. */
  authenticityCaveat: string;
  signals: ReviewSignal[];
  aspects: AspectSummary[];
  /** Positive experiences that recur. */
  positives: string[];
  /** Recurring complaints. */
  complaints: string[];
  /** Complaints that appear mostly in older reviews (degradation over time). */
  longTermConcerns: string[];
  languageBreakdown: Record<string, number>;
  provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type MatchVerdict =
  | 'exact_same_variant' // identical model + identical configuration
  | 'same_model_different_variant' // identical model, different configuration
  | 'related_model' // different generation or sibling model
  | 'different_product';

export interface MatchSignal {
  name: string;
  /** 0..1 similarity contribution. */
  score: number;
  weight: number;
  detail: string;
}

export interface MatchResult {
  verdict: MatchVerdict;
  /** 0..1 overall confidence. */
  confidence: number;
  signals: MatchSignal[];
  /** Field-level differences that block an exact match. */
  differences: string[];
  /** Human-readable explanation. */
  explanation: string;
}

export interface VariantSignature {
  ramGb?: number | null;
  storageGb?: number | null;
  storageType?: string | null;
  colour?: string | null;
  soc?: string | null;
  displaySizeIn?: number | null;
  connectivity?: string | null;
  partNumber?: string | null;
  sku?: string | null;
  gtin?: string | null;
  size?: string | null;
  /** Generation marker, e.g. '2024'. */
  generation?: string | null;
  /** Condition of the item: new, refurbished, used, open box. */
  condition?: string | null;
  /** Connector/interface family, e.g. 'usb-c', 'lightning'. */
  interface?: string | null;
  /** Capacity field used by appliances and consumables (litres, kg). */
  capacity?: number | string | null;
  /** Version marker used by software, appliances and accessories. */
  version?: string | null;
}

/* ------------------------------------------------------------------ */
/* Requirements & recommendations                                       */
/* ------------------------------------------------------------------ */

export interface PurchaseRequirements {
  category?: CategoryId | null;
  budgetMinPaise?: number | null;
  budgetMaxPaise?: number | null;
  /** Aspect weights the user cares about, 0..1, e.g. { camera: 0.9, battery: 0.7 }. */
  priorities: Record<string, number>;
  /** Hard requirements that must not be violated. */
  mustHaves: string[];
  /** Nice-to-haves. */
  niceToHaves: string[];
  /** Usage patterns that alter scoring, e.g. 'gaming', 'local_ai', 'travel'. */
  workloads: string[];
  /** Free-text the user typed, retained for explanation and search. */
  rawQuery?: string | null;
  /** Aspects the assistant still needs to confirm with the user. */
  missingInfo: string[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  /** 0..1 sub-score. */
  score: number;
  /** Share of the total score this component contributes. */
  weight: number;
  /** Why this score, referencing evidence. */
  evidence: string[];
}

export type RecommendationBadge =
  | 'best_overall'
  | 'best_value'
  | 'best_performance'
  | 'best_long_term'
  | 'best_budget'
  | 'best_alternative';

export interface Recommendation {
  productId: string;
  /** Display name of the product, carried so the UI never shows an id. */
  displayName: string;
  brand: string;
  imageUrl: string | null;
  badge: RecommendationBadge | null;
  /** 0..1 final score. */
  score: number;
  components: ScoreComponent[];
  /** One-line summary of the trade-off. */
  summary: string;
  /** What is good. */
  strengths: string[];
  /** What is not good. */
  weaknesses: string[];
  /** Evidence references so the user can verify. */
  evidence: string[];
  /** Score contribution of review intelligence (0..1), and whether it was available. */
  reviewConfidence: number;
  /** Best known payable price at time of computation. */
  bestPricePaise: number | null;
  bestRetailer: RetailerId | null;
  /** True when the price used was sample data. */
  priceIsSample: boolean;
}

export interface RecommendationSet {
  requirements: PurchaseRequirements;
  generatedAt: string;
  recommendations: Recommendation[];
  /** Products considered but excluded, with the reason. */
  considered: number;
  excluded: { productId: string; reason: string }[];
  /** True when data quality was too poor to score confidently. */
  degraded: boolean;
  /** Human-readable notes about data quality. */
  dataQualityNotes: string[];
}
