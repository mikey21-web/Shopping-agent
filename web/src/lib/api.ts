/**
 * API client.
 *
 * Thin wrapper over fetch with typed responses. Every payload that can carry
 * externally-sourced facts includes a provenance field, which the UI renders
 * as a badge.
 */

export type DataOrigin = 'live' | 'sample' | 'derived' | 'model_est' | 'unknown';

/** A conditional follow-up question the buyer can answer or skip. */
export interface FollowUpQuestion {
  id: string;
  prompt: string;
  why: string;
  options: { label: string; value: string }[];
  allowDelegate: boolean;
}

/** The decision trace: every step that moved the ranking. */
export interface DecisionTrace {
  requirements: { summary?: string; category?: string; budgetMaxPaise?: number } | string;
  eliminated: { displayName: string; reason: string }[];
  evidence: unknown[];
  tradeOffs: unknown[];
  missingInformation: unknown[];
  winnerRationale: unknown;
  sensitivity: unknown[];
  limitations?: unknown[];
}

/** One of the eight intelligence dimensions. */
export interface DimensionView {
  id: string;
  label: string;
  score: number | null;
  weight: number;
  hasEvidence: boolean;
  confidence: string;
  summary: string;
  missing: string[];
  conflicts: string[];
  evidenceCount: number;
}

/** The conversation session returned by the buyer-intelligence engine. */
export interface ConversationState {
  sessionId: string;
  profile: Record<string, unknown>;
  profileSummary: string;
  gaps: string[];
  sufficient: boolean;
  questions: FollowUpQuestion[];
  delegated: boolean;
  turns: { role: 'shopper' | 'assistant'; text: string; at: string }[];
  nextStep: 'question' | 'ready';
}

export interface Provenance {
  origin: DataOrigin;
  source: string;
  observedAt: string | null;
  confidence: number;
  url?: string | null;
  note?: string | null;
}

export interface Citation {
  id: string;
  kind: 'product' | 'listing' | 'offer' | 'review' | 'price_history' | 'specification';
  label: string;
  url?: string | null;
  retailer?: string | null;
  origin: DataOrigin;
}

