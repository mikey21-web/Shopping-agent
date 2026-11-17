/**
 * Research evidence architecture.
 *
 * Every fact that enters SahiPick through the research system carries its own
 * provenance. This is the difference between "a number the agent believed" and
 * "a number we can point at a URL for".
 *
 * Design rules encoded here:
 *  - A fact names the product and the variant it belongs to. A price for
 *    "16GB/1TB" must never be attached to "8GB/256GB".
 *  - A fact records *when it was retrieved* and *when it was last verified*.
 *    Those are different moments: we may have found a page three weeks ago and
 *    confirmed its contents yesterday.
 *  - A fact records *how* it was extracted, so a deterministic parser can be
 *    trusted more than a model guess — and so we can audit it.
 *  - A fact carries a freshness verdict computed against the per-fact-kind
 *    policy, not a blanket expiry.
 *  - Nothing here may be "live" unless it genuinely came off the network.
 *    Sample data keeps its `sample` origin no matter how it is labelled.
 */

import type { CategoryId, DataOrigin } from '../domain/types.ts';

/* ------------------------------------------------------------------ */
/* Fact taxonomy                                                       */
/* ------------------------------------------------------------------ */

/**
 * The kinds of fact research can gather.
 *
 * These map onto the freshness policies in `intelligence/cache/freshness.ts`:
 * a price and a product identity are not equally volatile, and must not be
 * cached for the same period.
 */
export type ResearchFactKind =
  // identity
  | 'model_identification' // brand + model + part number
  | 'variant_identification' // configuration, SKU, GTIN
  | 'compatibility' // fits/works with what
  // specifications
  | 'specification' // one spec value
  | 'warranty'
  | 'dimensions'
  | 'certification'
  | 'ingredients'
  | 'nutrition'
  // commercial
  | 'price'
  | 'stock'
  | 'delivery'
  | 'offer'
  | 'seller'
  // social
  | 'review_theme'
  | 'review_complaint'
  | 'review_praise'
  | 'owner_experience'
  // meta
  | 'source_page'
  | 'unresolved_conflict';

/** Which freshness policy governs a fact kind. */
export const FACT_KIND_FRESHNESS: Record<ResearchFactKind, string> = {
  model_identification: 'product_identity',
  variant_identification: 'product_identity',
  compatibility: 'specifications',
  specification: 'specifications',
  warranty: 'specifications',
  dimensions: 'specifications',
  certification: 'specifications',
  ingredients: 'specifications',
  nutrition: 'specifications',
  price: 'price',
  stock: 'stock',
  delivery: 'stock',
  offer: 'offers',
  seller: 'provider_response',
  review_theme: 'review_analysis',
  review_complaint: 'review_analysis',
  review_praise: 'review_analysis',
  owner_experience: 'reviews',
  source_page: 'provider_response',
  unresolved_conflict: 'provider_response',
};

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/** How a fact's value was obtained. */
export type ExtractionMethod =
  | 'json_ld' // schema.org Product block
  | 'microdata' // itemprop attributes
  | 'meta_tag' // og: / product meta tags
  | 'spec_table' // a key/value specification table
  | 'retailer_parser' // a deterministic parser for a known page structure
  | 'search_snippet'
  | 'sitemap'
  | 'browser_dom' // read from a rendered DOM
  | 'browser_js' // returned by an in-page JavaScript evaluation
  | 'llm_extraction' // a model read unstructured text
  | 'manual' // a human confirmed it
  | 'seed'; // bundled sample data

/**
 * Confidence attached to a *method*, before any per-fact adjustment.
 * A deterministic parser reading a structured block is trusted more than a
 * model summarising prose; the difference is the point.
 */
export const METHOD_CONFIDENCE: Record<ExtractionMethod, number> = {
  json_ld: 0.92,
  microdata: 0.88,
  meta_tag: 0.8,
  spec_table: 0.75,
  retailer_parser: 0.85,
  search_snippet: 0.45,
  sitemap: 0.4,
  browser_dom: 0.8,
  browser_js: 0.85,
  llm_extraction: 0.55,
  manual: 1,
  seed: 0.3,
};

/** The literal excerpt from the page that supports a fact. */
export interface Evidence {
  /** Short verbatim quote or structured snippet. */
  excerpt: string;
  /** Where on the page it was found, when we can say. */
  locator?: string | null;
  /** The exact JSON path / CSS selector / script expression, when applicable. */
  selector?: string | null;
  /** Character offset in the retrieved document, when applicable. */
  offset?: number | null;
}

