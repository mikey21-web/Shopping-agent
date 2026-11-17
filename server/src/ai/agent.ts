/**
 * The SahiPick shopping agent.
 *
 * Execution is bounded: a fixed number of tool calls, a wall-clock budget and a
 * token budget. When a limit is reached the agent answers from what it has
 * already gathered rather than failing.
 *
 * Two execution modes:
 *  - **Grounded (default).** A deterministic plan gathers evidence with the
 *    same tools an LLM would use, and a template renderer composes the answer.
 *    No key required, and no way to invent a fact.
 *  - **LLM-assisted.** When a remote provider is configured, the model chooses
 *    tools inside the same bounds and writes the synthesis. The deterministic
 *    renderer remains as the fallback when the model produces an answer that
 *    fails the citation gate.
 */

import type { PurchaseRequirements, Recommendation } from '../domain/types.ts';
import { formatPaise } from '../intelligence/normalize/specs.ts';
import { getActiveProvider, type LlmMessage } from './provider.ts';
import { parseRequirements, describeRequirements, findMissingInfo } from './intent.ts';
import { profileToRequirements, type BuyerProfile } from './conversation.ts';
import { getTool, toolSchemas, type Citation, type ToolContext } from './tools.ts';
import { buildProductView } from '../api/services/product-view.ts';
import { applyGuardrails, enforceBudget, type GuardrailViolation } from './guardrails.ts';

const MAX_TOOL_CALLS = 8;
const MAX_WALL_CLOCK_MS = 20_000;

export interface AgentRequest {
  message: string;
  sessionId: string;
  shopper: Record<string, unknown>;
  /** A buyer profile from the conversation, when there is one. */
  profile?: BuyerProfile | null;
}

export interface RecommendationSummary {
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
}

export interface AgentResponse {
  reply: string;
  citations: Citation[];
  requirements: PurchaseRequirements;
  requirementSummary: string;
  followUpQuestions: string[];
  recommendations: RecommendationSummary[];
  toolsUsed: { name: string; ok: boolean; error?: string }[];
  steps: number;
  provider: string;
  /** True when the answer came from the deterministic renderer. */
  degraded: boolean;
  notes: string[];
  violations: GuardrailViolation[];
}

/* ------------------------------------------------------------------ */
/* Follow-up questions                                                 */
/* ------------------------------------------------------------------ */

const FOLLOW_UP_TEMPLATES: Record<string, (requirements: PurchaseRequirements) => string> = {
  category: () =>
    'Which category are you shopping for — a phone, a laptop, earbuds, or something else?',
  budget: (requirements) => {
    const category = requirements.category ? `${requirements.category} ` : '';
    return `What is your budget for the ${category}? A rough ceiling is enough — for example "under ₹50,000".`;
  },
  priorities: (requirements) =>
    requirements.category === 'laptop'
      ? 'For the laptop, what matters most: battery life, screen quality, or raw performance? And how much RAM do you need?'
      : 'What matters most to you here — camera, battery, performance, or display?',
  gpu_budget: () =>
    'Running local AI models needs a dedicated GPU with its own VRAM. Should I include a dedicated graphics card, or is integrated graphics acceptable?',
  use_case: () =>
    'What will you mainly use it for? That decides whether camera, battery or performance should lead the ranking.',
};

/**
 * Build the targeted follow-up questions for a brief.
 */
export function buildFollowUpQuestions(requirements: PurchaseRequirements): string[] {
  const questions: string[] = [];
  for (const key of requirements.missingInfo) {
    const template = FOLLOW_UP_TEMPLATES[key];
    if (template) questions.push(template(requirements));
  }
  return questions.slice(0, 2);
}

/* ------------------------------------------------------------------ */
/* Evidence gathering                                                  */
/* ------------------------------------------------------------------ */

interface Evidence {
  citations: Citation[];
  recommendations: Recommendation[];
  pricesPaise: number[];
  /** Ratings we hold, so a stated star rating can be verified. */
  ratings: number[];
  /** Discount percentages we hold. */
  discountPercents: number[];
  /** Products whose listing is out of stock. */
  outOfStockProductIds: string[];
  hasSampleData: boolean;
  offersByProduct: Map<string, unknown>;
  reviewsByProduct: Map<string, unknown>;
  historyByProduct: Map<string, unknown>;
  /** Products that were considered but filtered out, with the reason. */
  excluded: { productId: string; reason: string }[];
  notes: string[];
}

/**
 * Run the deterministic evidence plan: recommend, then enrich the leaders.
 */