export interface Recommendation {
  productId: string;
  displayName: string;
  brand: string;
  imageUrl: string | null;
  badge: string | null;
  score: number;
  components: {
    key: string;
    label: string;
    score: number;
    weight: number;
    evidence: string[];
  }[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  evidence: string[];
  reviewConfidence: number;
  bestPricePaise: number | null;
  bestRetailer: string | null;
  priceIsSample: boolean;
}

export interface PurchaseRequirements {
  category: string | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  priorities: Record<string, number>;
  mustHaves: string[];
  niceToHaves: string[];
  workloads: string[];
  rawQuery: string | null;
  missingInfo: string[];
}

export interface ChatResponse {
  reply: string;
  citations: Citation[];
  requirements: PurchaseRequirements;
  requirementSummary: string;
  followUpQuestions: string[];
  recommendations: {
    productId: string;
    displayName: string;
    badge: string | null;
    score: number;
    pricePaise: number | null;
    priceLabel: string;
    retailer: string | null;
    imageUrl: string | null;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    evidence: string[];
    priceIsSample: boolean;
  }[];
  toolsUsed: { name: string; ok: boolean; error?: string }[];
  steps: number;
  provider: string;
  degraded: boolean;
  notes: string[];
  violations: { kind: string; message: string; detail?: unknown }[];
  /** The structured buyer profile the answer was based on. */
  profileSummary: string;
  /** Conditional follow-up questions, with their fixed options. */
  questions: FollowUpQuestion[];
  /** The full decision trace, when the decision engine ran. */
  trace: DecisionTrace | null;
  /** The eight intelligence dimensions for the winning product. */
  dimensions: DimensionView[];
  /** Why the decision could not be more certain. */
  decisionLimitations: string[];
}

export interface AppliedOffer {
  offerId: string;
  kind: string;
  title: string;
  discountPaise: number;
  certainty: 'guaranteed' | 'conditional';
  conditions: Record<string, unknown>;
  stackability: string;
}

export interface PriceBreakdown {
  listingId: string;
  retailer: string;
  listPricePaise: number;
  mrpPaise: number | null;
  guaranteedDiscountPaise: number;
  conditionalDiscountPaise: number;
  bestCasePaise: number;
  guaranteedPaise: number;
  cashbackPaise: number;
  exchangeBonusPaise: number;
  deliveryFeePaise: number;
  payablePaise: number;
  bestCasePayablePaise: number;
  applied: AppliedOffer[];
  skipped: { offerId: string; title: string; reason: string }[];
  emi: {
    months: number;
    monthlyPaise: number;
    interestRatePercent: number;
    totalPaise: number;
    processingFeePaise: number;
  } | null;
}

export interface ListingView {
  listing: {
    id: string;
    retailer: string;
    title: string;
    url: string;
    inStock: boolean;
    condition: string;
    seller: string | null;
    rating: number | null;
    ratingCount: number | null;
    deliveryFeePaise: number;
    provenance: Provenance;
  };
  breakdown: PriceBreakdown;
  priceStats: {
    observations: number;
    minPaise: number;
    maxPaise: number;
    avgPaise: number;
    medianPaise: number;
    latestPaise: number;
    discountVsAvg: number;
    volatility: number;
    reliable: boolean;
  } | null;
  buyWait: {
    verdict: 'buy_now' | 'fair_price' | 'wait' | 'insufficient_data';
    confidence: number;
    reasons: string[];
    historicalLowPaise: number | null;
    expectedImprovementDays: number | null;
    historyQuality: number;
  };
  isBestPrice: boolean;
  discountVsMrp: number;
}

export interface ReviewAspect {
  aspect: string;
  negativeRate: number;
  positiveRate: number;
  mentionCount: number;
  sentiment: number;
  topComplaints: string[];
  topPraises: string[];
  evidence: {
    reviewId: string;
    quote: string;
    rating: number;
    reviewedAt: string | null;
    verifiedPurchase: boolean | null;
    language: string;
    sentiment: number;
  }[];
}

export interface ReviewIntelligence {
  productId: string;
  reviewCount: number;
  verifiedRatio: number;
  averageRating: number;
  negativeShare: number;
  authenticityRisk: number;
  authenticityCaveat: string;
  signals: {
    kind: string;
    score: number;
    explanation: string;
    affectedReviews: number;
  }[];
  aspects: ReviewAspect[];
  positives: string[];
  complaints: string[];
  longTermConcerns: string[];
  languageBreakdown: Record<string, number>;
  provenance: Provenance;
}

export interface ProductView {
  product: {
    id: string;
    brand: string;
    model: string;
    displayName: string;
    category: string;
    identityKey: string;
    imageUrl: string | null;
    highlights: string[];
    specs: Record<string, unknown>;
  };
  variants: { id: string; label: string; configSignature: string }[];
  listings: ListingView[];
  bestListingId: string | null;
  bestPayablePaise: number | null;
  bestPriceIsSample: boolean;
  reviewIntelligence: ReviewIntelligence | null;
  matches: {
    listingId: string;
    variantId: string;
    verdict: string;
    confidence: number;
    explanation: string;
    differences: string[];
  }[];
  priceRange: { minPaise: number; maxPaise: number } | null;
  dataQualityNotes: string[];
}

export interface ResearchSourceStatus {
  id: string;
  name: string;
  engine?: string;
  domains?: string[];
  access?: string;
  configured?: boolean;
  available?: boolean;
  reason: string | null;
  requiresApproval?: boolean;
  costPerQueryUsd?: number | null;
}

export interface ProviderHealth {
  providerId: string;
  providerName: string;
  status: 'ok' | 'unavailable' | 'error' | 'not_configured';
  reason: string;
  hint: string | null;
  accessMethod: string;
  lastSuccessAt: string | null;
  refreshIntervalMinutes: number;
  dataConfidence: number;
  categories: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () =>
    request<{ status: string; aiProvider: string; remoteLlmConfigured: boolean; timeZone: string }>(
      '/api/health',
    ),

