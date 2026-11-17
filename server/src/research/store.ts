/**
 * Persistence of research facts.
 *
 * Facts are stored with their full provenance: which source, when it was
 * retrieved, when it was verified, how it was extracted, how confident we
 * are, and what the supporting excerpt was. A price and a part number live
 * in the same table but have completely different lifetimes, so the
 * freshness verdict is computed against each fact kind's own policy.
 */

import { run, select, selectOne } from '../db/index.ts';
import { ttlFor, type FactKind } from '../intelligence/cache/freshness.ts';
import { FACT_KIND_FRESHNESS, type ResearchFact } from './types.ts';

/** Compute the freshness verdict of a fact against its kind's policy. */
export function freshnessOf(fact: ResearchFact, now = Date.now()): ResearchFact['freshness'] {
  const policy = FACT_KIND_FRESHNESS[fact.kind];
  if (!policy) return 'unknown';

  const ttl = ttlFor(policy as FactKind);
  const age = now - Date.parse(fact.retrievedAt);
  if (!Number.isFinite(age)) return 'unknown';
  if (age < 0) return 'fresh';
  if (age <= ttl) return 'fresh';
  if (age <= ttl * 3) return 'stale';
  return 'expired';
}

export interface SaveContext {
  runId: string;
  productId: string;
  variantId: string | null;
  category: string;
  startedAt: string;
}

/**
 * Save research facts.
 *
 * Facts are keyed by product, variant, kind and key. Re-running the research
 * replaces the fact for that key rather than accumulating duplicates — the
 * newest observation wins, and the previous one is recorded in the history
 * table so a price series can be built from real observations.
 */
