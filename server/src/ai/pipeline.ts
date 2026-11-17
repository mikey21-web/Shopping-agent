/**
 * Staged decision pipeline.
 *
 * The user should not stare at a spinner while the whole research process
 * runs. The pipeline is therefore split into visible stages, each of which
 * emits a progress event as it completes:
 *
 *   A  understand   — parse the brief, identify the category        (< 500 ms)
 *   B  discover     — retrieve candidates, apply hard constraints    (1–3 s)
 *   C  verify       — variants, prices, offers, reviews              (3–8 s)
 *   D  recommend    — score, rank, explain                           (final)
 *
 * Stages B, C and D run concurrently wherever the dependencies allow. A slow
 * source delays only its own stage, never the whole answer.
 *
 * Each stage is individually timed and reported, so the performance of the
 * system is measurable rather than assumed.
 */

import type { PurchaseRequirements, Recommendation } from '../domain/types.ts';
import { formatPaise } from '../intelligence/normalize/specs.ts';
import { buildProductView } from '../api/services/product-view.ts';
import { buildDecisionCandidates } from '../api/services/decision-candidates.ts';
import { buildDecisions, type DecisionSet } from '../intelligence/decision/engine.ts';
import { runResearch } from '../research/orchestrator.ts';
import { getTool, type Citation, type ToolContext } from './tools.ts';
import { parseRequirements, describeRequirements, findMissingInfo } from './intent.ts';
import {
  describeGaps,
  describeProfile,
  profileToRequirements,
  selectQuestions,
  type BuyerProfile,
} from './conversation.ts';
import { applyGuardrails, enforceBudget, type GuardrailViolation } from './guardrails.ts';
import { cached, cacheStats } from '../intelligence/cache/cache.ts';
import { config, hasRemoteLlm } from '../config.ts';
import { composeSynthesisWithModel, factsFromDecisions } from './synthesis.ts';
import { selectCategoryQuestions } from './category-questions.ts';
import { getProduct } from '../db/repositories.ts';
import type {
  DecisionResult,
  DecisionTrace,
  DimensionAssessment,
  EliminationRecord,
} from '../intelligence/decision/types.ts';

export type StageId =
  | 'understand'
  | 'discover'
  | 'research'
  | 'match'
  | 'compare'
  | 'reviews'
  | 'prices'
  | 'recommend';

export type StageStatus = 'started' | 'completed' | 'skipped' | 'failed';

export interface StageEvent {
  stage: StageId;
  status: StageStatus;
  message: string;
  /** Milliseconds the stage took. */
  elapsedMs: number;
  /** Milliseconds since the pipeline started. */
  sinceStartMs: number;
  /** Optional payload carried by the stage. */
  data?: unknown;
}

export interface PipelineRequest {
  message: string;
  sessionId: string;
  shopper: Record<string, unknown>;
  /** A buyer profile from the conversation, when there is one. */
  profile?: BuyerProfile | null;
}

export interface PipelineResult {
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
  /**
   * The full decision trace: what was asked for, what was eliminated, which
   * evidence moved the ranking, the trade-offs, what was missing, why the
   * winner won, and what would change the answer.
   */
  decisionTrace: DecisionTrace | null;
  /** Alias of `decisionTrace`, so callers can use one field name. */
  trace: DecisionTrace | null;
  /** Per-dimension assessments for the recommended products. */
  dimensions: DimensionAssessment[];
  /** Notes about the limits of the decision. */
  decisionLimitations: string[];
  /** Products eliminated by a hard constraint, with the reason. */
  eliminated: EliminationRecord[];
  toolsUsed: { name: string; ok: boolean; error?: string }[];
  steps: number;
  provider: string;
  degraded: boolean;
  notes: string[];
  violations: GuardrailViolation[];
  /** Timing breakdown, in milliseconds. */
  timings: Record<StageId, number>;
  /** True when the answer was served from cache. */
  fromCache: boolean;
  /** The buyer profile the answer was based on. */
  profileSummary: string;
  /** The conditional follow-up questions, when the brief is incomplete. */
  questions: {
    id: string;
    prompt: string;
    why: string;
    options: { label: string; value: string }[];
    allowDelegate: boolean;
  }[];
}

