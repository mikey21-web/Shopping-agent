import type { ReviewIntelligence } from '../lib/api.ts';
import { formatDate, humanise, percent } from '../lib/format.ts';
import { Badge, Card, ScoreBar } from './ui.tsx';

/**
 * Review intelligence panel.
 *
 * Shows recurring complaints and praise with the quotes that support them,
 * plus a clearly-caveated authenticity assessment. The caveat is mandatory —
 * these are signals, not verdicts about individual reviews.
 */
export function ReviewIntelligencePanel({
  intelligence,
}: {
  intelligence: ReviewIntelligence | null;
}) {
  if (!intelligence || intelligence.reviewCount === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-mist-50">Owner feedback</h3>
        <p className="mt-2 text-xs leading-relaxed text-mist-500">
          No customer review data has been collected for this product yet. SahiPick will not invent owner
          feedback — when reviews are available, the recurring complaints and praises appear here with the
          evidence attached.
        </p>
      </Card>
    );
  }

  const languageTotal = Object.values(intelligence.languageBreakdown).reduce((sum, value) => sum + value, 0);

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-mist-50">Owner feedback</h3>
            <p className="mt-0.5 text-[11px] text-mist-500">
              {intelligence.reviewCount} reviews analysed · {intelligence.averageRating.toFixed(1)}★ average ·{' '}
              {percent(intelligence.verifiedRatio)} verified purchase
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-mist-500">Negative share</p>
            <p className="text-lg font-semibold tabular-nums text-mist-50">
              {percent(intelligence.negativeShare)}
            </p>
          </div>
        </div>

        {languageTotal > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(intelligence.languageBreakdown).map(([language, count]) => (
              <Badge key={language} tone="neutral">
                {humanise(language)} · {count}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      {intelligence.complaints.length > 0 ? (
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-300">
            Recurring complaints
          </h4>
          <ul className="mt-2 space-y-1.5">
            {intelligence.complaints.map((complaint) => (
              <li key={complaint} className="flex gap-2 text-xs leading-relaxed text-mist-200">
                <span aria-hidden className="text-rose-400">
                  •
                </span>
                <span>{complaint}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {intelligence.longTermConcerns.length > 0 ? (
        <Card className="border-saffron-500/25 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-saffron-300">
            Appears in longer-term ownership
          </h4>
          <ul className="mt-2 space-y-1.5">
            {intelligence.longTermConcerns.map((concern) => (
              <li key={concern} className="flex gap-2 text-xs leading-relaxed text-mist-200">
                <span aria-hidden className="text-saffron-400">
                  •
                </span>
                <span>{concern}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-mist-500">
            Complaints that cluster in reviews written months after purchase usually point to degradation
            rather than a defect caught on day one.
          </p>
        </Card>
      ) : null}

      {intelligence.positives.length > 0 ? (
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-jade-300">
            What owners consistently praise
          </h4>
          <ul className="mt-2 space-y-1.5">
            {intelligence.positives.map((positive) => (
              <li key={positive} className="flex gap-2 text-xs leading-relaxed text-mist-200">
                <span aria-hidden className="text-jade-400">
                  •
                </span>
                <span>{positive}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {intelligence.aspects.length > 0 ? (
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-mist-300">Aspect sentiment</h4>
          <div className="mt-3 space-y-2.5">
            {intelligence.aspects.slice(0, 8).map((aspect) => (
              <div key={aspect.aspect}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="capitalize text-mist-300">{humanise(aspect.aspect)}</span>
                  <span className="tabular-nums text-mist-500">
                    {aspect.mentionCount} mention{aspect.mentionCount === 1 ? '' : 's'} ·{' '}
                    {Math.round((aspect.sentiment + 1) * 50)}%
                  </span>
                </div>
                <div className="mt-1">
                  <ScoreBar
                    value={(aspect.sentiment + 1) / 2}
                    tone={aspect.sentiment >= 0.2 ? 'jade' : aspect.sentiment >= -0.2 ? 'saffron' : 'rose'}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {intelligence.aspects.some((aspect) => aspect.evidence.length > 0) ? (
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-mist-300">Evidence</h4>
          <div className="mt-2.5 space-y-2.5">
            {intelligence.aspects
              .filter((aspect) => aspect.evidence.length > 0)
              .slice(0, 4)
              .map((aspect) => (
                <div key={aspect.aspect}>
                  <p className="text-[10px] uppercase tracking-wide text-mist-500">
                    {humanise(aspect.aspect)}
                  </p>
                  {aspect.evidence.slice(0, 2).map((evidence) => (
                    <blockquote
                      key={evidence.reviewId}
                      className="mt-1 border-l-2 border-ink-600 pl-2 text-[11px] leading-relaxed text-mist-300"
                    >
                      “{evidence.quote}”
                      <footer className="mt-0.5 text-[10px] text-mist-500">
                        {evidence.rating}★ · {evidence.verifiedPurchase ? 'verified purchase' : 'verified status unknown'} ·{' '}
                        {formatDate(evidence.reviewedAt)} · {humanise(evidence.language)}
                      </footer>
                    </blockquote>
                  ))}
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      {intelligence.signals.length > 0 ? (
        <Card className="border-saffron-500/25 p-4">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-saffron-300">
              Review pattern signals
            </h4>
            <Badge tone={intelligence.authenticityRisk >= 0.5 ? 'rose' : 'saffron'}>
              risk {Math.round(intelligence.authenticityRisk * 100)}%
            </Badge>
          </div>
          <ul className="mt-2.5 space-y-2">
            {intelligence.signals.map((signal) => (
              <li key={signal.kind} className="text-[11px] leading-relaxed text-mist-300">
                <span className="font-medium text-mist-100">{humanise(signal.kind)}</span> — {signal.explanation}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-ink-700 pt-2.5 text-[10px] leading-relaxed text-mist-500">
            {intelligence.authenticityCaveat}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
