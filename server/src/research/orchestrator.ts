/**
 * Deep research orchestrator.
 *
 * An adaptive, multi-source investigation engine. The shape of a run:
 *
 *   PLAN       the buyer's brief becomes research questions, and the
 *              questions become investigation tasks.
 *   DISCOVER   the tasks are issued in parallel across every configured
 *              search provider; the results are classified and deduplicated.
 *   BROWSE     pages are fetched over HTTP first and with a browser only
 *              when the HTTP fetch did not answer the question.
 *   EXTRACT    the extraction cascade turns each page into classified facts.
 *   VERIFY     facts are compared across independent sources. Agreement
 *              raises confidence; disagreement is preserved as a conflict.
 *   ASSESS     decision readiness is checked. If the evidence is sufficient,
 *              the run stops. If not, new tasks are generated from the gaps.
 *   REMEMBER   every query, page, finding and contradiction is written to
 *              the research memory so the next round does not repeat work.
 *
 * The loop is bounded three ways: by a deadline, by a page budget and by a
 * maximum number of rounds. It always stops with an honest account of what
 * it did not find.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { CategoryId, PurchaseRequirements } from '../domain/types.ts';
import { cached } from '../intelligence/cache/cache.ts';
import { ttlFor } from '../intelligence/cache/freshness.ts';

import { extractFacts, needsBrowser, type ExtractionResult } from './extract/index.ts';
import { fetchPage } from './sources/http.ts';
import { connectBrowser, type Browser } from './sources/browser.ts';
import { configuredSearchProviders, searchProviders } from './sources/search.ts';
import { skillsForCategory } from './skills/index.ts';
import { verifyFacts, type RawFact } from './verify.ts';
import { normaliseFacts } from './normalise.ts';
import { saveResearchFacts } from './store.ts';
import { EvidenceGraph, assessReadiness } from './evidence-graph.ts';
import { acquire, canonicalUrl, retailerForUrl } from './acquisition.ts';
import { extractProduct } from './extract/pipeline.ts';
import type { NormalizedProduct } from './extract/schema.ts';
import { analyseOwnership, type OwnershipIntelligence, type ReviewSource } from '../intelligence/reviews/ownership.ts';
import type { Review } from '../domain/types.ts';
import { ResearchMemory } from './memory.ts';
import { buildFollowUpTasks, buildResearchPlan, type ResearchTask } from './planner.ts';
import type {
  ExtractionMethod,
  ResearchConflict,
  ResearchFact,
  ResearchPlanStep,
  ResearchRun,
  ResearchStepOutcome,
  SearchHit,
} from './types.ts';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface ResearchOptions {
  /** Overall deadline for the run, in milliseconds. */
  deadlineMs?: number;
  /** How many pages to open at once. */
  pageConcurrency?: number;
  /** How many search queries to issue at once. */
  searchConcurrency?: number;
  /** Maximum pages this run may open in total. */
  maxPages?: number;
  /** Maximum search results to consider per query. */
  maxResultsPerQuery?: number;
  /** Maximum investigation rounds. */
  maxRounds?: number;
  /** Allow a browser to be launched for pages that need rendering. */
  allowBrowser?: boolean;
  /** Abort the run. */
  signal?: AbortSignal;
  /** Progress callback — one event per meaningful step. */
  onProgress?: (event: ResearchProgress) => void;
  /** Persist the facts. Off in dry runs. */
  persist?: boolean;
  /** The buyer's brief, used to plan the questions. */
  requirements?: PurchaseRequirements;
}

export interface ResearchProgress {
  type:
    | 'plan'
    | 'search'
    | 'discover'
    | 'browse'
    | 'extract'
    | 'verify'
    | 'assess'
    | 'adapt'
    | 'normalize'
    | 'save'
    | 'complete'
    | 'failed';
  message: string;
  /** 0..1 across the run. */
  progress: number;
  elapsedMs: number;
  /** Facts collected so far. */
  factCount: number;
  /** The round number, 1-based. */
  round: number;
}