/** Progress sink. The HTTP layer turns these into SSE events. */
export type ProgressSink = (event: StageEvent) => void;

/** Bounded concurrency helper — never more than `limit` operations at once. */
export async function withConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

export interface PipelineOptions {
  /** How many top candidates to verify deeply. */
  verifyCount?: number;
  /** How many candidates to run web research on. */
  researchCount?: number;
  /** Deadline for the whole web research stage, in milliseconds. */
  researchBudgetMs?: number;
  /** How many to verify concurrently. */
  concurrency?: number;
  onProgress?: ProgressSink;
  providerId?: string;
}

/**
 * Run the staged pipeline.
 */
export async function runDecisionPipeline(
  request: PipelineRequest,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const started = Date.now();
  const verifyCount = options.verifyCount ?? 3;
  const concurrency = options.concurrency ?? 3;
  const researchCount = options.researchCount ?? 2;
  const researchBudgetMs = options.researchBudgetMs ?? 30_000;
  const timings = {} as Record<StageId, number>;
  const emit = options.onProgress ?? (() => {});

  const stage = async <T>(
    id: StageId,
    message: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const stageStart = Date.now();
    emit({ stage: id, status: 'started', message, elapsedMs: 0, sinceStartMs: stageStart - started });
    try {
      const result = await fn();
      timings[id] = Date.now() - stageStart;
      emit({
        stage: id,
        status: 'completed',
        message,
        elapsedMs: timings[id] ?? 0,
        sinceStartMs: Date.now() - started,
        data: result,
      });
      return result;
    } catch (error) {
      timings[id] = Date.now() - stageStart;
      emit({
        stage: id,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Stage failed',
        elapsedMs: timings[id] ?? 0,
        sinceStartMs: Date.now() - started,
      });
      throw error;
    }
  };

  /* ---------------- Stage A — understand ---------------- */
  const requirements = await stage('understand', 'Understanding your requirements', async () => {
    if (request.profile) {
      // A conversation profile already knows the category, the budget and
      // the priorities; the message only adds to it.
      const fromProfile = profileToRequirements(request.profile);
      const parsed = parseRequirements(request.message);
      return {
        ...fromProfile,
        ...(parsed.category ? { category: parsed.category } : {}),
        budgetMaxPaise: parsed.budgetMaxPaise ?? fromProfile.budgetMaxPaise,
        budgetMinPaise: parsed.budgetMinPaise ?? fromProfile.budgetMinPaise,
        priorities: { ...fromProfile.priorities, ...parsed.priorities },
        workloads: [...new Set([...fromProfile.workloads, ...parsed.workloads])],
        mustHaves: [...new Set([...fromProfile.mustHaves, ...parsed.mustHaves])],
        // The profile is authoritative about what is still missing. The
        // message is a follow-up ("Recommend me the best running shoes")
        // and does not restate the budget that was already answered.
        missingInfo: fromProfile.missingInfo,
      };
    }
    const parsed = parseRequirements(request.message);
    return parsed;
  });

  const requirementSummary = describeRequirements(requirements);
  let followUpQuestions = buildFollowUps(requirements);

  // The written answer asks a question from the category's own bank when
  // one exists, so a shoe shopper is not asked about camera and battery.
  if (request.profile?.category) {
    const categoryQuestions = selectCategoryQuestions(
      {
        category: request.profile.category,
        usage: request.profile.usage,
        priorities: request.profile.priorities,
        mustHaves: request.profile.mustHaves,
        rawStatements: request.profile.rawStatements,
        context: request.profile.context,
      },
      [
        ...request.profile.answeredQuestions,
        ...request.profile.skippedQuestions,
      ],
      1,
    );

    if (categoryQuestions.length > 0) {
      followUpQuestions = categoryQuestions.map((question) => question.prompt);
    }
  }

  if (!requirements.category) {
    return {
      reply: [
        'I can help with that, but I need to know what kind of product you are looking for.',
        '',
        followUpQuestions[0] ?? 'Which category should I search?',
      ].join('\n'),
      citations: [],
      requirements,
      requirementSummary,
      followUpQuestions,
      recommendations: [],
      toolsUsed: [],
      steps: 0,
      provider: options.providerId ?? 'local',
      degraded: false,
      notes: [],
      violations: [],
      timings,
      fromCache: false,
      decisionTrace: null,
      trace: null,
      dimensions: [],
      decisionLimitations: [],
      eliminated: [],
      profileSummary: request.profile ? describeProfile(request.profile) : describeRequirements(requirements),
      questions: buildQuestionList(request.profile, requirements),
    };
  }

  const context: ToolContext = { requirements, shopper: request.shopper };
  const citations: Citation[] = [];
  const toolsUsed: { name: string; ok: boolean; error?: string }[] = [];
  const notes: string[] = [];
  const pricesPaise: number[] = [];
  const ratings: number[] = [];
  const discountPercents: number[] = [];
  const outOfStockProductIds: string[] = [];
  let hasSampleData = false;

  /* ---------------- Stage B — discover + rank ---------------- */
  const discovery = await stage('discover', 'Finding matching products', async () => {
    const recommendTool = getTool('recommend_products');
    if (!recommendTool) {
      return { recommendations: [], excluded: [], dataQualityNotes: [] as string[] };
    }
    const result = recommendTool.execute({}, context);
    toolsUsed.push({ name: 'recommend_products', ok: result.ok, error: result.error?.message });
    if (!result.ok) {
      return { recommendations: [], excluded: [], dataQualityNotes: [result.error?.message ?? 'No results'] };
    }
    const data = result.data as {
      recommendations: Recommendation[];
      excluded: { productId: string; reason: string }[];
      dataQualityNotes: string[];
    };
    citations.push(...result.citations);
    notes.push(...data.dataQualityNotes);
    return data;
  });

  // Apply the budget as a hard constraint before anything is presented.
  const budgeted = enforceBudget(
    discovery.recommendations.map((recommendation) => ({
      ...recommendation,
      bestPricePaise: recommendation.bestPricePaise,
    })),
    requirements,
  );
  const allowed = new Set(budgeted.kept.map((item) => item.productId));
  const scored = discovery.recommendations.filter((recommendation) =>
    allowed.has(recommendation.productId),
  );

  // Map the engine's recommendation shape onto the shape the API returns.
  let recommendations: PipelineResult['recommendations'] = scored.map((recommendation) => ({
    productId: recommendation.productId,
    displayName: recommendation.displayName,
    badge: recommendation.badge,
    score: recommendation.score,
    pricePaise: recommendation.bestPricePaise,
    priceLabel: formatPaise(recommendation.bestPricePaise),
    retailer: recommendation.bestRetailer,
    imageUrl: recommendation.imageUrl,
    summary: recommendation.summary,
    strengths: recommendation.strengths,
    weaknesses: recommendation.weaknesses,
    evidence: recommendation.evidence,
    priceIsSample: recommendation.priceIsSample,
  }));

  /* ---------------- Stage C — research (optional) ---------------- */
  // Web research is opt-in. It needs network access and a configured search
  // provider, and it must never be a precondition for an answer.
  let researchSummary: { productId: string; factsFound: number; conflicts: number }[] = [];

  if (config.enableWebResearch && requirements.category) {
    await stage('research', 'Researching the open web for evidence', async () => {
      const leaders = recommendations.slice(0, researchCount);
      const results = await Promise.all(
        leaders.map(async (recommendation) => {
          const product = getProduct(recommendation.productId);
          if (!product) return null;
          try {
            const run = await runResearch(
              {
                productId: recommendation.productId,
                variantId: null,
                category: requirements.category as never,
                brand: product.brand,
                model: product.model,
                displayName: recommendation.displayName,
              },
              {
                deadlineMs: researchBudgetMs,
                onProgress: (event) => {
                  emit({
                    stage: 'research',
                    status: 'started',
                    message: `${recommendation.displayName}: ${event.message}`,
                    elapsedMs: event.elapsedMs,
                    sinceStartMs: Date.now() - started,
                  });
                },
              },
            );
            return {
              productId: recommendation.productId,
              factsFound: run.facts.length,
              conflicts: run.conflicts.length,
            };
          } catch {
            return null;
          }
        }),
      );
      researchSummary = results.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      if (researchSummary.length > 0) {
        const total = researchSummary.reduce((sum, entry) => sum + entry.factsFound, 0);
        notes.push(`Web research added ${total} evidenced facts from independent sources.`);
      }
      return { researched: researchSummary.length };
    });
  }

  /* ---------------- Stage D — verify (parallel) ---------------- */
  await stage('match', 'Checking exact variants and prices', async () => {
    const offersTool = getTool('get_offers');
    const reviewTool = getTool('get_review_intelligence');
    const historyTool = getTool('get_price_history');

    const leaders = recommendations.slice(0, verifyCount);

    await withConcurrency(leaders, concurrency, async (recommendation) => {
      const productId = recommendation.productId;

      if (offersTool) {
        const result = offersTool.execute({ productId }, context);
        toolsUsed.push({ name: 'get_offers', ok: result.ok });
        if (result.ok) {
          const data = result.data as {
            listings: {
              retailer: string;
              listPricePaise: number;
              mrpPaise: number | null;
              guaranteedPayablePaise: number;
              bestCasePayablePaise: number;
              guaranteedDiscountPaise: number;
              conditionalDiscountPaise: number;
              cashbackPaise: number;
              exchangeBonusPaise: number;
              deliveryFeePaise: number;
              inStock: boolean;
              productId: string;
              provenance: { origin: string };
            }[];
          };
          for (const listing of data.listings) {
            pricesPaise.push(
              listing.listPricePaise,
              listing.guaranteedPayablePaise,
              listing.bestCasePayablePaise,
              listing.guaranteedDiscountPaise,
              listing.conditionalDiscountPaise,
              listing.cashbackPaise,
              listing.exchangeBonusPaise,
              listing.deliveryFeePaise,
            );
            if (listing.mrpPaise) pricesPaise.push(listing.mrpPaise);
            if (listing.mrpPaise && listing.listPricePaise > 0) {
              discountPercents.push(
                Number((((listing.mrpPaise - listing.listPricePaise) / listing.mrpPaise) * 100).toFixed(1)),
              );
            }
            if (!listing.inStock) outOfStockProductIds.push(listing.productId);
            if (listing.provenance.origin === 'sample') hasSampleData = true;
          }
          citations.push(...result.citations);
        }
      }

      if (reviewTool) {
        const result = reviewTool.execute({ productId }, context);
        toolsUsed.push({ name: 'get_review_intelligence', ok: result.ok });
        if (result.ok) {
          const data = result.data as { averageRating: number | null; reviewCount: number };
          if (data.reviewCount > 0 && data.averageRating !== null) ratings.push(data.averageRating);
          citations.push(...result.citations);
        }
      }

      if (historyTool) {
        const result = historyTool.execute({ productId }, context);
        toolsUsed.push({ name: 'get_price_history', ok: result.ok });
        if (result.ok) {
          const data = result.data as {
            listings: {
              stats: {
                minPaise: number;
                maxPaise: number;
                avgPaise: number;
                medianPaise: number;
                latestPaise: number;
              } | null;
            }[];
          };
          for (const listing of data.listings) {
            if (!listing.stats) continue;
            pricesPaise.push(
              listing.stats.minPaise,
              listing.stats.maxPaise,
              listing.stats.avgPaise,
              listing.stats.medianPaise,
              listing.stats.latestPaise,
            );
          }
          citations.push(...result.citations);
        }
      }
    });

    return { verified: leaders.length };
  });

  /* ---------------- Stage E — recommend ---------------- */
  let decisionTrace: DecisionTrace | null = null;
  let dimensions: DimensionAssessment[] = [];
  let decisionLimitations: string[] = [];
  let eliminated: EliminationRecord[] = [];
  const decisionHolder: { set: DecisionSet | null } = { set: null };

  await stage('recommend', 'Building your recommendation', async () => {
    // The decision engine enforces the hard constraints, assesses the eight
    // intelligence dimensions and produces the full trace.
    const decisionCandidates = buildDecisionCandidates({
      shopper: request.shopper,
      category: requirements.category ?? undefined,
    });

    const built = buildDecisions(decisionCandidates, requirements, { limit: 6 });
    decisionHolder.set = built;

    decisionTrace = built.trace;
    dimensions = built.decisions[0]?.dimensions ?? [];
    decisionLimitations = built.limitations;
    eliminated = built.eliminated;

    // The trace's elimination records are the authoritative account of what
    // was removed and why.
    if (built.eliminated.length > 0) {
      for (const record of built.eliminated) {
        notes.push(`Excluded ${record.displayName}: ${record.reason}`);
      }
    }

    return built;
  });

  /* ---------------- Compose and guard ---------------- */
  // The decision engine's result is authoritative. Rebuild the
  // recommendations from it so the written answer and the structured
  // result cannot disagree about the price or the ranking.
  const decisionRecommendations = decisionHolder.set?.decisions ?? [];
  if (decisionRecommendations.length > 0) {
    recommendations = decisionRecommendations.map((decision) => ({
      productId: decision.productId,
      displayName: decision.displayName,
      badge: decision.badge,
      score: decision.score,
      pricePaise: decision.pricePaise,
      priceLabel: formatPaise(decision.pricePaise),
      retailer: decision.retailer,
      imageUrl: getProduct(decision.productId)?.imageUrl ?? null,
      summary: decision.strengths.join('; '),
      strengths: decision.strengths,
      weaknesses: decision.weaknesses,
      evidence: decision.evidence.map((item) => item.statement),
      priceIsSample: decision.priceIsSample,
    }));
  }

  let reply = composeAnswer(recommendations, requirements, {
    citations,
    notes,
    hasSampleData,
    excluded: discovery.excluded,
    followUpQuestions,
    pricesPaise,
  });

  // A configured model may write a better sentence than the deterministic
  // composer, but only from the same verified facts. Its answer goes through
  // the same citation gate, and is discarded if it fails.
  const decisionsForSynthesis: DecisionResult[] = decisionHolder.set?.decisions ?? [];
  const decisionFacts = factsFromDecisions(
    decisionsForSynthesis.map((decision) => ({
      displayName: decision.displayName,
      badge: decision.badge,
      pricePaise: decision.pricePaise,
      retailer: decision.retailer,
      score: decision.score,
      strengths: decision.strengths,
      weaknesses: decision.weaknesses,
      confidence: decision.confidence,
      dimensions: decision.dimensions.map((dimension) => ({
        label: dimension.label,
        summary: dimension.summary,
      })),
    })),
  );

  let modelWroteIt = false;
  if (decisionFacts.length > 0 && hasRemoteLlm()) {
    const composed = await composeSynthesisWithModel({
      requirements,
      facts: decisionFacts,
      notes,
      followUpQuestions,
      deadline: started + 20_000,
    });
    if (composed) {
      reply = composed;
      modelWroteIt = true;
    }
  }

  // The decision engine's prices are verified by the same price engine
  // as the discovery stage's. Add them to the known set so the guardrail
  // does not redact a genuine payable price as "unavailable".
  const knownPrices = [
    ...pricesPaise,
    ...recommendations
      .map((recommendation) => recommendation.pricePaise)
      .filter((price): price is number => price !== null),
  ];

  const guardrails = applyGuardrails({
    reply,
    citations,
    requirements,
    known: { pricesPaise: knownPrices, ratings, discountPercents },
    hasSampleData,
    outOfStockProductIds,
    redact: true,
  });

  const totalMs = Date.now() - started;

  return {
    reply: guardrails.reply,
    citations: guardrails.citations,
    requirements,
    requirementSummary,
    followUpQuestions,
    recommendations,
    toolsUsed,
    steps: toolsUsed.length,
    provider: options.providerId ?? 'local',
    degraded: !modelWroteIt,
    notes,
    violations: guardrails.violations,
    timings,
    fromCache: false,
    decisionTrace,
    trace: decisionTrace,
    dimensions,
    decisionLimitations,
    eliminated,
    profileSummary: request.profile ? describeProfile(request.profile) : describeRequirements(requirements),
    questions: buildQuestionList(request.profile, requirements),
    ...(totalMs >= 0 ? {} : {}),
  };
}