  providers: () => request<{ providers: ProviderHealth[]; note: string }>('/api/providers'),

  /** Live research sources: search providers and retailer adapters. */
  researchSources: () =>
    request<{
      providers: ResearchSourceStatus[];
      retailers: ResearchSourceStatus[];
      browser: { configured: boolean; reason: string | null };
      enabled: boolean;
      note: string;
    }>('/api/research/providers'),

  products: (params: { category?: string; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.category) search.set('category', params.category);
    if (params.q) search.set('q', params.q);
    const query = search.toString();
    return request<{
      count: number;
      products: {
        id: string;
        displayName: string;
        brand: string;
        category: string;
        imageUrl: string | null;
        highlights: string[];
      }[];
    }>(`/api/products${query ? `?${query}` : ''}`);
  },

  product: (id: string, shopper?: Record<string, string>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(shopper ?? {})) search.set(key, value);
    const query = search.toString();
    return request<ProductView>(`/api/products/${id}${query ? `?${query}` : ''}`);
  },

  priceHistory: (id: string, listingId?: string) => {
    const search = new URLSearchParams();
    if (listingId) search.set('listingId', listingId);
    const query = search.toString();
    return request<{
      listingId: string;
      retailer: string;
      provenance: Provenance;
      points: { pricePaise: number; recordedAt: string; origin: DataOrigin }[];
      stats: ProductView['listings'][number]['priceStats'];
      buyWait: ListingView['buyWait'];
    }>(`/api/products/${id}/price-history${query ? `?${query}` : ''}`);
  },

  recommendations: (query: string, requirements?: Partial<PurchaseRequirements>) =>
    request<{
      recommendations: Recommendation[];
      considered: number;
      excluded: { productId: string; reason: string }[];
      dataQualityNotes: string[];
      requirementSummary: string;
      missingInfo: string[];
      notes: string[];
    }>('/api/recommendations', {
      method: 'POST',
      body: JSON.stringify({ query, requirements }),
    }),

  compare: (productIds: string[]) =>
    request<{
      productIds: string[];
      rows: { label: string; values: (string | number | null)[]; differs: boolean }[];
      highlights: string[];
      priceComparison: {
        productId: string;
        listingId: string | null;
        retailer: string | null;
        payablePaise: number | null;
        bestCasePaise: number | null;
        isSample: boolean;
      }[];
      reviewComparison: {
        productId: string;
        reviewCount: number;
        averageRating: number | null;
        authenticityRisk: number | null;
        topComplaints: string[];
      }[];
      notes: string[];
    }>('/api/compare', {
      method: 'POST',
      body: JSON.stringify({ productIds }),
    }),

  chat: (message: string, sessionId = 'default') =>
    request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId }),
    }),

  /** Start a buyer-intelligence conversation. */
  startConversation: (message: string) =>
    request<ConversationState>('/api/conversation', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  /** Answer one of the conditional follow-up questions. */
  answerQuestion: (sessionId: string, questionId: string, answer: string) =>
    request<ConversationState>(`/api/conversation/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId, answer }),
    }),

  /** Skip a question without ending the conversation. */
  skipQuestion: (sessionId: string, questionId: string) =>
    request<ConversationState>(`/api/conversation/${sessionId}/skip`, {
      method: 'POST',
      body: JSON.stringify({ questionId }),
    }),

  /** Read the current state of a conversation. */
  getConversation: (sessionId: string) =>
    request<ConversationState>(`/api/conversation/${sessionId}`),

  discover: (q: string, category?: string) => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (category) search.set('category', category);
    const query = search.toString();
    return request<{
      catalogue: {
        id: string;
        displayName: string;
        brand: string;
        category: string;
        imageUrl: string | null;
        highlights: string[];
      }[];
      providers: {
        providerId: string;
        providerName: string;
        status: string;
        reason: string;
        hint: string | null;
        count: number;
        isSample: boolean;
      }[];
      note: string;
    }>(`/api/discover${query ? `?${query}` : ''}`);
  },
};
