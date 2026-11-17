/**
 * SahiPick HTTP API.
 *
 * Every response that contains externally-sourced facts also carries the
 * provenance so the client can label sample vs live data. Routes never
 * fabricate data: when a source is unavailable the response says so.
 */

import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../config.ts';
import { applySchema } from '../db/index.ts';
import {
  getProduct,
  listProducts,
  searchProducts,
  listPricePoints,
} from '../db/repositories.ts';
import { buildComparison, buildProductView } from './services/product-view.ts';
import { searchAllProviders, providerHealth, listProviders } from '../retailers/registry.ts';
import { registerRetailerProviders } from '../retailers/providers.ts';
import { buildRecommendationSet } from '../intelligence/recommendations/scoring.ts';
import { buildCandidates } from './services/product-view.ts';
import { buildDecisionCandidates } from './services/decision-candidates.ts';
import { buildDecisions } from '../intelligence/decision/engine.ts';
import { runResearch, researchProviderStatus } from '../research/orchestrator.ts';
import { acquire } from '../research/acquisition.ts';
import { extractProduct } from '../research/extract/pipeline.ts';
import { retailerAdapterStatus } from '../research/sources/retailers.ts';
import '../research/sources/retailer-india.ts';
import { fetchPage } from '../research/sources/http.ts';
import { browserStatus } from '../research/sources/browser.ts';
import { factsForProduct, lastRunForProduct, priceObservations } from '../research/store.ts';
import { allSkills, categoriesWithSkills } from '../research/skills/index.ts';
import { parseRequirements, describeRequirements } from '../ai/intent.ts';
import {
  answerQuestion,
  describeGaps,
  describeProfile,
  getConversation,
  isProfileSufficient,
  outstandingQuestions,
  skipQuestion,
  startConversation,
} from '../ai/conversation.ts';
import { runDecisionPipeline } from '../ai/pipeline.ts';
import { getActiveProvider } from '../ai/provider.ts';
import { metricsSnapshot, recordCounter, recordTiming } from '../intelligence/metrics.ts';
import { cacheStats } from '../intelligence/cache/cache.ts';
import { FRESHNESS } from '../intelligence/cache/freshness.ts';
import { formatPaise } from '../intelligence/normalize/specs.ts';
import { computePriceStats } from '../intelligence/pricehistory/stats.ts';

export interface ShopperQuery {
  bank?: string | null;
  cardType?: 'credit' | 'debit' | null;
  membershipTier?: string | null;
  exchangeEligible?: boolean;
  emiTenureMonths?: number | null;
  [key: string]: unknown;
}

function shopperFromRequest(request: Request): ShopperQuery {
  const query = request.query as Record<string, string | undefined>;
  const cardType = query.cardType;
  const emiTenure = query.emiTenure ? Number.parseInt(query.emiTenure, 10) : null;
  return {
    bank: query.bank ?? null,
    cardType: cardType === 'credit' || cardType === 'debit' ? cardType : null,
    membershipTier: query.membershipTier ?? null,
    exchangeEligible: query.exchange === 'true',
    emiTenureMonths: Number.isFinite(emiTenure) ? emiTenure : null,
  };
}