/**
 * The conditional follow-up questions for this brief.
 *
 * When there is a conversation, the questions come from the conversation's
 * own state. When there is not, they are derived from the gaps in the brief.
 */
export function buildQuestionList(
  profile: BuyerProfile | null | undefined,
  requirements: PurchaseRequirements,
): {
  id: string;
  prompt: string;
  why: string;
  options: { label: string; value: string }[];
  allowDelegate: boolean;
}[] {
  if (profile) {
    const asked = [...profile.answeredQuestions, ...profile.skippedQuestions];
    return selectQuestions(profile, asked).map((question) => ({
      id: question.id,
      prompt: question.prompt,
      why: question.why,
      options: question.options?.map((option) => ({ label: option.label, value: option.value })) ?? [],
      allowDelegate: question.allowDelegate,
    }));
  }

  const gaps = describeGaps({
    category: requirements.category ?? null,
    categorySource: requirements.category ? 'inferred' : 'unknown',
    budgetMaxPaise: requirements.budgetMaxPaise ?? null,
    budgetMinPaise: requirements.budgetMinPaise ?? null,
    budgetSource: requirements.budgetMaxPaise ? 'stated' : 'unknown',
    usage: requirements.workloads ?? [],
    usageSource: 'inferred',
    priorities: requirements.priorities ?? {},
    mustHaves: requirements.mustHaves ?? [],
    acceptableCompromises: [],
    expectedLifespanYears: null,
    context: {},
    answeredQuestions: [],
    skippedQuestions: [],
    rawStatements: [],
  });

  const TEMPLATES: Record<string, { prompt: string; why: string }> = {
    category: {
      prompt: 'What kind of product are you looking for — a laptop, a phone, an appliance, something else?',
      why: 'The category decides which specifications and risks matter at all.',
    },
    budget: {
      prompt: 'What is your budget? A rough ceiling is enough — for example "under ₹50,000".',
      why: 'The budget decides which products are even considered.',
    },
    use_case: {
      prompt: 'What will you mainly use it for? That decides what the ranking should favour.',
      why: 'Usage changes what matters: a battery matters more for travel than for a desk.',
    },
    priorities: {
      prompt: 'What matters most to you — battery, camera, performance, display, or something else?',
      why: 'The priorities decide how the evidence is weighted.',
    },
    lifespan: {
      prompt: 'How long do you expect to keep it — two years, or four to five?',
      why: 'A product bought for two years is judged on price; one bought for five is judged on reliability.',
    },
    gpu_budget: {
      prompt: 'Running local AI models needs a graphics card with its own memory. Should I include one?',
      why: 'This is the difference between a machine that can and one that cannot run your models.',
    },
  };

  return gaps
    .filter((gap) => TEMPLATES[gap])
    .slice(0, 2)
    .map((gap) => ({
      id: `gap.${gap}`,
      prompt: TEMPLATES[gap]?.prompt ?? '',
      why: TEMPLATES[gap]?.why ?? '',
      options: [],
      allowDelegate: true,
    }));
}

