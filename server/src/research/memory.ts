/**
 * Research memory.
 *
 * Deep research repeats itself if nothing stops it. Two products with the
 * same model name generate the same queries; two rounds of investigation
 * generate the same queries again. This module is the memory that prevents
 * both.
 *
 * It remembers:
 *  - **queries already run**, so no query is issued twice;
 *  - **URLs already opened**, so no page is fetched twice;
 *  - **findings already made**, so a second round can build on them rather
 *    than rediscover them;
 *  - **questions already answered**, so the planner does not re-ask.
 *
 * The memory is scoped to one research session (one buyer, one decision) and
 * is never persisted across sessions.
 */

import { createHash } from 'node:crypto';

import type { ResearchFact } from './types.ts';

export interface MemoryEntry {
  /** The question this was meant to answer. */
  question: string;
  /** What came back. */
  finding: string;
  /** The sources that contributed. */
  sources: string[];
  /** When it was found. */
  foundAt: string;
}

export class ResearchMemory {
  /** Queries that have already been issued, with their result count. */
  private readonly queries = new Map<string, { hits: number; at: string }>();
  /** URLs that have already been opened, with the fact count they yielded. */
  private readonly pages = new Map<string, { facts: number; at: string }>();
  /** Findings, keyed by the question they answer. */
  private readonly findings = new Map<string, MemoryEntry>();
  /** The questions already answered. */
  private readonly answered = new Set<string>();
  /** Every source domain that has contributed. */
  private readonly domains = new Map<string, number>();

  /** A stable key for a query. */
  static key(query: string): string {
    return createHash('sha1').update(query.trim().toLowerCase()).digest('hex').slice(0, 16);
  }

  /** Has this query already been run? */
  hasQuery(query: string): boolean {
    return this.queries.has(ResearchMemory.key(query));
  }

  /** Record a query and how many hits it produced. */
  rememberQuery(query: string, hits: number): void {
    this.queries.set(ResearchMemory.key(query), { hits, at: new Date().toISOString() });
  }

  /** Has this URL already been opened? */
  hasPage(url: string): boolean {
    return this.pages.has(url);
  }

  /** Record a page and how many facts it yielded. */
  rememberPage(url: string, facts: number): void {
    this.pages.set(url, { facts, at: new Date().toISOString() });
    this.noteDomain(url);
  }

  /** Record a finding against a question. */
  rememberFinding(question: string, finding: string, sources: string[]): void {
    const key = question.trim().toLowerCase();
    this.findings.set(key, {
      question,
      finding,
      sources,
      foundAt: new Date().toISOString(),
    });
    this.answered.add(key);
  }

  /** Has this question already been answered? */
  isAnswered(question: string): boolean {
    return this.answered.has(question.trim().toLowerCase());
  }

  /** The finding for a question, if there is one. */
  findingFor(question: string): MemoryEntry | null {
    return this.findings.get(question.trim().toLowerCase()) ?? null;
  }

  /** Every finding so far. */
  allFindings(): MemoryEntry[] {
    return [...this.findings.values()];
  }

  /** Record that a domain has contributed, and how many facts. */
  noteDomain(url: string): void {
    let domain: string;
    try {
      domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return;
    }
    this.domains.set(domain, (this.domains.get(domain) ?? 0) + 1);
  }

  /** How many facts a domain has contributed. */
  domainWeight(domain: string): number {
    return this.domains.get(domain.toLowerCase()) ?? 0;
  }

  /** The domains that have contributed so far. */
  knownDomains(): string[] {
    return [...this.domains.keys()];
  }

  /** How many queries have been run. */
  get queryCount(): number {
    return this.queries.size;
  }

  /** How many pages have been opened. */
  get pageCount(): number {
    return this.pages.size;
  }

  /** A summary for the trace and the UI. */
  summary(): {
    queriesRun: number;
    pagesOpened: number;
    findings: number;
    domains: string[];
  } {
    return {
      queriesRun: this.queries.size,
      pagesOpened: this.pages.size,
      findings: this.findings.size,
      domains: [...this.domains.keys()],
    };
  }

  /**
   * The facts gathered so far, for the next round to build on.
   */
  facts(): ResearchFact[] {
    const out: ResearchFact[] = [];
    for (const entry of this.findings.values()) {
      out.push({
        id: `memory:${entry.question.slice(0, 24)}`,
        productId: '',
        variantId: null,
        kind: 'source_page',
        key: entry.question.slice(0, 40),
        value: entry.finding,
        unit: null,
        sourceUrl: entry.sources[0] ?? '',
        sourceDomain: entry.sources[0] ?? 'memory',
        retrievedAt: entry.foundAt,
        verifiedAt: entry.foundAt,
        evidence: { excerpt: entry.finding, locator: null, selector: null, offset: null },
        confidence: 0.5,
        origin: 'live',
        extractionMethod: 'search_snippet',
        freshness: 'fresh',
        verification: 'single_source',
        corroboratingSources: 1,
        conflictingSources: [],
      });
    }
    return out;
  }
}