function sendError(response: Response, status: number, code: string, message: string, details?: unknown): void {
  response.status(status).json({ error: { code, message, details: details ?? null } });
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  applySchema();
  registerRetailerProviders();

  /* ---------------------------------------------------------------- */
  /* System                                                            */
  /* ---------------------------------------------------------------- */

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'sahipick',
      version: '0.1.0',
      time: new Date().toISOString(),
      aiProvider: config.aiProvider,
      remoteLlmConfigured: Boolean(config.aiBaseUrl && config.aiModel && config.aiApiKey),
      timeZone: 'Asia/Kolkata',
    });
  });

  app.get('/api/providers', async (_request, response) => {
    const health = await providerHealth();
    response.json({
      providers: health,
      note:
        'A provider that is not configured returns no products. SahiPick never substitutes demo data for a source it could not read.',
    });
  });

  /* ---------------------------------------------------------------- */
  /* Catalogue                                                         */
  /* ---------------------------------------------------------------- */

  app.get('/api/products', (request, response) => {
    const category = typeof request.query.category === 'string' ? request.query.category : undefined;
    const term = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const products = term ? searchProducts(term, category) : listProducts(category);
    response.json({
      count: products.length,
      products: products.map((product) => ({
        id: product.id,
        displayName: product.displayName,
        brand: product.brand,
        model: product.model,
        category: product.category,
        imageUrl: product.imageUrl,
        highlights: product.highlights,
      })),
    });
  });

  app.get('/api/products/:id', (request, response) => {
    const view = buildProductView(request.params.id ?? '', {
      shopper: shopperFromRequest(request),
    });
    if (!view) {
      sendError(response, 404, 'not_found', 'No product with that id exists in the catalogue.');
      return;
    }
    response.json({
      ...view,
      priceHistory: listPricePoints(request.params.id ?? '').length > 0
        ? view.listings.map((listing) => ({
            listingId: listing.listing.id,
            stats: listing.priceStats,
          }))
        : [],
      formatted: {
        bestPayable: formatPaise(view.bestPayablePaise),
      },
    });
  });

  app.get('/api/products/:id/price-history', (request, response) => {
    const listingId = typeof request.query.listingId === 'string' ? request.query.listingId : null;
    const listingRows = buildProductView(request.params.id ?? '', { includePriceHistory: false });
    if (!listingRows) {
      sendError(response, 404, 'not_found', 'No product with that id exists.');
      return;
    }
    const target = listingId
      ? listingRows.listings.find((listing) => listing.listing.id === listingId)
      : listingRows.listings[0];
    if (!target) {
      sendError(response, 404, 'not_found', 'No listing found for that product.');
      return;
    }
    const points = listPricePoints(target.listing.id);
    response.json({
      listingId: target.listing.id,
      retailer: target.listing.retailer,
      provenance: target.listing.provenance,
      points: points.map((point) => ({
        pricePaise: point.pricePaise,
        recordedAt: point.recordedAt,
        origin: point.provenance.origin,
      })),
      stats: computePriceStats(points),
      buyWait: target.buyWait,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Discovery                                                        */
  /* ---------------------------------------------------------------- */

  app.get('/api/discover', async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q : '';
    const category = typeof request.query.category === 'string' ? request.query.category : undefined;

    const catalogue = query
      ? searchProducts(query, category)
      : listProducts(category);

    const remote = await searchAllProviders(query, {
      category: (category as never) ?? null,
      limit: 24,
    });

    response.json({
      catalogue: catalogue.map((product) => ({
        id: product.id,
        displayName: product.displayName,
        brand: product.brand,
        category: product.category,
        imageUrl: product.imageUrl,
        highlights: product.highlights,
      })),
      providers: remote.outcomes,
      note:
        'Catalogue entries are the bundled sample catalogue. Provider outcomes show which live retailers responded and which could not be read.',
    });
  });

  app.post('/api/links/inspect', async (request, response) => {
    const url = typeof request.body?.url === 'string' ? request.body.url : '';
    if (!url) {
      sendError(response, 400, 'invalid_request', 'A product URL is required.');
      return;
    }
    const provider = listProviders().find((entry) => entry.terms.accessMethod === 'public_page');
    if (!provider) {
      sendError(response, 503, 'provider_unavailable', 'No public-page provider is registered.');
      return;
    }
    const result = await provider.getProduct(url);
    if (result.status !== 'ok') {
      const reason = result.status === 'error' ? result.message : result.reason;
      const hint = result.status === 'error' ? null : (result.hint ?? null);
      response.status(result.status === 'error' ? 502 : 422).json({
        status: result.status,
        reason,
        hint,
        observedAt: result.observedAt,
      });
      return;
    }
    response.json({ status: 'ok', listings: result.data, observedAt: result.observedAt, source: result.source });
  });

  /* ---------------------------------------------------------------- */
  /* Recommendations & comparison                                     */
  /* ---------------------------------------------------------------- */

  app.post('/api/recommendations', (request, response) => {
    const rawQuery = typeof request.body?.query === 'string' ? request.body.query : '';
    const requirements = parseRequirements(rawQuery, request.body?.requirements ?? {});
    const shopper = shopperFromRequest(request);

    const { candidates, notes } = buildCandidates(requirements.category ?? undefined, requirements, shopper);
    const result = buildRecommendationSet(candidates, requirements);

    response.json({
      ...result,
      requirementSummary: describeRequirements(requirements),
      notes: [...notes, ...result.dataQualityNotes],
      missingInfo: requirements.missingInfo,
    });
  });

  app.post('/api/compare', (request, response) => {
    const productIds = Array.isArray(request.body?.productIds) ? (request.body.productIds as string[]) : [];
    if (productIds.length < 2) {
      sendError(response, 400, 'invalid_request', 'Provide at least two product ids to compare.');
      return;
    }
    const result = buildComparison(productIds.slice(0, 4), shopperFromRequest(request));
    response.json(result);
  });

  /* ---------------------------------------------------------------- */
  /* Buying conversation                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Start a buying conversation.
   *
   * The shopper's opening message is turned into a buyer profile and a small
   * number of *conditional* follow-up questions — the ones whose answers
   * would actually change the shortlist.
   */
  app.post('/api/conversation', (request, response) => {
    const message = typeof request.body?.message === 'string' ? request.body.message : '';
    if (!message.trim()) {
      sendError(response, 400, 'invalid_request', 'Say what you are looking for.');
      return;
    }

    const session = startConversation(message);
    const questions = outstandingQuestions(session);

    response.json({
      sessionId: session.id,
      profile: session.profile,
      profileSummary: describeProfile(session.profile),
      gaps: describeGaps(session.profile),
      sufficient: isProfileSufficient(session.profile),
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        why: question.why,
        options: question.options?.map((option) => ({ label: option.label, value: option.value })) ?? [],
        allowDelegate: question.allowDelegate,
      })),
      delegated: session.delegated,
      nextStep: isProfileSufficient(session.profile)
        ? 'ready'
        : questions.length > 0
          ? 'question'
          : 'ready',
    });
  });

  /** Answer a question in a conversation. */
  app.post('/api/conversation/:id/answer', (request, response) => {
    const sessionId = request.params.id ?? '';
    const questionId = typeof request.body?.questionId === 'string' ? request.body.questionId : '';
    const answer = typeof request.body?.answer === 'string' ? request.body.answer : '';

    const result = answerQuestion(sessionId, questionId, answer);
    if (!result.session) {
      sendError(response, 404, 'not_found', 'No such conversation.');
      return;
    }
    if (result.error) {
      sendError(response, 400, 'invalid_request', result.error);
      return;
    }

    const session = result.session;
    const questions = outstandingQuestions(session);

    response.json({
      sessionId: session.id,
      profile: session.profile,
      profileSummary: describeProfile(session.profile),
      gaps: describeGaps(session.profile),
      sufficient: isProfileSufficient(session.profile),
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        why: question.why,
        options: question.options?.map((option) => ({ label: option.label, value: option.value })) ?? [],
        allowDelegate: question.allowDelegate,
      })),
      delegated: session.delegated,
      turns: session.turns,
      nextStep: isProfileSufficient(session.profile)
        ? 'ready'
        : questions.length > 0
          ? 'question'
          : 'ready',
    });
  });

  /** Skip a question. */
  app.post('/api/conversation/:id/skip', (request, response) => {
    const sessionId = request.params.id ?? '';
    const questionId = typeof request.body?.questionId === 'string' ? request.body.questionId : '';
    const result = skipQuestion(sessionId, questionId);
    if (!result.session) {
      sendError(response, 404, 'not_found', 'No such conversation.');
      return;
    }
    const session = result.session;
    const questions = outstandingQuestions(session);
    response.json({
      sessionId: session.id,
      profile: session.profile,
      profileSummary: describeProfile(session.profile),
      gaps: describeGaps(session.profile),
      sufficient: isProfileSufficient(session.profile),
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        why: question.why,
        options: question.options?.map((option) => ({ label: option.label, value: option.value })) ?? [],
        allowDelegate: question.allowDelegate,
      })),
      delegated: session.delegated,
      nextStep: isProfileSufficient(session.profile) ? 'ready' : 'question',
    });
  });

  /** Read a conversation. */
  app.get('/api/conversation/:id', (request, response) => {
    const session = getConversation(request.params.id ?? '');
    if (!session) {
      sendError(response, 404, 'not_found', 'No such conversation.');
      return;
    }
    response.json({
      sessionId: session.id,
      profile: session.profile,
      profileSummary: describeProfile(session.profile),
      gaps: describeGaps(session.profile),
      sufficient: isProfileSufficient(session.profile),
      turns: session.turns,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Decision intelligence                                              */
  /* ---------------------------------------------------------------- */

  /**
   * The decision engine's output for a brief, with the full decision trace.
   *
   * This is the multi-dimensional evaluation: hard constraints first, then
   * the eight intelligence dimensions, then the trace explaining the result.
   */
  app.post('/api/decide', (request, response) => {
    const rawQuery = typeof request.body?.query === 'string' ? request.body.query : '';
    const requirements = parseRequirements(rawQuery, request.body?.requirements ?? {});
    const shopper = shopperFromRequest(request);

    const candidates = buildDecisionCandidates({
      shopper,
      category: requirements.category ?? undefined,
    });

    const result = buildDecisions(candidates, requirements, { limit: 6 });

    response.json({
      requirements,
      requirementSummary: describeRequirements(requirements),
      generatedAt: result.generatedAt,
      considered: result.considered,
      decisions: result.decisions.map((decision) => ({
        productId: decision.productId,
        displayName: decision.displayName,
        brand: decision.brand,
        imageUrl: decision.imageUrl,
        score: decision.score,
        confidence: decision.confidence,
        reviewDependence: decision.reviewDependence,
        pricePaise: decision.pricePaise,
        priceLabel: formatPaise(decision.pricePaise),
        priceIsSample: decision.priceIsSample,
        retailer: decision.retailer,
        totalOwnershipCostPaise: decision.totalOwnershipCostPaise,
        totalOwnershipCostLabel: formatPaise(decision.totalOwnershipCostPaise),
        strengths: decision.strengths,
        weaknesses: decision.weaknesses,
        dimensions: decision.dimensions.map((dimension) => ({
          id: dimension.id,
          label: dimension.label,
          score: dimension.score,
          weight: dimension.weight,
          hasEvidence: dimension.hasEvidence,
          confidence: dimension.confidence,
          summary: dimension.summary,
          missing: dimension.missing,
          conflicts: dimension.conflicts,
          evidenceCount: dimension.evidence.length,
        })),
        evidence: decision.evidence.map((item) => ({
          class: item.class,
          statement: item.statement,
          dimension: item.dimension,
          source: item.source.label,
          sourceUrl: item.source.url,
          observedAt: item.observedAt,
          freshness: item.freshness,
          confidence: item.confidence,
          corroborated: item.corroborated,
          disputed: item.disputed,
          excerpt: item.excerpt,
        })),
        trace: decision.trace,
      })),
      eliminated: result.eliminated,
      trace: result.trace,
      limitations: result.limitations,
      missingInfo: requirements.missingInfo,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Web research                                                      */
  /* ---------------------------------------------------------------- */

  /** Which search providers are usable, and at what cost. */
  app.get('/api/research/providers', (_request, response) => {
    response.json({
      providers: researchProviderStatus(),
      retailers: retailerAdapterStatus(),
      browser: browserStatus(),
      enabled: config.enableWebResearch,
      note: config.enableWebResearch
        ? 'Web research is enabled. Live facts are labelled with their source and timestamp.'
        : 'Web research is off. Set ENABLE_WEB_RESEARCH=1 to turn it on; the platform works without it.',
    });
  });

  /**
   * Run a product discovery acquisition without the full research loop.
   *
   * This is the "find me the products" step on its own, so the UI can
   * show a shortlist while the deeper research is still running.
   */
  app.post('/api/research/discover', async (request, response) => {
    const query = typeof request.body?.query === 'string' ? request.body.query : '';
    const category = typeof request.body?.category === 'string' ? request.body.category : null;
    const limit = typeof request.body?.limit === 'number' ? request.body.limit : 10;

    if (!query.trim()) {
      sendError(response, 400, 'invalid_request', 'A search query is required.');
      return;
    }

    try {
      const result = await acquire([query], {
        limit,
        categories: category ? [category] : [],
        deadlineMs: 30_000,
      });

      response.json({
        query,
        pages: result.pages,
        queries: result.queries,
        costUsd: result.costUsd,
        adaptersUsed: result.adaptersUsed,
        providersUsed: result.providersUsed,
        unavailable: result.unavailable,
        count: result.pages.length,
      });
    } catch (error) {
      sendError(
        response,
        500,
        'acquisition_error',
        error instanceof Error ? error.message : 'Product discovery failed.',
      );
    }
  });

  /**
   * Extract a normalised product from a page.
   *
   * The tiered cascade runs here, and the response says which tier
   * produced the result.
   */
  app.post('/api/research/extract', async (request, response) => {
    const url = typeof request.body?.url === 'string' ? request.body.url : '';
    if (!url.trim()) {
      sendError(response, 400, 'invalid_request', 'A page URL is required.');
      return;
    }

    try {
      const fetched = await fetchPage(url, { deadlineMs: 12_000, retries: 1 });
      if (!fetched.html) {
        sendError(
          response,
          422,
          'extraction_failed',
          fetched.error ?? 'The page could not be retrieved.',
        );
        return;
      }

      const outcome = extractProduct(
        fetched.html,
        fetched.page?.finalUrl ?? url,
        fetched.page?.retrievedAt ?? new Date().toISOString(),
      );

      response.json({
        product: outcome.product,
        tier: outcome.tier,
        evidence: outcome.evidence,
        reason: outcome.reason,
        robotsDecision: fetched.robotsDecision,
      });
    } catch (error) {
      sendError(
        response,
        500,
        'extraction_error',
        error instanceof Error ? error.message : 'Extraction failed.',
      );
    }
  });

  /** The research facts stored for a product. */
  app.get('/api/research/products/:id', (request, response) => {
    const productId = request.params.id ?? '';
    const facts = factsForProduct(productId);
    response.json({
      productId,
      facts,
      lastRun: lastRunForProduct(productId),
      observations: priceObservations(productId),
    });
  });

  /**
   * Run web research for one product.
   *
   * The search → discover → browse → extract → verify → normalise → save
   * workflow. Results carry their source URL, timestamp and confidence.
   */
  app.post('/api/research/products/:id', async (request, response) => {
    const productId = request.params.id ?? '';
    const product = getProduct(productId);
    if (!product) {
      sendError(response, 404, 'not_found', 'No product with that id exists.');
      return;
    }

    const run = await runResearch(
      {
        productId: product.id,
        variantId: null,
        category: product.category,
        brand: product.brand,
        model: product.model,
        displayName: product.displayName,
      },
      {
        deadlineMs: typeof request.body?.deadlineMs === 'number' ? request.body.deadlineMs : 45_000,
        allowBrowser: request.body?.allowBrowser !== false,
      },
    );

    response.json({
      id: run.id,
      productId: run.productId,
      category: run.category,
      elapsedMs: run.elapsedMs,
      searchCount: run.searchCount,
      pageCount: run.pageCount,
      browserSessions: run.browserSessions,
      costUsd: run.costUsd,
      empty: run.empty,
      notes: run.notes,
      failures: run.failures,
      conflicts: run.conflicts,
      steps: run.steps,
      facts: run.facts,
    });
  });

  /** The research skills registered for each category. */
  app.get('/api/research/skills', (_request, response) => {
    response.json({
      skills: allSkills().map((skill) => ({
        id: skill.id,
        name: skill.name,
        categories: skill.categories,
        objective: skill.objective,
        searches: skill.searches,
        preferredDomains: skill.preferredDomains,
        factKinds: skill.factKinds,
        requiresBrowser: skill.requiresBrowser,
        weight: skill.weight,
        notes: skill.notes ?? null,
      })),
      categoriesWithSkills: categoriesWithSkills(),
    });
  });

  app.get('/api/products/:id/price', (request, response) => {
    const view = buildProductView(request.params.id ?? '', { shopper: shopperFromRequest(request) });
    if (!view) {
      sendError(response, 404, 'not_found', 'No product with that id exists.');
      return;
    }
    response.json({
      productId: view.product.id,
      bestListingId: view.bestListingId,
      bestPayable: formatPaise(view.bestPayablePaise),
      listings: view.listings.map((listing) => ({
        listingId: listing.listing.id,
        retailer: listing.listing.retailer,
        title: listing.listing.title,
        url: listing.listing.url,
        inStock: listing.listing.inStock,
        provenance: listing.listing.provenance,
        breakdown: listing.breakdown,
        buyWait: listing.buyWait,
      })),
    });
  });

  /* ---------------------------------------------------------------- */
  /* Conversational agent                                             */
  /* ---------------------------------------------------------------- */

  app.post('/api/chat', async (request, response) => {
    const message = typeof request.body?.message === 'string' ? request.body.message : '';
    const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : 'default';
    if (!message.trim()) {
      sendError(response, 400, 'invalid_request', 'A message is required.');
      return;
    }
    try {
      const started = Date.now();
      const conversation = getConversation(sessionId);
      const result = await runDecisionPipeline({
        message,
        sessionId,
        profile: conversation?.profile ?? null,
        shopper: shopperFromRequest(request),
      });
      recordTiming('chat.total_ms', Date.now() - started);
      recordCounter('chat.requests');
      response.json(result);
    } catch (error) {
      sendError(
        response,
        500,
        'agent_error',
        error instanceof Error ? error.message : 'The shopping agent failed unexpectedly.',
      );
    }
  });

  /**
   * Streaming variant.
   *
   * Emits Server-Sent Events so the client can show real progress:
   * understanding the brief, finding products, checking variants, analysing
   * reviews, verifying prices, and finally the recommendation. The final
   * event carries the complete answer.
   */
  app.post('/api/chat/stream', async (request, response) => {
    const message = typeof request.body?.message === 'string' ? request.body.message : '';
    if (!message.trim()) {
      sendError(response, 400, 'invalid_request', 'A message is required.');
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown): void => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const started = Date.now();
      const streamSession = typeof request.body?.sessionId === 'string'
        ? getConversation(request.body.sessionId)
        : null;
      const result = await runDecisionPipeline(
        {
          message,
          sessionId: streamSession?.id ?? 'default',
          profile: streamSession?.profile ?? null,
          shopper: shopperFromRequest(request),
        },
        {
          providerId: getActiveProvider().id,
          onProgress: (event) => send('progress', event),
        },
      );
      recordTiming('chat.stream.total_ms', Date.now() - started);
      recordCounter('chat.stream.requests');
      send('result', result);
    } catch (error) {
      send('error', {
        message: error instanceof Error ? error.message : 'The shopping agent failed unexpectedly.',
      });
    } finally {
      response.end();
    }
  });

  /* ---------------------------------------------------------------- */
  /* Performance metrics                                              */
  /* ---------------------------------------------------------------- */

  app.get('/api/metrics', (_request, response) => {
    response.json({
      ...metricsSnapshot(),
      cache: cacheStats(),
      freshness: FRESHNESS,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Static web build (production single-process mode)                */
  /* ---------------------------------------------------------------- */

  if (config.serveWebBuild && existsSync(config.webDistPath)) {
    app.use(express.static(config.webDistPath));
    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.sendFile(join(config.webDistPath, 'index.html'));
    });
  }

  app.use((_request, response) => {
    sendError(response, 404, 'not_found', 'No such endpoint.');
  });

  return app;
}