/** Follow-up questions for a brief with gaps. */
export function buildFollowUps(requirements: PurchaseRequirements): string[] {
  const templates: Record<string, string> = {
    category: 'Which category are you shopping for — a phone, a laptop, earbuds, or something else?',
    budget: 'What is your budget? A rough ceiling is enough — for example "under ₹50,000".',
    priorities: 'What matters most to you — camera, battery, performance, or display?',
    gpu_budget:
      'Running local AI models needs a dedicated GPU with its own VRAM. Should I include a dedicated graphics card?',
    use_case: 'What will you mainly use it for? That decides what the ranking should favour.',
  };
  return requirements.missingInfo
    .map((key) => templates[key])
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
}

/** Compose the final answer from verified facts. */
function composeAnswer(
  products: PipelineResult['recommendations'],
  requirements: PurchaseRequirements,
  context: {
    citations: Citation[];
    notes: string[];
    hasSampleData: boolean;
    excluded: { productId: string; reason: string }[];
    followUpQuestions: string[];
    pricesPaise: number[];
  },
): string {
  if (products.length === 0) {
    return [
      'I could not find anything in the catalogue that matches that brief.',
      context.notes[0] ?? 'No products are available for this category yet.',
    ].join('\n');
  }

  const lines: string[] = [];
  const budgetLabel = requirements.budgetMaxPaise
    ? ` under ${(requirements.budgetMaxPaise / 100).toLocaleString('en-IN')}`
    : '';
  lines.push(
    `Here is what I found for ${requirements.category ?? 'your request'}${budgetLabel}. ${products.length} option${products.length === 1 ? '' : 's'} qualified.`,
  );
  lines.push('');

  for (const [index, product] of products.entries()) {
    const badge = product.badge ? `${badgeLabel(product.badge)} · ` : '';
    const priceText = product.pricePaise !== null ? `₹${(product.pricePaise / 100).toLocaleString('en-IN')}` : 'price unavailable';
    lines.push(`**${index + 1}. ${badge}${product.displayName}** — ${priceText}`);
    if (product.strengths.length > 0) {
      lines.push(`   - Why: ${product.strengths.slice(0, 3).join('; ')}.`);
    }
    if (product.weaknesses.length > 0) {
      lines.push(`   - Watch out: ${product.weaknesses.slice(0, 2).join('; ')}.`);
    }
    lines.push('');
  }

  if (context.hasSampleData) {
    lines.push(
      '_Pricing above comes from the bundled sample catalogue, not a live retailer feed. Check the price on the retailer page before buying._',
    );
  }

  const byBudget = context.excluded.filter((entry) => /budget/i.test(entry.reason));
  if (byBudget.length > 0) {
    lines.push('');
    lines.push(
      `${byBudget.length} other option${byBudget.length === 1 ? ' was' : 's were'} left out because ${byBudget.length === 1 ? 'it is' : 'they are'} outside your budget — say the word and I will show them anyway.`,
    );
  }

  if (context.followUpQuestions.length > 0) {
    lines.push('');
    lines.push(`To narrow this down further: ${context.followUpQuestions[0]}`);
  }

  return lines.join('\n');
}

const badgeLabel = (badge: string): string => {
  switch (badge) {
    case 'best_overall':
      return 'Best overall';
    case 'best_value':
      return 'Best value';
    case 'best_performance':
      return 'Best performance';
    case 'best_long_term':
      return 'Best long-term choice';
    case 'best_budget':
      return 'Best budget option';
    case 'best_alternative':
      return 'Best alternative';
    default:
      return badge;
  }
};

export { cacheStats, cached };