export interface ResearchTarget {
  productId: string;
  variantId: string | null;
  category: CategoryId;
  brand: string;
  model: string;
  /** Display name, used as a search term. */
  displayName?: string;
  /** The exact configuration under research, e.g. "16GB / 512GB". */
  variantLabel?: string | null;
}

const DEFAULTS = {
  deadlineMs: 60_000,
  pageConcurrency: 3,
  searchConcurrency: 4,
  maxPages: 16,
  maxResultsPerQuery: 8,
  maxRounds: 3,
};

/* ------------------------------------------------------------------ */
/* Per-domain politeness                                                */
/* ------------------------------------------------------------------ */

/**
 * Minimum interval between requests to the same domain.
 *
 * Researching one product can legitimately touch several pages on the same
 * retailer. Firing at them all at once is rude and gets a client blocked.
 */
const DOMAIN_INTERVAL_MS = 1_500;

const lastRequestAt = new Map<string, number>();

/** Wait until the domain is due for another request. */
async function respectDomainInterval(domain: string, signal?: AbortSignal): Promise<void> {
  const last = lastRequestAt.get(domain) ?? 0;
  const wait = last + DOMAIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Research cancelled'));
        },
        { once: true },
      );
    });
  }
  lastRequestAt.set(domain, Date.now());
}

/** Reset the domain throttle. Used by tests. */
export function resetDomainThrottle(): void {
  lastRequestAt.clear();
}

/* ------------------------------------------------------------------ */
/* Page classification                                                 */
/* ------------------------------------------------------------------ */

/** What kind of page a URL is likely to be. */
export type PageType = 'manufacturer' | 'retailer' | 'review_site' | 'community' | 'documentation' | 'unknown';

/** Classify a URL by its domain against known patterns. */
export function classifyPage(url: string, preferredDomains: string[] = []): PageType {
  let domain = '';
  try {
    domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }

  const matches = (list: string[]): boolean =>
    list.some((entry) => domain === entry || domain.endsWith(`.${entry}`));

  if (
    matches([
      'amazon.in',
      'flipkart.com',
      'croma.com',
      'reliancedigital.in',
      'vijaysales.com',
      'myntra.com',
      'ajio.com',
      'nykaa.com',
      'tatacliq.com',
      'jiomart.com',
      'bigbasket.com',
      'blinkit.com',
      'zeptonow.com',
      'pepperfry.com',
      'ikea.com',
      'partsofsource.com',
      'autodoc.in',
    ])
  ) {
    return 'retailer';
  }

  if (
    matches([
      'smartprix.com',
      '91mobiles.com',
      'gadget360.com',
      'digit.in',
      'rtings.com',
      'notebookcheck.net',
      'gsmarena.com',
      'techradar.com',
      'indiatoday.in',
    ])
  ) {
    return 'review_site';
  }

  if (matches(['reddit.com', 'quora.com', '4chan.com', 'medium.com', 'youtube.com'])) {
    return 'community';
  }

  if (matches(['bis.gov.in', 'fssai.gov.in', 'consumer.gov.in', 'wikipedia.org'])) {
    return 'documentation';
  }

  if (preferredDomains.length > 0 && matches(preferredDomains)) return 'manufacturer';

  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\/(product|products|p|shop|item|dp)\//.test(path)) return 'retailer';
    if (/\/(specs?|specifications?|support|product-detail)\b/.test(path)) return 'manufacturer';
  } catch {
    /* fall through */
  }

  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

interface DiscoveredPage {
  url: string;
  domain: string;
  title: string;
  snippet: string | null;
  pageType: PageType;
  provider: string;
  score: number;
}

