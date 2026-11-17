/**
 * Agent tools.
 *
 * Every tool is deterministic and returns JSON-serialisable data plus the
 * citations that support it. Tools never raise: failures come back as a
 * structured error so the agent can explain them instead of crashing.
 */

import type { PurchaseRequirements, RecommendationSet } from '../domain/types.ts';
import { formatPaise } from '../intelligence/normalize/specs.ts';
import { buildCandidates, buildComparison, buildProductView } from '../api/services/product-view.ts';
import { buildRecommendationSet } from '../intelligence/recommendations/scoring.ts';
import { listProducts, searchProducts } from '../db/repositories.ts';

export interface Citation {
  id: string;
  kind: 'product' | 'listing' | 'offer' | 'review' | 'price_history' | 'specification';
  label: string;
  url?: string | null;
  retailer?: string | null;
  /** Provenance of the underlying fact. */
  origin: 'live' | 'sample' | 'derived' | 'model_est' | 'unknown';
}

export interface ToolResult {
  ok: boolean;
  data: unknown;
  citations: Citation[];
  error?: { type: string; message: string; hint: string };
}

function failure(type: string, message: string, hint: string): ToolResult {
  return { ok: false, data: null, citations: [], error: { type, message, hint } };
}

export interface ToolContext {
  requirements: PurchaseRequirements;
  /** Optional shopper context for evaluating conditional offers. */
  shopper: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Tool implementations                                                */
/* ------------------------------------------------------------------ */

export function toolSearchProducts(args: Record<string, unknown>, _context: ToolContext): ToolResult {
  const query = typeof args.query === 'string' ? args.query : '';
  const category = typeof args.category === 'string' ? args.category : undefined;
  if (!query.trim() && !category) {
    return failure('invalid_arguments', 'A search query or category is required.', 'Call with {"query":"..."} or {"category":"..."}.');
  }

  const products = query ? searchProducts(query, category) : listProducts(category);
  const citations: Citation[] = [];
  const rows = products.slice(0, 30).map((product) => {
    const view = buildProductView(product.id, { includePriceHistory: false });
    const best = view?.listings.find((listing) => listing.listing.id === view.bestListingId);
    if (best) {
      citations.push({
        id: best.listing.id,
        kind: 'listing',
        label: `${product.displayName} at ${best.listing.retailer}`,
        url: best.listing.url,
        retailer: best.listing.retailer,
        origin: best.listing.provenance.origin,
      });
    } else {
      citations.push({
        id: product.id,
        kind: 'product',
        label: product.displayName,
        origin: 'derived',
      });
    }
    return {
      productId: product.id,
      displayName: product.displayName,
      brand: product.brand,
      category: product.category,
      imageUrl: product.imageUrl,
      bestPayablePaise: best?.breakdown.payablePaise ?? null,
      bestPayable: formatPaise(best?.breakdown.payablePaise ?? null),
      retailer: best?.listing.retailer ?? null,
      inStock: best?.listing.inStock ?? null,
      priceIsSample: best?.listing.provenance.origin === 'sample',
      rating: best?.listing.rating ?? null,
    };
  });

  return { ok: true, data: { products: rows, count: rows.length }, citations };
}

export function toolGetProduct(args: Record<string, unknown>, _context: ToolContext): ToolResult {
  const productId = typeof args.productId === 'string' ? args.productId : '';
  const view = buildProductView(productId, { includePriceHistory: false });
  if (!view) {
    return failure('not_found', `No product with id "${productId}".`, 'Call search_products first to obtain valid product ids.');
  }

  const citations: Citation[] = [
    {
      id: view.product.id,
      kind: 'product',
      label: view.product.displayName,
      origin: 'derived',
    },
  ];

  return {
    ok: true,
    data: {
      productId: view.product.id,
      displayName: view.product.displayName,
      brand: view.product.brand,
      category: view.product.category,
      highlights: view.product.highlights,
      specifications: view.product.specs,
      variants: view.variants,
      listingCount: view.listings.length,
      reviewCount: view.reviewIntelligence?.reviewCount ?? 0,
      averageRating: view.reviewIntelligence?.averageRating ?? null,
      dataQualityNotes: view.dataQualityNotes,
    },
    citations,
  };
}

export function toolGetOffers(args: Record<string, unknown>, context: ToolContext): ToolResult {
  const productId = typeof args.productId === 'string' ? args.productId : '';
  const view = buildProductView(productId, { shopper: context.shopper as never });
  if (!view) {
    return failure('not_found', `No product with id "${productId}".`, 'Call search_products first.');
  }

  const citations: Citation[] = [];
  const rows = view.listings.map((listing) => {
    for (const applied of listing.breakdown.applied) {
      citations.push({
        id: applied.offerId,
        kind: 'offer',
        label: applied.title,
        retailer: listing.listing.retailer,
        origin: listing.listing.provenance.origin,
      });
    }
    return {
      listingId: listing.listing.id,
      retailer: listing.listing.retailer,
      title: listing.listing.title,
      url: listing.listing.url,
      inStock: listing.listing.inStock,
      condition: listing.listing.condition,
      seller: listing.listing.seller,
      listPricePaise: listing.breakdown.listPricePaise,
      mrpPaise: listing.breakdown.mrpPaise,
      guaranteedPayablePaise: listing.breakdown.payablePaise,
      guaranteedPayable: formatPaise(listing.breakdown.payablePaise),
      bestCasePayablePaise: listing.breakdown.bestCasePayablePaise,
      bestCasePayable: formatPaise(listing.breakdown.bestCasePayablePaise),
      guaranteedDiscountPaise: listing.breakdown.guaranteedDiscountPaise,
      conditionalDiscountPaise: listing.breakdown.conditionalDiscountPaise,
      cashbackPaise: listing.breakdown.cashbackPaise,
      exchangeBonusPaise: listing.breakdown.exchangeBonusPaise,
      deliveryFeePaise: listing.breakdown.deliveryFeePaise,
      appliedOffers: listing.breakdown.applied.map((applied) => ({
        title: applied.title,
        kind: applied.kind,
        discountPaise: applied.discountPaise,
        certainty: applied.certainty,
        conditions: applied.conditions,
      })),
      skippedOffers: listing.breakdown.skipped.map((skipped) => ({
        title: skipped.title,
        reason: skipped.reason,
      })),
      emi: listing.breakdown.emi,
      provenance: listing.listing.provenance,
    };
  });

  return {
    ok: true,
    data: {
      productId: view.product.id,
      bestListingId: view.bestListingId,
      bestPayablePaise: view.bestPayablePaise,
      bestPayable: formatPaise(view.bestPayablePaise),
      bestPriceIsSample: view.bestPriceIsSample,
      listings: rows,
    },
    citations,
  };
}

export function toolGetPriceHistory(args: Record<string, unknown>, _context: ToolContext): ToolResult {
  const productId = typeof args.productId === 'string' ? args.productId : '';
  const view = buildProductView(productId, { includePriceHistory: true });
  if (!view) {
    return failure('not_found', `No product with id "${productId}".`, 'Call search_products first.');
  }

  const citations: Citation[] = [];
  const rows = view.listings.map((listing) => {
    citations.push({
      id: `history-${listing.listing.id}`,
      kind: 'price_history',
      label: `Price history for ${listing.listing.retailer}`,
      retailer: listing.listing.retailer,
      origin: listing.listing.provenance.origin,
    });
    return {
      listingId: listing.listing.id,
      retailer: listing.listing.retailer,
      stats: listing.priceStats,
      buyWait: listing.buyWait,
      provenance: listing.listing.provenance,
    };
  });

  return { ok: true, data: { productId, listings: rows }, citations };
}

export function toolGetReviewIntelligence(args: Record<string, unknown>, _context: ToolContext): ToolResult {
  const productId = typeof args.productId === 'string' ? args.productId : '';
  const view = buildProductView(productId, { includePriceHistory: false });
  if (!view) {
    return failure('not_found', `No product with id "${productId}".`, 'Call search_products first.');
  }

  const intelligence = view.reviewIntelligence;
  const citations: Citation[] = [];
  if (intelligence) {
    for (const aspect of intelligence.aspects) {
      for (const evidence of aspect.evidence.slice(0, 2)) {
        citations.push({
          id: evidence.reviewId,
          kind: 'review',
          label: evidence.quote.slice(0, 90),
          origin: 'live',
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      productId,
      reviewCount: intelligence?.reviewCount ?? 0,
      averageRating: intelligence?.averageRating ?? null,
      verifiedRatio: intelligence?.verifiedRatio ?? 0,
      negativeShare: intelligence?.negativeShare ?? 0,
      authenticityRisk: intelligence?.authenticityRisk ?? 0,
      authenticityCaveat: intelligence?.authenticityCaveat ?? null,
      signals: intelligence?.signals ?? [],
      aspects: (intelligence?.aspects ?? []).map((aspect) => ({
        aspect: aspect.aspect,
        mentionCount: aspect.mentionCount,
        sentiment: aspect.sentiment,
        negativeRate: aspect.negativeRate,
        topComplaints: aspect.topComplaints,
        topPraises: aspect.topPraises,
      })),
      complaints: intelligence?.complaints ?? [],
      positives: intelligence?.positives ?? [],
      longTermConcerns: intelligence?.longTermConcerns ?? [],
      languageBreakdown: intelligence?.languageBreakdown ?? {},
    },
    citations,
  };
}

export function toolCompareProducts(args: Record<string, unknown>, context: ToolContext): ToolResult {
  const productIds = Array.isArray(args.productIds)
    ? (args.productIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  if (productIds.length < 2) {
    return failure('invalid_arguments', 'At least two product ids are required.', 'Call with {"productIds":["id1","id2"]}.');
  }
  const comparison = buildComparison(productIds.slice(0, 4), context.shopper as never);
  return {
    ok: true,
    data: comparison,
    citations: comparison.productIds.map((id) => ({ id, kind: 'product', label: id, origin: 'derived' })),
  };
}

export function toolRecommend(args: Record<string, unknown>, context: ToolContext): ToolResult {
  const requirements: PurchaseRequirements = {
    ...context.requirements,
    ...(args.requirements as Partial<PurchaseRequirements> | undefined),
  };
  const { candidates, notes } = buildCandidates(
    requirements.category ?? undefined,
    requirements,
    context.shopper as never,
  );
  const result: RecommendationSet = buildRecommendationSet(candidates, requirements);

  const citations: Citation[] = result.recommendations.map((recommendation) => ({
    id: recommendation.productId,
    kind: 'product',
    label: `Recommendation: ${recommendation.productId}`,
    origin: 'derived',
  }));

  return {
    ok: true,
    data: {
      requirements,
      recommendations: result.recommendations,
      considered: result.considered,
      excluded: result.excluded,
      dataQualityNotes: [...notes, ...result.dataQualityNotes],
      degraded: result.degraded,
    },
    citations,
  };
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): ToolResult;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_products',
    description:
      'Find products in the catalogue matching a text query and/or category. Returns the best payable price per product.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search, e.g. "laptop" or "samsung".' },
        category: { type: 'string', description: 'Category id, e.g. "smartphone" or "laptop".' },
      },
      additionalProperties: false,
    },
    execute: toolSearchProducts,
  },
  {
    name: 'get_product',
    description: 'Get specifications, variants and highlights for one product.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
      additionalProperties: false,
    },
    execute: toolGetProduct,
  },
  {
    name: 'get_offers',
    description:
      'Get every retailer listing for a product with the full offer breakdown: guaranteed and conditional discounts, cashback, exchange, delivery and EMI.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
      additionalProperties: false,
    },
    execute: toolGetOffers,
  },
  {
    name: 'get_price_history',
    description: 'Get price statistics and the buy-now-or-wait assessment for each retailer listing.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
      additionalProperties: false,
    },
    execute: toolGetPriceHistory,
  },
  {
    name: 'get_review_intelligence',
    description:
      'Get recurring complaints, recurring praise, aspect sentiment and review-authenticity signals for a product.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
      additionalProperties: false,
    },
    execute: toolGetReviewIntelligence,
  },
  {
    name: 'compare_products',
    description: 'Compare two to four products across specifications, price and reliability.',
    parameters: {
      type: 'object',
      properties: {
        productIds: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
      },
      required: ['productIds'],
      additionalProperties: false,
    },
    execute: toolCompareProducts,
  },
  {
    name: 'recommend_products',
    description:
      'Score the catalogue against the purchase brief and return ranked, explainable recommendations.',
    parameters: {
      type: 'object',
      properties: {
        requirements: {
          type: 'object',
          description: 'Optional overrides for the parsed purchase brief.',
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    execute: toolRecommend,
  },
];

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

export function toolSchemas(): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}[] {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