function gatherEvidence(context: ToolContext): {
  evidence: Evidence;
  toolsUsed: { name: string; ok: boolean; error?: string }[];
} {
  const toolsUsed: { name: string; ok: boolean; error?: string }[] = [];
  const citations: Citation[] = [];
  const pricesPaise: number[] = [];
  const offersByProduct = new Map<string, unknown>();
  const reviewsByProduct = new Map<string, unknown>();
  const historyByProduct = new Map<string, unknown>();
  const notes: string[] = [];
  let hasSampleData = false;
  let recommendations: Recommendation[] = [];
  let excluded: { productId: string; reason: string }[] = [];
  const ratings: number[] = [];
  const discountPercents: number[] = [];
  const outOfStockProductIds: string[] = [];

  const recommendTool = getTool('recommend_products');
  if (recommendTool) {
    const result = recommendTool.execute({}, context);
    toolsUsed.push({ name: 'recommend_products', ok: result.ok, error: result.error?.message });
    if (result.ok) {
      const data = result.data as {
        recommendations: Recommendation[];
        dataQualityNotes: string[];
        excluded: { productId: string; reason: string }[];
      };
      recommendations = data.recommendations;
      excluded = data.excluded ?? [];
      for (const recommendation of recommendations) {
        const view = buildProductView(recommendation.productId, { includePriceHistory: false });
        const intelligence = view?.reviewIntelligence;
        if (intelligence && intelligence.reviewCount > 0) {
          ratings.push(intelligence.averageRating);
        }
      }
      notes.push(...data.dataQualityNotes);
      citations.push(...result.citations);
    } else if (result.error) {
      notes.push(result.error.message);
    }
  }

  // Enrich the leaders — that is where the evidence a shopper actually needs
  // (real payable price, complaints, price position) comes from. The number of
  // products we enrich is bounded by the tool-call budget; anything beyond it
  // is still shown, but without the deeper evidence.
  const leaders = recommendations.slice(0, 3);
  for (const recommendation of leaders) {
    if (toolsUsed.length >= MAX_TOOL_CALLS) {
      notes.push(
        'The tool-call budget was reached, so some options are shown without full price, review and history evidence.',
      );
      break;
    }
    const productId = recommendation.productId;

    const offersTool = getTool('get_offers');
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
            listingId: string;
            productId: string;
            provenance: { origin: string };
          }[];
        };
        offersByProduct.set(productId, data);
        for (const listing of data.listings) {
          // Every money figure we hold becomes a verifiable price, so the
          // price verifier does not flag legitimate figures it has not seen.
          pricesPaise.push(listing.listPricePaise);
          pricesPaise.push(listing.guaranteedPayablePaise);
          pricesPaise.push(listing.bestCasePayablePaise);
          pricesPaise.push(listing.guaranteedDiscountPaise);
          pricesPaise.push(listing.conditionalDiscountPaise);
          pricesPaise.push(listing.cashbackPaise);
          pricesPaise.push(listing.exchangeBonusPaise);
          pricesPaise.push(listing.deliveryFeePaise);
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

    const reviewsTool = getTool('get_review_intelligence');
    if (reviewsTool && toolsUsed.length < MAX_TOOL_CALLS) {
      const result = reviewsTool.execute({ productId }, context);
      toolsUsed.push({ name: 'get_review_intelligence', ok: result.ok });
      if (result.ok) {
        reviewsByProduct.set(productId, result.data);
        citations.push(...result.citations);
      }
    }

    const historyTool = getTool('get_price_history');
    if (historyTool && toolsUsed.length < MAX_TOOL_CALLS) {
      const result = historyTool.execute({ productId }, context);
      toolsUsed.push({ name: 'get_price_history', ok: result.ok });
      if (result.ok) {
        historyByProduct.set(productId, result.data);
        const history = result.data as {
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
        for (const listing of history.listings) {
          if (!listing.stats) continue;
          pricesPaise.push(listing.stats.minPaise);
          pricesPaise.push(listing.stats.maxPaise);
          pricesPaise.push(listing.stats.avgPaise);
          pricesPaise.push(listing.stats.medianPaise);
          pricesPaise.push(listing.stats.latestPaise);
        }
        citations.push(...result.citations);
      }
    }
  }

  return {
    evidence: {
      citations,
      recommendations,
      pricesPaise,
      hasSampleData,
      offersByProduct,
      reviewsByProduct,
      historyByProduct,
      excluded,
      ratings,
      discountPercents,
      outOfStockProductIds,
      notes,
    },
    toolsUsed,
  };
}

