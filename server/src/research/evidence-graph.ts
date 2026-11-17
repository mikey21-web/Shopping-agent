/**
 * The evidence graph.
 *
 * Facts are not independent: a specification supports a price, a price is
 * observed at a source, two sources corroborate or contradict each other,
 * and a claim about a variant belongs to a product. The evidence graph holds
 * those relationships so that:
 *
 *  - a contradiction can be traced to the two claims that caused it;
 *  - a fact's confidence can be raised because an independent source
 *    corroborates it;
 *  - the reason a product was recommended can be reconstructed.
 *
 * The graph is a plain in-memory structure with stable node ids. It is
 * serialisable so it can be returned by the API and stored with the run.
 */

import type { ResearchConflict, ResearchFact, ResearchFactKind } from './types.ts';

/** The kinds of node in the graph. */
export type GraphNodeKind = 'product' | 'variant' | 'source' | 'fact' | 'observation' | 'question';

/** A node in the evidence graph. */
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Free-form attributes. */
  attributes: Record<string, string | number | boolean | null>;
}

/** An edge in the evidence graph. */
export interface GraphEdge {
  from: string;
  to: string;
  /**
   * The relationship.
   * `asserts`   — a source asserts a fact
   * `observes`  — a source made an observation at a time
   * `corroborates` — an independent source agrees
   * `contradicts`  — an independent source disagrees
   * `describes` — a fact describes a product or variant
   * `answers`   — a fact answers a question
   */
  relation:
    | 'asserts'
    | 'observes'
    | 'corroborates'
    | 'contradicts'
    | 'describes'
    | 'answers'
    | 'belongs_to';
  /** The confidence of the relationship itself. */
  confidence: number;
}

