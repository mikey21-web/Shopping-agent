import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type ProductView } from '../lib/api.ts';
import { formatPaise, humanise, retailerName } from '../lib/format.ts';
import { Badge, Card, EmptyState, ErrorNote, SectionTitle, Skeleton } from '../components/ui.tsx';
import { ProvenanceBadge, SampleDataNotice } from '../components/Provenance.tsx';
import { ListingCard, PriceHistoryChart } from '../components/PriceIntelligence.tsx';
import { ReviewIntelligencePanel } from '../components/ReviewIntelligence.tsx';

interface HistoryPoint {
  pricePaise: number;
  recordedAt: string;
  origin: string;
}

export function ProductDetail() {
  const { id = '' } = useParams();
  const [view, setView] = useState<ProductView | null>(null);
  const [history, setHistory] = useState<{
    points: HistoryPoint[];
    listingId: string;
    retailer: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .product(id)
      .then(async (result) => {
        if (cancelled) return;
        setView(result);
        // Price history loads after the product renders, so the page is useful
        // before the chart arrives.
        try {
          const points = await api.priceHistory(id);
          if (!cancelled) {
            setHistory({
              points: points.points,
              listingId: points.listingId,
              retailer: points.retailer,
            });
          }
        } catch {
          if (!cancelled) setHistory(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load that product');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 w-full sm:h-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (error || !view) {
    return (
      <EmptyState
        title="Product not found"
        message={error ?? 'That product is not in the catalogue.'}
        icon="?"
      />
    );
  }

  const { product } = view;
  const specs = product.specs as Record<string, unknown>;
  const specEntries = Object.entries(specs).filter(
    ([key, value]) => key !== 'extra' && value !== undefined && value !== null && value !== '',
  );
  const extra = (specs.extra ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-5">
      <Link to="/discover" className="text-[11px] text-mist-500 hover:text-mist-300">
        ← Back to discover
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="aspect-square w-full shrink-0 overflow-hidden rounded-2xl bg-ink-850 sm:w-56">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.displayName} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-3xl text-ink-600">▢</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-mist-500">{product.brand}</p>
          <h1 className="mt-0.5 text-xl font-bold leading-tight tracking-tight">{product.displayName}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-bold tabular-nums text-jade-300">
              {formatPaise(view.bestPayablePaise)}
            </span>
            {view.bestPriceIsSample ? <Badge tone="saffron">Sample price</Badge> : null}
          </div>

          {view.priceRange ? (
            <p className="mt-1 text-[11px] text-mist-500">
              Across {view.listings.length} retailer listing{view.listings.length === 1 ? '' : 's'}:{' '}
              {formatPaise(view.priceRange.minPaise)} – {formatPaise(view.priceRange.maxPaise)}
            </p>
          ) : null}

          {product.highlights.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-mist-300">
              {product.highlights.map((highlight) => (
                <li key={highlight}>• {highlight}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {view.dataQualityNotes.length > 0 ? (
        <div className="space-y-2">
          {view.dataQualityNotes.map((note) => (
            <SampleDataNotice key={note} message={note} />
          ))}
        </div>
      ) : null}

      <section>
        <SectionTitle
          title="Where to buy — and what you actually pay"
          subtitle="Guaranteed savings are separated from conditional ones. Cashback and exchange are never subtracted from the price."
        />
        <div className="space-y-3">
          {view.listings.map((listing) => (
            <ListingCard key={listing.listing.id} listing={listing} />
          ))}
        </div>
      </section>

      {history && history.points.length > 1 ? (
        <section>
          <SectionTitle
            title="Price history"
            subtitle={`${retailerName(history.retailer)} · ${history.points.length} observations`}
          />
          <Card className="p-4">
            <PriceHistoryChart points={history.points} />
            <div className="mt-3 flex items-center justify-between gap-2">
              <ProvenanceBadge
                provenance={{
                  origin: history.points[history.points.length - 1]?.origin === 'live' ? 'live' : 'sample',
                  source: history.retailer,
                  observedAt: history.points[history.points.length - 1]?.recordedAt ?? null,
                  confidence: 0.6,
                }}
              />
            </div>
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle title="Specifications" />
        <Card className="p-4">
          {specEntries.length === 0 ? (
            <p className="text-xs text-mist-500">No normalised specifications are available yet.</p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {specEntries.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 border-b border-ink-800 pb-1.5">
                  <dt className="text-[11px] text-mist-500">{humanise(key)}</dt>
                  <dd className="text-right text-[11px] font-medium text-mist-100">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}

          {Object.keys(extra).length > 0 ? (
            <>
              <p className="mt-4 text-[10px] uppercase tracking-wide text-mist-500">Other attributes</p>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {Object.entries(extra).map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-3 border-b border-ink-800 pb-1.5">
                    <dt className="text-[11px] text-mist-500">{humanise(key)}</dt>
                    <dd className="text-right text-[11px] font-medium text-mist-100">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </Card>
      </section>

      {view.variants.length > 0 ? (
        <section>
          <SectionTitle
            title="Variants"
            subtitle="Configurations are kept separate — a different RAM or storage size is a different product."
          />
          <Card className="divide-y divide-ink-800">
            {view.variants.map((variant) => (
              <div key={variant.id} className="px-4 py-3">
                <p className="text-xs font-medium text-mist-100">{variant.label}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-mist-500">{variant.configSignature}</p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {view.matches.length > 0 ? (
        <section>
          <SectionTitle
            title="Cross-retailer variant matching"
            subtitle="How the same product across different retailers was classified."
          />
          <Card className="divide-y divide-ink-800">
            {view.matches.slice(0, 8).map((match) => (
              <div key={`${match.listingId}-${match.variantId}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      match.verdict === 'exact_same_variant'
                        ? 'jade'
                        : match.verdict === 'same_model_different_variant'
                          ? 'saffron'
                          : 'neutral'
                    }
                  >
                    {humanise(match.verdict)}
                  </Badge>
                  <span className="text-[11px] tabular-nums text-mist-500">
                    {Math.round(match.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-mist-300">{match.explanation}</p>
                {match.differences.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {match.differences.map((difference) => (
                      <li key={difference} className="text-[10px] text-rose-300">
                        • {difference}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle title="Review intelligence" />
        <ReviewIntelligencePanel intelligence={view.reviewIntelligence} />
      </section>
    </div>
  );
}
