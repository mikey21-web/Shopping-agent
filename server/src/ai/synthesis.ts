/**
 * Model-written synthesis.
 *
 * The deterministic composer produces a correct but mechanical answer. When a
 * model is configured, it can write a better one — but only inside the same
 * bounds:
 *
 *  - it is given the verified facts and nothing else;
 *  - it is told to use only those facts and never to compute a price;
 *  - its output goes through the same citation gate as the deterministic
 *    answer, so a hallucinated price is caught and the answer is discarded.
 *
 * The model never touches the financial path. Every number in the answer
 * comes from the price engine.
 */

import type { LlmMessage } from './provider.ts';
import { getActiveProvider } from './provider.ts';
import { toolSchemas } from './tools.ts';
import { describeRequirements } from './intent.ts';
import type { PurchaseRequirements } from '../domain/types.ts';
import { formatPaise } from '../intelligence/normalize/specs.ts';

/** The facts a product contributes to the written answer. */
export interface SynthesisFact {
  name: string;
  badge: string | null;
  price: string;
  retailer: string | null;
  strengths: string[];
  weaknesses: string[];
  score: number;
  /** The dimensions that carried the decision. */
  dimensions?: { label: string; summary: string }[];
  /** The confidence band of the decision. */
  confidence?: string;
}

/**
 * Ask the configured model to write the synthesis, giving it only the facts
 * we gathered. If it fails the citation gate the caller discards its answer.
 */
export async function composeSynthesisWithModel(options: {
  provider?: ReturnType<typeof getActiveProvider>;
  requirements: PurchaseRequirements;
  facts: SynthesisFact[];
  notes: string[];
  followUpQuestions: string[];
  deadline: number;
}): Promise<string | null> {
  const provider = options.provider ?? getActiveProvider();
  const { requirements, facts, notes, followUpQuestions, deadline } = options;

  if (provider.id === 'local' || !provider.isAvailable()) return null;
  if (Date.now() > deadline) return null;

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
        notes.length > 0 ? `\nData quality notes: ${notes.join(' ')}` : '',
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

/** Build the synthesis facts from a decision result. */
export function factsFromDecisions(
  decisions: {
    displayName: string;
    badge: string | null;
    pricePaise: number | null;
    retailer: string | null;
    score: number;
    strengths: string[];
    weaknesses: string[];
    confidence: string;
    dimensions: { label: string; summary: string }[];
  }[],
): SynthesisFact[] {
  return decisions.map((decision) => ({
    name: decision.displayName,
    badge: decision.badge,
    price: decision.pricePaise !== null ? formatPaise(decision.pricePaise) : 'unavailable',
    retailer: decision.retailer,
    strengths: decision.strengths,
    weaknesses: decision.weaknesses,
    score: decision.score,
    dimensions: decision.dimensions,
    confidence: decision.confidence,
  }));
}