/** The graph. */
export class EvidenceGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];

  /** Add or update a node. */
  addNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) {
      existing.attributes = { ...existing.attributes, ...node.attributes };
      existing.label = node.label || existing.label;
      return existing;
    }
    this.nodes.set(node.id, node);
    return node;
  }

  /** Add an edge, skipping duplicates. */
  addEdge(edge: GraphEdge): void {
    const duplicate = this.edges.some(
      (existing) =>
        existing.from === edge.from &&
        existing.to === edge.to &&
        existing.relation === edge.relation,
    );
    if (!duplicate) this.edges.push(edge);
  }

  /** The node for a product. */
  addProduct(productId: string, label: string, category: string): GraphNode {
    return this.addNode({
      id: `product:${productId}`,
      kind: 'product',
      label,
      attributes: { category },
    });
  }

  /** The node for a source. */
  addSource(url: string, domain: string): GraphNode {
    return this.addNode({
      id: `source:${domain}`,
      kind: 'source',
      label: domain,
      attributes: { url },
    });
  }

  /** The node for a fact. */
  addFact(fact: ResearchFact): GraphNode {
    return this.addNode({
      id: `fact:${fact.id}`,
      kind: 'fact',
      label: `${fact.key}: ${String(fact.value ?? 'unknown')}`,
      attributes: {
        kind: fact.kind,
        productId: fact.productId,
        variantId: fact.variantId,
        confidence: fact.confidence,
        freshness: fact.freshness,
        verification: fact.verification,
        origin: fact.origin,
        method: fact.extractionMethod,
        sourceUrl: fact.sourceUrl,
        retrievedAt: fact.retrievedAt,
      },
    });
  }

  /**
   * Add a fact and wire it into the graph.
   */
  recordFact(fact: ResearchFact, productLabel: string, category: string): void {
    this.addProduct(fact.productId, productLabel, category);
    this.addSource(fact.sourceUrl, fact.sourceDomain);
    this.addFact(fact);

    this.addEdge({
      from: `source:${fact.sourceDomain}`,
      to: `fact:${fact.id}`,
      relation: 'asserts',
      confidence: fact.confidence,
    });
    this.addEdge({
      from: `fact:${fact.id}`,
      to: `product:${fact.productId}`,
      relation: 'describes',
      confidence: fact.confidence,
    });
    if (fact.variantId) {
      this.addNode({
        id: `variant:${fact.variantId}`,
        kind: 'variant',
        label: fact.variantId,
        attributes: { productId: fact.productId },
      });
      this.addEdge({
        from: `fact:${fact.id}`,
        to: `variant:${fact.variantId}`,
        relation: 'belongs_to',
        confidence: fact.confidence,
      });
    }
  }

  /**
   * Record a conflict as two contradicting facts.
   */
  recordConflict(conflict: ResearchConflict): void {
    const positions = conflict.positions.slice(0, 2);
    if (positions.length < 2) return;

    for (const position of positions) {
      const domain = position.sourceDomain;
      this.addSource(position.sourceUrl, domain);
      const nodeId = `fact:conflict:${conflict.factKind}:${conflict.key}:${domain}`;
      this.addNode({
        id: nodeId,
        kind: 'fact',
        label: `${conflict.key}: ${String(position.value ?? 'unknown')}`,
        attributes: {
          kind: conflict.factKind,
          value: position.value,
          sourceUrl: position.sourceUrl,
          observedAt: position.observedAt,
        },
      });
      this.addEdge({
        from: `source:${domain}`,
        to: nodeId,
        relation: 'asserts',
        confidence: position.confidence,
      });
    }

    this.addEdge({
      from: `fact:conflict:${conflict.factKind}:${conflict.key}:${positions[0]?.sourceDomain ?? ''}`,
      to: `fact:conflict:${conflict.factKind}:${conflict.key}:${positions[1]?.sourceDomain ?? ''}`,
      relation: 'contradicts',
      confidence: 0.9,
    });
  }

  /** The facts that contradict each other, as pairs of ids. */
  contradictions(): { a: string; b: string; subject: string }[] {
    const out: { a: string; b: string; subject: string }[] = [];
    for (const edge of this.edges) {
      if (edge.relation !== 'contradicts') continue;
      const subject = this.nodes.get(edge.from)?.label ?? 'unknown';
      out.push({ a: edge.from, b: edge.to, subject });
    }
    return out;
  }

  /** How many independent sources back a fact. */
  supportingSources(factId: string): number {
    const sources = new Set<string>();
    for (const edge of this.edges) {
      if (edge.relation === 'asserts' && edge.to === `fact:${factId}`) {
        sources.add(edge.from);
      }
    }
    return sources.size;
  }

  /** The whole graph, for serialisation. */
  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: [...this.nodes.values()], edges: [...this.edges] };
  }

  /** A summary for the UI. */
  summary(): {
    nodes: number;
    edges: number;
    products: number;
    sources: number;
    facts: number;
    contradictions: number;
  } {
    const count = (kind: GraphNodeKind): number =>
      [...this.nodes.values()].filter((node) => node.kind === kind).length;

    return {
      nodes: this.nodes.size,
      edges: this.edges.length,
      products: count('product'),
      sources: count('source'),
      facts: count('fact'),
      contradictions: this.contradictions().length,
    };
  }

  /** The fact kinds that the graph holds, with their counts. */
  factKindCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      if (node.kind !== 'fact') continue;
      const kind = String(node.attributes.kind ?? 'unknown');
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  }

  /** The product ids the graph covers. */
  productIds(): string[] {
    const ids = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.kind !== 'product') continue;
      const productId = node.attributes.productId;
      if (typeof productId === 'string') ids.add(productId);
    }
    return [...ids];
  }
}

/** The fact kinds that a decision genuinely needs. */
export const DECISION_CRITICAL_KINDS: ResearchFactKind[] = [
  'model_identification',
  'variant_identification',
  'price',
  'specification',
  'stock',
];

/**
 * Is the research good enough to make a decision?
 *
 * Decision readiness has three conditions, and it stops when any of them is
 * met:
 *
 *  1. **Sufficient** — every blocking question has been answered and the
 *     decision-critical fact kinds are covered.
 *  2. **Diminishing returns** — the last round produced materially fewer new
 *     facts than the one before, so another round will not help.
 *  3. **Budget or time exhausted** — the run has hit its deadline or its
 *     page budget.
 *
 * It stops research; it never starts a recommendation on its own.
 */
export interface ReadinessAssessment {
  /** True when the research can support a recommendation. */
  ready: boolean;
  /** Which condition ended the research. */
  reason:
    | 'sufficient'
    | 'diminishing_returns'
    | 'budget_exhausted'
    | 'time_exhausted'
    | 'max_rounds'
    | 'insufficient_evidence';
  /** The questions that are still unanswered. */
  unanswered: string[];
  /** The questions where sources disagreed. */
  conflicted: string[];
  /** The fact kinds that are still missing. */
  missingKinds: ResearchFactKind[];
  /** 0..1 — how complete the research is. */
  completeness: number;
  /** A plain-language explanation. */
  explanation: string;
}