/** Run a deep research investigation and return the facts it found. */
export async function runResearch(
  target: ResearchTarget,
  options: ResearchOptions = {},
): Promise<ResearchRun> {
  const started = Date.now();
  const deadlineMs = options.deadlineMs ?? DEFAULTS.deadlineMs;
  const maxPages = options.maxPages ?? DEFAULTS.maxPages;
  const maxRounds = options.maxRounds ?? DEFAULTS.maxRounds;
  const runId = randomUUID();
  const emit = options.onProgress ?? (() => {});

  const requirements: PurchaseRequirements = options.requirements ?? {
    category: target.category,
    priorities: {},
    mustHaves: [],
    niceToHaves: [],
    workloads: [],
    missingInfo: [],
  };

  const memory = new ResearchMemory();
  const graph = new EvidenceGraph();
  const steps: ResearchStepOutcome[] = [];
  const failures: ResearchRun['failures'] = [];
  const notes: string[] = [];

  let pagesOpened = 0;
  let searchCount = 0;
  let searchCostUsd = 0;
  let browserSessions = 0;
  let round = 0;
  let previousRoundFacts = 0;
  let allFacts: ResearchFact[] = [];
  let allConflicts: ResearchConflict[] = [];
  const discoveredProducts = new Map<string, NormalizedProduct>();
  const reviewSources = new Map<string, ReviewSource>();
  const collectedReviews: Review[] = [];
  const acquisitionQueries: ResearchRun['queries'] = [];
  const unavailableSources: ResearchRun['unavailableSources'] = [];

  const remaining = (): number => deadlineMs - (Date.now() - started);
  const expired = (): boolean => remaining() <= 0;

  const report = (
    type: ResearchProgress['type'],
    message: string,
    progress: number,
    factCount: number,
  ): void => {
    emit({
      type,
      message,
      progress: Math.min(1, Math.max(0, progress)),
      elapsedMs: Date.now() - started,
      factCount,
      round,
    });
  };

  /* ---------------- Plan ---------------- */
  const plan = buildResearchPlan(target, requirements);
  const skills = skillsForCategory(target.category);
  let tasks: ResearchTask[] = plan.tasks;

  report(
    'plan',
    `Planned ${plan.questions.length} research questions and ${tasks.length} investigation tasks across ${skills.length} skills.`,
    0.03,
    0,
  );

  if (tasks.length === 0) {
    notes.push(
      `No research skill is registered for the "${target.category}" category, so no web investigation was planned.`,
    );
  }

  const providers = configuredSearchProviders();
  if (providers.length === 0 && tasks.length > 0) {
    notes.push(
      'No search provider is configured, so no web discovery was possible. DuckDuckGo works without a key; set SEARXNG_BASE_URL or EXA_API_KEY for better coverage.',
    );
  }

  /* ---------------- The investigation loop ---------------- */
  let readiness = assessReadiness({
    questions: plan.questions,
    facts: [],
    conflicts: [],
    previousRoundFacts: 0,
    currentRoundFacts: 0,
    rounds: 0,
    maxRounds,
    timeExhausted: false,
    budgetExhausted: false,
  });

  while (round < maxRounds && !readiness.ready) {
    round += 1;
    const roundStart = Date.now();

    if (expired()) {
      readiness = {
        ...readiness,
        ready: true,
        reason: 'time_exhausted',
        explanation: 'The research deadline was reached.',
      };
      break;
    }

    /* -------- 1. Acquire -------- */
    // Two independent channels run together: the retailer adapters, which
    // go straight to each retailer's own search, and the search engines,
    // which surface the retailers that do not index well plus the
    // independent reviews and community discussions.
    const hits: SearchHit[] = [];
    const roundTasks = tasks;

    // The queries that have not been run yet.
    const freshTasks = roundTasks.filter((task) => !memory.hasQuery(task.query));

    if (freshTasks.length === 0) {
      steps.push({
        skillId: 'acquire',
        purpose: 'identify',
        query: null,
        url: null,
        status: 'skipped',
        reason: 'Every query for this round was already issued in an earlier round.',
        elapsedMs: 0,
        factCount: 0,
        usedBrowser: false,
        attempts: 0,
      });
    } else if (expired()) {
      steps.push({
        skillId: 'acquire',
        purpose: 'identify',
        query: null,
        url: null,
        status: 'skipped',
        reason: 'The run deadline was reached before acquisition could start.',
        elapsedMs: 0,
        factCount: 0,
        usedBrowser: false,
        attempts: 0,
      });
    } else {
      // A browser is opened for the retailer channel when the retailers
      // that need one are in the running. It is opened once and shared.
      let acquisitionBrowser: Browser | null = null;
      if (options.allowBrowser ?? true) {
        try {
          acquisitionBrowser = await connectBrowser();
          if (acquisitionBrowser) browserSessions += 1;
        } catch {
          acquisitionBrowser = null;
        }
      }

      let acquisition;
      try {
        acquisition = await acquire(
          freshTasks.map((task) => task.query),
          {
            limit: options.maxResultsPerQuery ?? DEFAULTS.maxResultsPerQuery,
            deadlineMs: Math.min(30_000, remaining()),
            retailerConcurrency: options.pageConcurrency ?? DEFAULTS.pageConcurrency,
            searchConcurrency: options.searchConcurrency ?? DEFAULTS.searchConcurrency,
            categories: [target.category],
            browser: acquisitionBrowser,
          },
        );
      } finally {
        if (acquisitionBrowser) {
          await acquisitionBrowser.dispose().catch(() => {});
        }
      }

      hits.push(...acquisition.pages);
      acquisitionQueries.push(...acquisition.queries);
      searchCostUsd += acquisition.costUsd;
      searchCount += acquisition.queries.length;

      for (const unavailable of acquisition.unavailable) {
        if (unavailableSources.some((entry) => entry.id === unavailable.id)) continue;
        unavailableSources.push(unavailable);
      }

      for (const task of freshTasks) {
        memory.rememberQuery(task.query, 0);
      }

      steps.push({
        skillId: 'acquire',
        purpose: 'identify',
        query: `${freshTasks.length} queries across ${acquisition.adaptersUsed.length} retailer adapters and ${acquisition.providersUsed.length} search providers`,
        url: null,
        status: acquisition.pages.length > 0 ? 'ok' : 'empty',
        reason:
          acquisition.pages.length > 0
            ? null
            : 'No retailer adapter and no search provider returned a result for these queries.',
        elapsedMs: 0,
        factCount: acquisition.pages.length,
        usedBrowser: false,
        attempts: acquisition.queries.length,
      });
    }

    report(
      'search',
      `Round ${round}: ${searchCount} queries issued across ${acquisitionQueries.length > 0 ? 'retailer adapters and search providers' : 'no configured providers'}, ${hits.length} pages found.`,
      0.15 + round * 0.1,
      allFacts.length,
    );

    /* -------- 2. Discover -------- */
    const preferredDomains = [...new Set(roundTasks.flatMap((task) => task.preferredDomains))];
    const discovered = discoverPages(hits, preferredDomains).filter(
      (page) => !memory.hasPage(page.url),
    );
    report('discover', `Round ${round}: ${discovered.length} new pages selected to open.`, 0.2 + round * 0.1, allFacts.length);

    /* -------- 3. Browse + 4. Extract -------- */
    const budgetLeft = Math.max(0, maxPages - pagesOpened);
    const pagesToOpen = discovered.slice(0, budgetLeft);
    const roundRaw: RawFact[] = [];

    await mapConcurrent(
      pagesToOpen,
      options.pageConcurrency ?? DEFAULTS.pageConcurrency,
      async (page) => {
        const stepStart = Date.now();
        await respectDomainInterval(page.domain);

        // --- HTTP first ---
        const fetched = await fetchPage(page.url, {
          deadlineMs: Math.min(12_000, remaining()),
          retries: 1,
        });

        let html = fetched.html;
        let usedBrowser = false;
        let method: ExtractionMethod = 'meta_tag';

        if (fetched.html) {
          const probe = extractFacts(fetched.html);
          // --- Escalate to a browser only when HTTP did not answer ---
          if (needsBrowser(probe) && (options.allowBrowser ?? true)) {
            const rendered = await renderWithBrowser(page.url, remaining());
            if (rendered?.html) {
              html = rendered.html;
              usedBrowser = true;
              method = 'browser_dom';
              browserSessions += 1;
            }
          }
        } else if (fetched.error && (options.allowBrowser ?? true)) {
          const rendered = await renderWithBrowser(page.url, remaining());
          if (rendered?.html) {
            html = rendered.html;
            usedBrowser = true;
            method = 'browser_dom';
            browserSessions += 1;
          }
        }

        if (!html) {
          steps.push({
            skillId: 'browse',
            purpose: 'specify',
            query: null,
            url: page.url,
            status: fetched.robotsDecision === 'disallowed' ? 'blocked' : 'failed',
            reason: fetched.error ?? 'The page could not be retrieved.',
            elapsedMs: Date.now() - stepStart,
            factCount: 0,
            usedBrowser: false,
            attempts: fetched.attempts,
          });
          failures.push({
            url: page.url,
            reason: fetched.error ?? 'The page could not be retrieved.',
            source: 'http',
          });
          return;
        }

        pagesOpened += 1;
        memory.rememberPage(page.url, 0);

        const retrievedAt = fetched.page?.retrievedAt ?? new Date().toISOString();
        const finalUrl = fetched.page?.finalUrl ?? page.url;

        // --- Extract the product, through the tiered cascade ---
        // The cascade tries JSON-LD, then embedded JSON, then a known
        // retailer adapter, then the rendered page content. Whichever
        // tier succeeds is recorded on the product.
        const productOutcome = extractProduct(html, finalUrl, retrievedAt);

        if (productOutcome.product) {
          const normalised = productOutcome.product;
          const key = canonicalUrl(normalised.productUrl);
          if (!discoveredProducts.has(key)) {
            discoveredProducts.set(key, normalised);
          }
        }

        // --- Extract the individual facts ---
        const result: ExtractionResult = extractFacts(html);

        for (const extracted of result.facts) {
          roundRaw.push({
            extracted: {
              kind: extracted.kind,
              key: extracted.key,
              value: extracted.value,
              unit: extracted.unit ?? null,
              evidence: extracted.evidence,
              method: usedBrowser && method === 'browser_dom' ? 'browser_dom' : extracted.method,
              confidence: extracted.confidence,
            },
            url: finalUrl,
            domain: page.domain,
            retrievedAt,
            pageType: page.pageType,
          });
        }

        steps.push({
          skillId: 'browse',
          purpose: 'specify',
          query: null,
          url: page.url,
          status: result.facts.length > 0 ? 'ok' : 'empty',
          reason: result.facts.length > 0 ? null : 'The page yielded no extractable facts.',
          elapsedMs: Date.now() - stepStart,
          factCount: result.facts.length,
          usedBrowser,
          attempts: fetched.attempts,
        });
      },
    );

    report(
      'extract',
      `Round ${round}: ${pagesOpened} pages opened in total, ${roundRaw.length} candidate facts.`,
      0.4 + round * 0.1,
      allFacts.length,
    );

    /* -------- 5. Verify -------- */
    const verified = verifyFacts(roundRaw, {
      productId: target.productId,
      variantId: target.variantId,
      category: target.category,
      brand: target.brand,
      model: target.model,
      terms: target.displayName ?? `${target.brand} ${target.model}`,
      steps: [],
      skills: skills.map((skill) => skill.id),
      deadlineMs,
    });

    for (const fact of verified.facts) {
      graph.recordFact(fact, target.displayName ?? target.model, target.category);
    }
    for (const conflict of verified.conflicts) {
      graph.recordConflict(conflict);
    }

    // Merge with what earlier rounds found, keeping the more confident fact.
    const merged = new Map<string, ResearchFact>();
    for (const fact of [...allFacts, ...verified.facts]) {
      const key = `${fact.kind}::${fact.key}`;
      const existing = merged.get(key);
      if (!existing || fact.confidence > existing.confidence) merged.set(key, fact);
    }
    allFacts = [...merged.values()];
    allConflicts = [...allConflicts, ...verified.conflicts];

    // Remember what was learned.
    for (const fact of verified.facts) {
      memory.rememberFinding(
        `${fact.kind}.${fact.key}`,
        `${fact.key}: ${String(fact.value ?? 'unknown')}`,
        [fact.sourceUrl],
      );
    }

    report(
      'verify',
      `Round ${round}: ${allFacts.length} verified facts, ${allConflicts.length} conflicts preserved.`,
      0.55 + round * 0.1,
      allFacts.length,
    );

    /* -------- 6. Assess readiness -------- */
    readiness = assessReadiness({
      questions: plan.questions,
      facts: allFacts,
      conflicts: allConflicts,
      previousRoundFacts,
      currentRoundFacts: verified.facts.length,
      rounds: round,
      maxRounds,
      timeExhausted: expired(),
      budgetExhausted: pagesOpened >= maxPages,
    });

    report(
      'assess',
      `Round ${round}: ${readiness.explanation}`,
      0.6 + round * 0.1,
      allFacts.length,
    );

    if (readiness.ready) break;

    /* -------- 7. Adapt -------- */
    const risks = allConflicts.map(
      (conflict) => `${conflict.key} conflicting between sources`,
    );
    const followUps = buildFollowUpTasks(
      plan,
      {
        unanswered: readiness.unanswered,
        conflicted: readiness.conflicted,
        risks,
      },
      {
        brand: target.brand,
        model: target.model,
        terms: target.displayName ?? `${target.brand} ${target.model}`,
        variant: target.variantLabel ?? '',
      },
    );

    if (followUps.length === 0) {
      readiness = { ...readiness, ready: true, reason: 'insufficient_evidence' };
      break;
    }

    report(
      'adapt',
      `Round ${round}: the gaps produced ${followUps.length} new investigation tasks.`,
      0.65 + round * 0.1,
      allFacts.length,
    );

    tasks = followUps;
    previousRoundFacts = verified.facts.length;
  }

  /* ---------------- Normalise ---------------- */
  const normalised = normaliseFacts(allFacts, {
    productId: target.productId,
    variantId: target.variantId,
    category: target.category,
    brand: target.brand,
    model: target.model,
    terms: target.displayName ?? `${target.brand} ${target.model}`,
    steps: [],
    skills: skills.map((skill) => skill.id),
    deadlineMs,
  });
  report('normalize', `Normalised ${normalised.length} facts onto the ${target.category} schema.`, 0.9, normalised.length);

  /* ---------------- Save ---------------- */
  if (options.persist !== false) {
    try {
      saveResearchFacts(normalised, {
        runId,
        productId: target.productId,
        variantId: target.variantId,
        category: target.category,
        startedAt: new Date(started).toISOString(),
      });
      report('save', `Saved ${normalised.length} facts with provenance.`, 0.95, normalised.length);
    } catch (error) {
      failures.push({
        url: null,
        reason: `Could not save research facts: ${error instanceof Error ? error.message : String(error)}`,
        source: 'store',
      });
      notes.push('Research findings could not be written to the database.');
    }
  }

  const finishedAt = new Date().toISOString();
  const memorySummary = memory.summary();

  notes.push(
    `Research ran ${round} round${round === 1 ? '' : 's'} and stopped because the evidence was ${readiness.reason.replace(/_/g, ' ')}.`,
  );
  if (readiness.missingKinds.length > 0) {
    notes.push(
      `No source published: ${readiness.missingKinds.join(', ')}. These are reported as unknown rather than estimated.`,
    );
  }
  if (memorySummary.queriesRun > 0) {
    notes.push(
      `${memorySummary.queriesRun} distinct search${memorySummary.queriesRun === 1 ? '' : 'es'} were run across ${memorySummary.domains.length} source domain${memorySummary.domains.length === 1 ? '' : 's'}.`,
    );
  }

  report('complete', `Research complete: ${normalised.length} facts from ${pagesOpened} pages.`, 1, normalised.length);

  return {
    id: runId,
    productId: target.productId,
    variantId: target.variantId,
    category: target.category,
    startedAt: new Date(started).toISOString(),
    finishedAt,
    elapsedMs: Date.now() - started,
    facts: normalised,
    steps,
    failures,
    conflicts: allConflicts,
    searchCount,
    pageCount: pagesOpened,
    browserSessions,
    costUsd: Number(searchCostUsd.toFixed(6)),
    empty: normalised.length === 0 && discoveredProducts.size === 0,
    products: [...discoveredProducts.values()],
    queries: acquisitionQueries,
    unavailableSources,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Render a page in a browser, if one is reachable. */
async function renderWithBrowser(
  url: string,
  remainingMs: number,
): Promise<{ html: string } | null> {
  if (remainingMs <= 2_000) return null;

  let browser: Browser | null = null;
  try {
    browser = await connectBrowser();
    if (!browser) return null;

    const page = await browser.newPage();
    try {
      await page.goto(url, Math.min(20_000, remainingMs));
      await page.scrollThrough(3);
      const html = await page.content();
      return { html };
    } finally {
      await page.close().catch(() => {});
      await browser.dispose().catch(() => {});
    }
  } catch {
    return null;
  }
}

/**
 * Turn search hits into a ranked list of pages to open.
 *
 * Pages the skill trusts come first; duplicates are removed; and a page is
 * only opened once however many queries or providers found it.
 */
export function discoverPages(hits: SearchHit[], preferredDomains: string[] = []): DiscoveredPage[] {
  const seen = new Set<string>();
  const discovered: DiscoveredPage[] = [];

  const typeRank = (pageType: PageType): number => {
    const order: PageType[] = ['manufacturer', 'retailer', 'review_site', 'community', 'documentation', 'unknown'];
    const index = order.indexOf(pageType);
    return index === -1 ? order.length : index;
  };

  const scored = hits
    .map((hit) => {
      const pageType = classifyPage(hit.url, preferredDomains);
      return { hit, pageType, rank: typeRank(pageType) * 2 - (hit.score ?? 0.5) };
    })
    .sort((a, b) => a.rank - b.rank);

  for (const entry of scored) {
    const key = normaliseUrlKey(entry.hit.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    discovered.push({
      url: entry.hit.url,
      domain: entry.hit.domain,
      title: entry.hit.title,
      snippet: entry.hit.snippet,
      pageType: entry.pageType,
      provider: entry.hit.provider,
      score: entry.hit.score ?? 0.5,
    });
  }

  return discovered;
}

function normaliseUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Build the research plan for a product from its category's skills.
 *
 * Retained for callers that want the plan without running it.
 */
export function planResearch(
  target: ResearchTarget,
  requirements: PurchaseRequirements = {
    category: target.category,
    priorities: {},
    mustHaves: [],
    niceToHaves: [],
    workloads: [],
    missingInfo: [],
  },
): {
  productId: string;
  variantId: string | null;
  category: CategoryId;
  brand: string;
  model: string;
  terms: string;
  steps: ResearchPlanStep[];
  skills: string[];
  deadlineMs: number;
} {
  const plan = buildResearchPlan(target, requirements);
  const skills = skillsForCategory(target.category);

  return {
    productId: target.productId,
    variantId: target.variantId,
    category: target.category,
    brand: target.brand,
    model: target.model,
    terms: target.displayName ?? `${target.brand} ${target.model}`,
    steps: plan.tasks.map((task) => ({
      skillId: task.questionId,
      query: task.query,
      purpose: 'specify',
      preferredDomains: task.preferredDomains,
      pagePreference: [task.sourceType],
      requiresBrowser: task.requiresBrowser,
      factKinds: task.factKinds,
      limit: task.limit,
    })),
    skills: skills.map((skill) => skill.id),
    deadlineMs: DEFAULTS.deadlineMs,
  };
}

/** Cached research for a product, keyed by the freshness policy. */
export async function researchForProduct(
  productId: string,
  target: ResearchTarget,
  options: ResearchOptions = {},
): Promise<ResearchRun> {
  const key = `research:${productId}:${target.variantId ?? 'model'}`;
  const result = await cached('product_identity', key, () => runResearch(target, options));
  return result.value;
}

/** The search providers that are configured, for the Sources screen. */
export function researchProviderStatus(): {
  id: string;
  name: string;
  engine: string;
  configured: boolean;
  reason: string | null;
  costPerQueryUsd: number | null;
  rateLimitPerMinute: number | null;
}[] {
  return searchProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    engine: provider.engine,
    configured: provider.configured,
    reason: provider.reason,
    costPerQueryUsd: provider.costPerQueryUsd,
    rateLimitPerMinute: provider.rateLimitPerMinute,
  }));
}

export { ResearchMemory, EvidenceGraph };

/** A stable id for a fact. */
export function factId(productId: string, variantId: string | null, kind: string, key: string): string {
  return createHash('sha1')
    .update(`${productId}|${variantId ?? ''}|${kind}|${key}`)
    .digest('hex')
    .slice(0, 16);
}