/** A page we retrieved, with the metadata needed to cite and re-fetch it. */
export interface RetrievedPage {
  url: string;
  /** The URL after redirects. */
  finalUrl: string;
  /** Domain of the page, lowercased. */
  domain: string;
  /** HTTP status, when fetched over HTTP. */
  status: number | null;
  /** ISO-8601 timestamp of retrieval. */
  retrievedAt: string;
  /** How the page was obtained. */
  method: ExtractionMethod;
  /** Document title, when known. */
  title?: string | null;
  /** Length of the retrieved document in bytes. */
  bytes?: number | null;
  /** robots.txt decision that applied to this fetch. */
  robotsDecision?: 'allowed' | 'disallowed' | 'unknown' | 'not_checked';
  /** True when the page required a browser to render. */
  rendered?: boolean;
  /** Milliseconds the retrieval took. */
  elapsedMs?: number | null;
}

/* ------------------------------------------------------------------ */
/* Facts                                                               */
/* ------------------------------------------------------------------ */

/** How confident we are that a fact agrees with other sources. */
export type VerificationStatus =
  | 'single_source' // only one source said this
  | 'corroborated' // two or more independent sources agree
  | 'conflicting' // sources disagree — surfaced, never silently resolved
  | 'unverifiable'; // could not be checked

export interface ResearchFact {
  /** Stable id, derived from product + kind + key. */
  id: string;
  /** The product this fact belongs to. */
  productId: string;
  /** The variant this fact belongs to, when the fact is variant-specific. */
  variantId: string | null;
  /** What kind of fact this is. */
  kind: ResearchFactKind;
  /** A stable key within the kind, e.g. 'ram', 'warrantyMonths', 'listPrice'. */
  key: string;
  /** The value. Typed where possible; strings otherwise. */
  value: string | number | boolean | null;
  /** Unit, when the value is a measurement. */
  unit?: string | null;
  /** The page the fact came from. */
  sourceUrl: string;
  /** The domain of the source. */
  sourceDomain: string;
  /** ISO-8601 timestamp of retrieval. */
  retrievedAt: string;
  /** ISO-8601 timestamp of the last verification against a live page. */
  verifiedAt: string | null;
  /** Supporting excerpt. */
  evidence: Evidence | null;
  /** 0..1 — method confidence adjusted by agreement and specificity. */
  confidence: number;
  /** Where the data came from. Never 'live' unless actually fetched. */
  origin: DataOrigin;
  /** How the value was extracted. */
  extractionMethod: ExtractionMethod;
  /** Freshness verdict against the fact kind's policy. */
  freshness: 'fresh' | 'stale' | 'expired' | 'unknown';
  /** How the fact was verified against other sources. */
  verification: VerificationStatus;
  /** Number of independent sources that asserted this fact. */
  corroboratingSources: number;
  /** Sources that disagreed with this fact. */
  conflictingSources: string[];
}

/* ------------------------------------------------------------------ */
/* Search results                                                      */
/* ------------------------------------------------------------------ */

/** A single web search hit. */
export interface SearchHit {
  title: string;
  url: string;
  /** The search provider's summary/snippet. */
  snippet: string | null;
  /** The provider's own score, when it publishes one. */
  score?: number | null;
  /** Publication date as reported by the provider, ISO-8601 when parseable. */
  publishedAt?: string | null;
  /** The domain, derived from the URL. */
  domain: string;
  /** Which provider produced this hit. */
  provider: string;
  /** The provider's own identifier for the result. */
  providerRef?: string | null;
}

/** A search provider's identity and capabilities. */
export interface SearchProvider {
  id: string;
  name: string;
  /** Whether the provider is usable right now. */
  configured: boolean;
  /** Why not, when unconfigured. */
  reason: string | null;
  /** Which upstream engine backs it (Exa, Linkup, DuckDuckGo, ...). */
  engine: string;
  /** Cost per query in USD, when known. */
  costPerQueryUsd: number | null;
  /** Requests per minute, when known. */
  rateLimitPerMinute: number | null;
  /** Search one query. */
  search(query: string, options: SearchOptions): Promise<SearchProviderResult>;
}