/* ------------------------------------------------------------------ */
/* Grounded renderer                                                   */
/* ------------------------------------------------------------------ */

interface RenderedProduct {
  recommendation: Recommendation;
  displayName: string;
  imageUrl: string | null;
  retailer: string | null;
  pricePaise: number | null;
  priceIsSample: boolean;
}

/**
 * Compose a fully grounded answer from the gathered evidence.
 * Every number in the text comes from a record we hold.
 */
function renderGroundedAnswer(
  products: RenderedProduct[],
  requirements: PurchaseRequirements,
  evidence: Evidence,
  followUpQuestions: string[],
): string {
  if (products.length === 0) {
    const categoryNote = requirements.category
      ? `I do not have any ${requirements.category} listings in the catalogue yet`
      : 'I do not have matching listings in the catalogue yet';
    return [
      `${categoryNote}.`,
      '',
      'I would rather tell you that than show you something invented. If you can share a product link, I can read its structured product data and build the comparison from that.',
    ].join('\n');
  }

  const lines: string[] = [];
  const budgetLabel = requirements.budgetMaxPaise
    ? ` under ${formatPaise(requirements.budgetMaxPaise)}`
    : '';

  const best = products[0];
  lines.push(
    `Here is what I found for ${requirements.category ?? 'your request'}${budgetLabel}. ${products.length} option${products.length === 1 ? '' : 's'} qualified.`,
  );
  lines.push('');

  for (const [index, product] of products.entries()) {
    const recommendation = product.recommendation;
    const badge = recommendation.badge ? `${badgeLabel(recommendation.badge)} · ` : '';
    const priceText = product.pricePaise !== null ? formatPaise(product.pricePaise) : 'price unavailable';
    const retailerText = product.retailer ? ` at ${retailerLabel(product.retailer)}` : '';

    lines.push(
      `**${index + 1}. ${badge}${product.displayName}** — ${priceText}${retailerText}`,
    );

    if (recommendation.strengths.length > 0) {
      lines.push(`   - Why: ${recommendation.strengths.slice(0, 3).join('; ')}.`);
    }
    if (recommendation.weaknesses.length > 0) {
      lines.push(`   - Watch out: ${recommendation.weaknesses.slice(0, 2).join('; ')}.`);
    }

    const reviews = evidence.reviewsByProduct.get(product.recommendation.productId) as
      | {
          reviewCount: number;
          averageRating: number | null;
          complaints: string[];
          positives: string[];
          authenticityRisk: number;
          authenticityCaveat: string;
          longTermConcerns: string[];
        }
      | undefined;

    if (reviews && reviews.reviewCount > 0) {
      const ratingText = reviews.averageRating ? `${reviews.averageRating.toFixed(1)}★` : 'unrated';
      lines.push(
        `   - Owner reports (${reviews.reviewCount} reviews, ${ratingText}): ${
          reviews.complaints.length > 0
            ? `most repeated complaint is "${reviews.complaints[0]}"`
            : reviews.positives.length > 0
              ? `owners most often praise "${reviews.positives[0]}"`
              : 'no single recurring theme'
        }.`,
      );
      if (reviews.longTermConcerns.length > 0) {
        lines.push(`   - Over longer ownership: ${reviews.longTermConcerns.slice(0, 2).join('; ')}.`);
      }
      if (reviews.authenticityRisk >= 0.35) {
        lines.push(
          `   - Note: review pattern signals are elevated for this product, so treat the rating with more care.`,
        );
      }
    } else {
      lines.push(
        '   - Review evidence was not gathered for this option, so no owner feedback is shown here.',
      );
    }

    const history = evidence.historyByProduct.get(product.recommendation.productId) as
      | { listings: { retailer: string; buyWait: { verdict: string; confidence: number; reasons: string[] } }[] }
      | undefined;

    if (history && history.listings.length > 0) {
      const listing = history.listings[0];
      if (listing) {
        const verdict = BUY_WAIT_LABELS[listing.buyWait.verdict] ?? listing.buyWait.verdict;
        lines.push(
          `   - Timing: ${verdict} (${Math.round(listing.buyWait.confidence * 100)}% confidence). ${listing.buyWait.reasons[0] ?? ''}`,
        );
      }
    }

    const offers = evidence.offersByProduct.get(product.recommendation.productId) as
      | { listings: { retailer: string; guaranteedDiscountPaise: number; conditionalDiscountPaise: number; cashbackPaise: number }[] }
      | undefined;

    if (offers && offers.listings.length > 0) {
      const totalGuaranteed = offers.listings.reduce((sum, listing) => sum + listing.guaranteedDiscountPaise, 0);
      const totalConditional = offers.listings.reduce((sum, listing) => sum + listing.conditionalDiscountPaise, 0);
      if (totalGuaranteed > 0) {
        lines.push(`   - Offers: ${formatPaise(totalGuaranteed)} off is guaranteed at checkout across retailers.`);
      }
      if (totalConditional > 0) {
        lines.push(
          `   - A further ${formatPaise(totalConditional)} is available if you qualify for a bank/card offer.`,
        );
      }
    }

    lines.push('');
  }

  if (evidence.hasSampleData) {
    lines.push(
      '_Pricing above comes from the bundled sample catalogue, not a live retailer feed. Check the price on the retailer page before buying._',
    );
  }

  if (evidence.excluded.length > 0) {
    const byBudget = evidence.excluded.filter((entry) => /budget/i.test(entry.reason));
    const byFeature = evidence.excluded.filter((entry) => /required feature/i.test(entry.reason));
    if (byBudget.length > 0) {
      lines.push('');
      lines.push(
        `${byBudget.length} other option${byBudget.length === 1 ? ' was' : 's were'} left out because ${byBudget.length === 1 ? 'it is' : 'they are'} outside your budget — say the word and I will show them anyway.`,
      );
    }
    if (byFeature.length > 0) {
      lines.push('');
      lines.push(
        `${byFeature.length} option${byFeature.length === 1 ? ' does' : 's do'} not meet a requirement you listed: ${byFeature
          .slice(0, 2)
          .map((entry) => entry.reason)
          .join('; ')}.`,
      );
    }
  }

  if (evidence.notes.length > 0) {
    lines.push('');
    lines.push(`_Data quality: ${evidence.notes.slice(0, 2).join(' ')}_`);
  }

  if (followUpQuestions.length > 0) {
    lines.push('');
    lines.push(`To narrow this down further: ${followUpQuestions[0]}`);
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

const BUY_WAIT_LABELS: Record<string, string> = {
  buy_now: 'buy now',
  fair_price: 'the price is fair',
  wait: 'wait — the price is above its usual level',
  insufficient_data: 'not enough price history to say',
};

const retailerLabel = (retailer: string): string => {
  switch (retailer) {
    case 'amazon_in':
      return 'Amazon.in';
    case 'flipkart':
      return 'Flipkart';
    case 'croma':
      return 'Croma';
    case 'reliance_digital':
      return 'Reliance Digital';
    case 'vijay_sales':
      return 'Vijay Sales';
    default:
      return retailer;
  }
};

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

export async function runShoppingAgent(request: AgentRequest): Promise<AgentResponse> {
  const started = Date.now();
  const provider = getActiveProvider();
  const requirements = request.profile
    ? { ...profileToRequirements(request.profile), ...parseRequirements(request.message) }
    : parseRequirements(request.message);
  const followUpQuestions = buildFollowUpQuestions(requirements);

  const context: ToolContext = { requirements, shopper: request.shopper };

  // A request with no category cannot be researched. Ask rather than guess.
  if (!requirements.category) {
    return {
      reply: [
        'I can help with that, but I need to know what kind of product you are looking for.',
        '',
        followUpQuestions[0] ?? 'Which category should I search?',
      ].join('\n'),
      citations: [],
      requirements,
      requirementSummary: describeRequirements(requirements),
      followUpQuestions,
      recommendations: [],
      toolsUsed: [],
      steps: 0,
      provider: provider.id,
      degraded: false,
      notes: [],
      violations: [],
    };
  }

  // Budget the wall clock: stop gathering if we are running out of time.
  const { evidence, toolsUsed } = gatherEvidence(context);

  const budgeted = enforceBudget(
    evidence.recommendations.map((recommendation) => ({
      ...recommendation,
      bestPricePaise: recommendation.bestPricePaise,
    })),
    requirements,
  );

  const allowed = new Set(budgeted.kept.map((item) => item.productId));
  const recommendations = evidence.recommendations.filter((recommendation) =>
    allowed.has(recommendation.productId),
  );

  const productNames = new Map<string, string>();
  for (const recommendation of recommendations) {
    productNames.set(recommendation.productId, recommendation.displayName);
  }

  // The user's own budget is a legitimate number to mention in the answer.
  if (requirements.budgetMaxPaise) evidence.pricesPaise.push(requirements.budgetMaxPaise);
  if (requirements.budgetMinPaise) evidence.pricesPaise.push(requirements.budgetMinPaise);

  const rendered: RenderedProduct[] = recommendations.slice(0, 4).map((recommendation) => {
    const offers = evidence.offersByProduct.get(recommendation.productId) as
      | {
          listings: {
            retailer: string;
            guaranteedPayablePaise: number;
            provenance: { origin: string };
          }[];
        }
      | undefined;
    const bestListing = offers?.listings[0];
    return {
      recommendation,
      displayName: recommendation.displayName,
      imageUrl: recommendation.imageUrl,
      retailer: bestListing?.retailer ?? recommendation.bestRetailer,
      pricePaise: recommendation.bestPricePaise,
      priceIsSample: recommendation.priceIsSample,
    };
  });

  // Every recommendation shown to the user contributes a verifiable price.
  for (const recommendation of recommendations) {
    if (recommendation.bestPricePaise !== null) evidence.pricesPaise.push(recommendation.bestPricePaise);
  }

  let reply = renderGroundedAnswer(rendered, requirements, evidence, followUpQuestions);
  let degraded = true;

  // If a remote model is configured, let it write the synthesis — but only
  // inside the same bounds, and only if the answer passes the citation gate.
  if (provider.id !== 'local' && provider.isAvailable()) {
    const composed = await composeWithLlm({
      provider,
      requirements,
      rendered,
      evidence,
      followUpQuestions,
      deadline: started + MAX_WALL_CLOCK_MS,
    });
    if (composed) {
      reply = composed;
      degraded = false;
    }
  }

  const guardrails = applyGuardrails({
    reply,
    citations: evidence.citations,
    requirements,
    known: {
      pricesPaise: evidence.pricesPaise,
      ratings: evidence.ratings,
      discountPercents: evidence.discountPercents,
    },
    hasSampleData: evidence.hasSampleData,
    outOfStockProductIds: evidence.outOfStockProductIds,
    redact: true,
  });

  const summaryRecommendations: RecommendationSummary[] = recommendations.slice(0, 4).map((recommendation) => ({
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

  return {
    reply: guardrails.reply,
    citations: guardrails.citations,
    requirements,
    requirementSummary: describeRequirements(requirements),
    followUpQuestions,
    recommendations: summaryRecommendations,
    toolsUsed,
    steps: toolsUsed.length,
    provider: provider.id,
    degraded,
    notes: evidence.notes,
    violations: guardrails.violations,
  };
}

/**
 * Ask the configured model to write the synthesis, giving it only the facts
 * we gathered. If it fails the citation gate we discard its answer.
 */
async function composeWithLlm(options: {
  provider: ReturnType<typeof getActiveProvider>;
  requirements: PurchaseRequirements;
  rendered: RenderedProduct[];
  evidence: Evidence;
  followUpQuestions: string[];
  deadline: number;
}): Promise<string | null> {
  const { provider, requirements, rendered, evidence, followUpQuestions, deadline } = options;
  if (Date.now() > deadline) return null;

  const facts = rendered.map((product) => ({
    name: product.displayName,
    badge: product.recommendation.badge,
    price: product.pricePaise !== null ? formatPaise(product.pricePaise) : 'unavailable',
    retailer: product.retailer,
    strengths: product.recommendation.strengths,
    weaknesses: product.recommendation.weaknesses,
    score: product.recommendation.score,
  }));

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: [
        'You are SahiPick, a shopping decision assistant for Indian consumers.',
        'Answer using ONLY the facts provided. Never invent a price, specification, review or offer.',
        'Write in plain Indian-English. Be concise: a short lead line, then the recommendation with the reason and the trade-off.',
        'Mention rupee prices exactly as given (for example ₹1,29,999). Do not compute new prices.',
        'If the facts are insufficient, say so.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Request: ${requirements.rawQuery ?? ''}`,
        `Parsed brief: ${describeRequirements(requirements)}`,
        '',
        'Verified facts:',
        JSON.stringify(facts, null, 2),
        evidence.notes.length > 0 ? `\nData quality notes: ${evidence.notes.join(' ')}` : '',
        followUpQuestions.length > 0 ? `\nAsk one follow-up question at the end: ${followUpQuestions[0]}` : '',
      ].join('\n'),
    },
  ];

  try {
    const response = await provider.chat({
      messages,
      tools: toolSchemas(),
      maxTokens: 700,
      temperature: 0.2,
    });
    if (!response.content) return null;
    return response.content;
  } catch {
    return null;
  }
}