/** Assess whether the research is ready. */
export function assessReadiness(input: {
  /** The questions in the plan. */
  questions: { id: string; blocking: boolean; factKinds: ResearchFactKind[] }[];
  /** The facts gathered so far. */
  facts: ResearchFact[];
  /** The conflicts found. */
  conflicts: ResearchConflict[];
  /** Facts found in the previous round, for the diminishing-returns check. */
  previousRoundFacts: number;
  /** Facts found in this round. */
  currentRoundFacts: number;
  /** How many rounds have run. */
  rounds: number;
  /** The maximum number of rounds. */
  maxRounds: number;
  /** Whether the deadline is past. */
  timeExhausted: boolean;
  /** Whether the page budget is spent. */
  budgetExhausted: boolean;
}): ReadinessAssessment {
  const covered = new Set(input.facts.map((fact) => fact.kind));

  const missingKinds = DECISION_CRITICAL_KINDS.filter((kind) => !covered.has(kind));

  const answeredQuestionIds = new Set<string>();
  for (const fact of input.facts) {
    for (const question of input.questions) {
      if (question.factKinds.includes(fact.kind)) answeredQuestionIds.add(question.id);
    }
  }

  const unanswered = input.questions
    .filter((question) => question.blocking && !answeredQuestionIds.has(question.id))
    .map((question) => question.id);

  const conflicted = [...new Set(input.conflicts.map((conflict) => conflict.key))];

  const blockingQuestions = input.questions.filter((question) => question.blocking);
  const completeness =
    blockingQuestions.length > 0
      ? Number(
          (blockingQuestions.filter((question) => answeredQuestionIds.has(question.id)).length /
            blockingQuestions.length).toFixed(3),
        )
      : 1;

  if (input.timeExhausted) {
    return {
      ready: true,
      reason: 'time_exhausted',
      unanswered,
      conflicted,
      missingKinds,
      completeness,
      explanation:
        'The research deadline was reached, so the decision is made on the evidence gathered so far and the gaps are reported.',
    };
  }

  if (input.budgetExhausted) {
    return {
      ready: true,
      reason: 'budget_exhausted',
      unanswered,
      conflicted,
      missingKinds,
      completeness,
      explanation:
        'The page budget was reached, so the decision is made on the evidence gathered so far and the gaps are reported.',
    };
  }

  if (input.rounds >= input.maxRounds) {
    return {
      ready: true,
      reason: 'max_rounds',
      unanswered,
      conflicted,
      missingKinds,
      completeness,
      explanation: `The research ran its maximum of ${input.maxRounds} rounds; further investigation was unlikely to add much.`,
    };
  }

  // Diminishing returns: the last round added less than a fifth as much as
  // the one before it.
  if (
    input.previousRoundFacts > 0 &&
    input.currentRoundFacts > 0 &&
    input.currentRoundFacts < input.previousRoundFacts / 5
  ) {
    return {
      ready: true,
      reason: 'diminishing_returns',
      unanswered,
      conflicted,
      missingKinds,
      completeness,
      explanation:
        'The last round of research added very little new evidence, so further searching was not worth the time.',
    };
  }

  if (unanswered.length === 0 && missingKinds.length === 0) {
    return {
      ready: true,
      reason: 'sufficient',
      unanswered,
      conflicted,
      missingKinds,
      completeness,
      explanation: 'Every question needed for the decision has been answered.',
    };
  }

  if (input.currentRoundFacts === 0 && input.rounds > 0) {
    return {
      ready: true,
      reason: 'insufficient_evidence',
      unanswered,
      conflicted,
      missingKinds,
      completeness,
      explanation:
        'The sources consulted did not publish the information this decision needs. The gaps are reported rather than filled with estimates.',
    };
  }

  return {
    ready: false,
    reason: 'insufficient_evidence',
    unanswered,
    conflicted,
    missingKinds,
    completeness,
    explanation: `Still investigating: ${unanswered.length} blocking question${unanswered.length === 1 ? '' : 's'} and ${missingKinds.length} fact kind${missingKinds.length === 1 ? '' : 's'} outstanding.`,
  };
}