export interface SearchOptions {
  limit?: number;
  /** Restrict results to these domains. */
  includeDomains?: string[];
  /** Exclude results from these domains. */
  excludeDomains?: string[];
  /** Country hint, e.g. 'IN'. */
  country?: string;
  /** Recency window in days. */
  recencyDays?: number;
  /** Deadline for the whole call. */
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface SearchProviderResult {
  hits: SearchHit[];
  /** The query as the provider understood it, when it differs. */
  interpretedQuery?: string | null;
  /** ISO-8601 timestamp of the search. */
  searchedAt: string;
  /** Provider latency in milliseconds. */
  elapsedMs: number;
  /** Any provider notice worth surfacing. */
  notice?: string | null;
}

/* ------------------------------------------------------------------ */
/* Research skills                                                     */
/* ------------------------------------------------------------------ */

/**
 * A skill is a reusable research procedure for one domain of knowledge.
 *
 * Skills are data, not code paths: each declares the searches to run, the
 * domains to trust, the facts it wants, and how to interpret what it finds.
 * That keeps the research system working for categories nobody has written
 * code for yet.
 */
export interface ResearchSkill {
  id: string;
  name: string;
  /** Categories this skill applies to. */
  categories: CategoryId[];
  /** What the skill is trying to establish. */
  objective: string;
  /** Search queries to run, as templates with `{model}`, `{brand}` slots. */
  searches: string[];
  /** Domains that are authoritative for this skill. */
  preferredDomains: string[];
  /** Domains to avoid (aggregators, coupon spam). */
  blockedDomains: string[];
  /** Fact kinds this skill attempts to gather. */
  factKinds: ResearchFactKind[];
  /** Which page types to open, in preference order. */
  pagePreference: ('manufacturer' | 'retailer' | 'review_site' | 'forum' | 'community' | 'documentation')[];
  /** True when this skill needs a rendered browser to work. */
  requiresBrowser: boolean;
  /** How much to trust this skill's facts, 0..1. */
  weight: number;
  /** Interpretation hints for the extraction stage. */
  notes?: string;
}

/** The plan a skill turns into — the concrete searches and pages to visit. */
export interface ResearchPlanStep {
  skillId: string;
  query: string;
  purpose: 'identify' | 'specify' | 'price' | 'review' | 'verify' | 'compatibility';
  /** Domains to prefer for this step. */
  preferredDomains: string[];
  pagePreference: ResearchSkill['pagePreference'];
  requiresBrowser: boolean;
  factKinds: ResearchFactKind[];
  /** How many results to consider. */
  limit: number;
}

export interface ResearchPlan {
  productId: string;
  variantId: string | null;
  category: CategoryId;
  brand: string;
  model: string;
  /** Free-text terms, e.g. the display name. */
  terms: string;
  steps: ResearchPlanStep[];
  skills: string[];
  /** Overall deadline for the whole plan. */
  deadlineMs: number;
}

/* ------------------------------------------------------------------ */
/* Run bookkeeping                                                     */
/* ------------------------------------------------------------------ */

/** One step of a research run, with its measured cost and outcome. */
export interface ResearchStepOutcome {
  skillId: string;
  purpose: ResearchPlanStep['purpose'];
  query: string | null;
  url: string | null;
  status: 'ok' | 'empty' | 'skipped' | 'failed' | 'blocked';
  /** Why it was skipped or how it failed. */
  reason: string | null;
  elapsedMs: number;
  /** Facts produced. */
  factCount: number;
  /** Whether a browser was used. */
  usedBrowser: boolean;
  /** Attempts made, including retries. */
  attempts: number;
}

/** The result of a research run. */
export interface ResearchRun {
  id: string;
  productId: string;
  variantId: string | null;
  category: CategoryId;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  /** Facts gathered, deduplicated. */
  facts: ResearchFact[];
  /** Per-step outcomes, including failures. */
  steps: ResearchStepOutcome[];
  /** Sources that could not be reached. */
  failures: { url: string | null; reason: string; source: string }[];
  /** Contradictions found and surfaced. */
  conflicts: ResearchConflict[];
  /** Searches issued. */
  searchCount: number;
  /** Pages fetched. */
  pageCount: number;
  /** Browser sessions opened. */
  browserSessions: number;
  /** Total external cost in USD, when providers report one. */
  costUsd: number;
  /** True when nothing at all was learned. */
  empty: boolean;
  /**
   * The product listings that were discovered and normalised during the
   * run. The UI shows these as the "products found" list.
   */
  products: import('./extract/schema.ts').NormalizedProduct[];
  /**
   * Every query that was issued, with its provider, its cost and its
   * result count.
   */
  queries: import('./acquisition.ts').AcquisitionQuery[];
  /** The adapters and providers that could not run, and why. */
  unavailableSources: { id: string; name: string; reason: string }[];
  /** Human-readable notes for the UI. */
  notes: string[];
}

/** A contradiction between sources. Never resolved silently. */
export interface ResearchConflict {
  factKind: ResearchFactKind;
  key: string;
  /** The competing values, with their sources. */
  positions: {
    value: string | number | boolean | null;
    sourceUrl: string;
    sourceDomain: string;
    observedAt: string;
    confidence: number;
  }[];
  /** Plain-language explanation. */
  explanation: string;
  /** How we treat the fact in the absence of a resolution. */
  resolution: 'shown_as_conflict' | 'higher_confidence_wins' | 'excluded';
}