export function saveResearchFacts(facts: ResearchFact[], context: SaveContext): number {
  const now = Date.now();
  let saved = 0;

  for (const fact of facts) {
    const freshness = freshnessOf(fact, now);

    run(
      `INSERT INTO research_facts (
         id, product_id, variant_id, fact_kind, fact_key, value_text, value_number,
         value_bool, unit, source_url, source_domain, retrieved_at, verified_at,
         evidence_excerpt, evidence_locator, confidence, origin, extraction_method,
         freshness, verification_status, corroborating_sources, conflicting_sources_json,
         research_run_id, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         value_text = excluded.value_text,
         value_number = excluded.value_number,
         value_bool = excluded.value_bool,
         unit = excluded.unit,
         source_url = excluded.source_url,
         source_domain = excluded.source_domain,
         retrieved_at = excluded.retrieved_at,
         verified_at = excluded.verified_at,
         evidence_excerpt = excluded.evidence_excerpt,
         evidence_locator = excluded.evidence_locator,
         confidence = excluded.confidence,
         origin = excluded.origin,
         extraction_method = excluded.extraction_method,
         freshness = excluded.freshness,
         verification_status = excluded.verification_status,
         corroborating_sources = excluded.corroborating_sources,
         conflicting_sources_json = excluded.conflicting_sources_json,
         research_run_id = excluded.research_run_id,
         updated_at = excluded.updated_at`,
      fact.id,
      fact.productId,
      fact.variantId,
      fact.kind,
      fact.key,
      typeof fact.value === 'string' ? fact.value : null,
      typeof fact.value === 'number' ? fact.value : null,
      typeof fact.value === 'boolean' ? (fact.value ? 1 : 0) : null,
      fact.unit ?? null,
      fact.sourceUrl,
      fact.sourceDomain,
      fact.retrievedAt,
      fact.verifiedAt,
      fact.evidence?.excerpt ?? null,
      fact.evidence?.locator ?? null,
      fact.confidence,
      fact.origin,
      fact.extractionMethod,
      freshness,
      fact.verification,
      fact.corroboratingSources,
      JSON.stringify(fact.conflictingSources),
      context.runId,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    );

    // Keep a history row so a price series can be built from real observations.
    if (fact.kind === 'price' || fact.kind === 'stock' || fact.kind === 'offer') {
      run(
        `INSERT INTO research_observations (
           id, fact_id, product_id, variant_id, fact_kind, fact_key, value_text,
           value_number, source_url, source_domain, observed_at, research_run_id
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        `${fact.id}-${now}-${Math.floor(Math.random() * 1000)}`,
        fact.id,
        fact.productId,
        fact.variantId,
        fact.kind,
        fact.key,
        typeof fact.value === 'string' ? fact.value : null,
        typeof fact.value === 'number' ? fact.value : null,
        fact.sourceUrl,
        fact.sourceDomain,
        fact.retrievedAt,
        context.runId,
      );
    }

    saved += 1;
  }

  recordRun(context, facts.length);
  return saved;
}

/** Record the run itself. */
export function recordRun(context: SaveContext, factCount: number): void {
  run(
    `INSERT INTO research_runs (
       id, product_id, variant_id, category, started_at, finished_at,
       status, facts_found, notes
     ) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       finished_at = excluded.finished_at,
       facts_found = excluded.facts_found`,
    context.runId,
    context.productId,
    context.variantId,
    context.category,
    context.startedAt,
    new Date().toISOString(),
    'completed',
    factCount,
    null,
  );
}

interface FactRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  fact_kind: string;
  fact_key: string;
  value_text: string | null;
  value_number: number | null;
  value_bool: number | null;
  unit: string | null;
  source_url: string;
  source_domain: string;
  retrieved_at: string;
  verified_at: string | null;
  evidence_excerpt: string | null;
  evidence_locator: string | null;
  confidence: number;
  origin: string;
  extraction_method: string;
  freshness: string;
  verification_status: string;
  corroborating_sources: number;
  conflicting_sources_json: string;
}

/** Read the stored facts for a product. */
export function factsForProduct(productId: string, variantId?: string | null): ResearchFact[] {
  const rows = variantId
    ? select<FactRow>(
        'SELECT * FROM research_facts WHERE product_id = ? AND variant_id = ? ORDER BY fact_kind, fact_key',
        productId,
        variantId,
      )
    : select<FactRow>(
        'SELECT * FROM research_facts WHERE product_id = ? ORDER BY fact_kind, fact_key',
        productId,
      );

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    kind: row.fact_kind as ResearchFact['kind'],
    key: row.fact_key,
    value:
      row.value_number !== null
        ? row.value_number
        : row.value_bool !== null
          ? row.value_bool === 1
          : (row.value_text ?? null),
    unit: row.unit,
    sourceUrl: row.source_url,
    sourceDomain: row.source_domain,
    retrievedAt: row.retrieved_at,
    verifiedAt: row.verified_at,
    evidence: row.evidence_excerpt
      ? { excerpt: row.evidence_excerpt, locator: row.evidence_locator, selector: null, offset: null }
      : null,
    confidence: row.confidence,
    origin: row.origin as ResearchFact['origin'],
    extractionMethod: row.extraction_method as ResearchFact['extractionMethod'],
    freshness: row.freshness as ResearchFact['freshness'],
    verification: row.verification_status as ResearchFact['verification'],
    corroboratingSources: row.corroborating_sources,
    conflictingSources: safeParseArray(row.conflicting_sources_json),
  }));
}

/** A price observation series for a product, from real retrievals. */
export function priceObservations(productId: string): {
  observedAt: string;
  valuePaise: number | null;
  sourceUrl: string;
  sourceDomain: string;
}[] {
  const rows = select<{
    observed_at: string;
    value_text: string | null;
    value_number: number | null;
    source_url: string;
    source_domain: string;
  }>(
    `SELECT o.observed_at, o.value_text, o.value_number, o.source_url, o.source_domain
       FROM research_observations o
      WHERE o.product_id = ? AND o.fact_kind = 'price'
      ORDER BY o.observed_at`,
    productId,
  );

  return rows.map((row) => ({
    observedAt: row.observed_at,
    valuePaise: row.value_number,
    sourceUrl: row.source_url,
    sourceDomain: row.source_domain,
  }));
}

/** The last research run for a product. */
export function lastRunForProduct(productId: string): {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  factsFound: number;
} | null {
  const row = selectOne<{
    id: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    facts_found: number;
  }>(
    'SELECT * FROM research_runs WHERE product_id = ? ORDER BY started_at DESC LIMIT 1',
    productId,
  );
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    factsFound: row.facts_found,
  };
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
