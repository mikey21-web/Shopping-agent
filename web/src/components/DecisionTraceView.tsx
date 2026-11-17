/**
 * Decision trace view.
 *
 * Shows the shopper *why* the decision was made, not just what it was.
 * Every section comes from the deterministic decision engine, so nothing
 * here is a guess or a model's post-hoc story.
 *
 * The eight dimensions are shown with their weights and the evidence that
 * moved them, so a shopper can challenge any part of the ranking.
 */

import type { DecisionTrace, DimensionView } from '../lib/api.ts';
import { Badge, Card } from './ui.tsx';

/** Pull the human-readable summary out of a trace section. */
function summaryOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ['summary', 'headline', 'text', 'reason', 'label']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  return null;
}

/** Render one trace section as a list of lines. */
function Lines({ items, empty }: { items: unknown[]; empty: string }) {
  if (items.length === 0) return <p className="text-[11px] text-mist-500">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 8).map((item, index) => {
        const text = summaryOf(item);
        if (!text) return null;
        return (
          <li key={index} className="flex gap-2 text-[11px] text-mist-300">
            <span className="text-saffron-400">▸</span>
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Score bar, with unknown dimensions shown distinctly. */
function ScoreBar({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-[10px] text-mist-500">unknown</span>;
  }
  const width = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const colour = width >= 70 ? 'bg-jade-400' : width >= 40 ? 'bg-saffron-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 overflow-hidden rounded-full bg-ink-700">
        <div className={`h-full ${colour}`} style={{ width: `${width}%` }} />
      </div>
      <span className="tabular-nums text-[10px] text-mist-400">{width}%</span>
    </div>
  );
}

export function DecisionTraceView({
  trace,
  dimensions,
}: {
  trace: DecisionTrace;
  dimensions: DimensionView[];
}) {
  const requirements = summaryOf(trace.requirements);
  const winner = summaryOf(trace.winnerRationale);

  return (
    <details className="rounded-xl border border-jade-500/20 bg-jade-500/4 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-jade-300">
        <span>Why this recommendation?</span>
        <Badge tone="jade" className="text-[9px]">decision trace</Badge>
      </summary>

      <div className="mt-3 space-y-4">
        {requirements ? (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
              What was asked for
            </p>
            <p className="mt-1 text-[11px] text-mist-300">{requirements}</p>
          </section>
        ) : null}

        {dimensions.length > 0 ? (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
              The eight decision dimensions
            </p>
            <div className="mt-2 space-y-1.5">
              {dimensions.map((dimension) => (
                <div key={dimension.id} className="rounded-lg border border-ink-700/60 bg-ink-900/40 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-mist-200">{dimension.label}</span>
                    <ScoreBar score={dimension.score} />
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
                    {dimension.summary}
                  </p>
                  {dimension.missing.length > 0 ? (
                    <p className="mt-1 text-[10px] text-rose-300/80">
                      Missing: {dimension.missing.join('; ')}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
            Products eliminated by hard constraints
          </p>
          <div className="mt-1">
            <Lines
              items={trace.eliminated ?? []}
              empty="No product violated a hard constraint."
            />
          </div>
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
            Why the winner wins
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-mist-300">
            {winner ?? 'The highest-scoring product after constraints and evidence were applied.'}
          </p>
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
            Trade-offs
          </p>
          <div className="mt-1">
            <Lines items={trace.tradeOffs ?? []} empty="No material trade-offs were identified." />
          </div>
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
            What could change this decision
          </p>
          <div className="mt-1">
            <Lines
              items={trace.sensitivity ?? []}
              empty="No single missing fact would change the ranking."
            />
          </div>
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
            Missing evidence
          </p>
          <div className="mt-1">
            <Lines
              items={trace.missingInformation ?? []}
              empty="No important evidence is missing."
            />
          </div>
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">
            Evidence ({trace.evidence?.length ?? 0} facts)
          </p>
          <div className="mt-1">
            <Lines items={trace.evidence ?? []} empty="No evidence was recorded." />
          </div>
        </section>
      </div>
    </details>
  );
}
