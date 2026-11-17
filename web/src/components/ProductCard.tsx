import { Link } from 'react-router-dom';
import type { Recommendation } from '../lib/api.ts';
import { badgeName, formatPaise, retailerName } from '../lib/format.ts';
import { Badge, Card, ScoreBar } from './ui.tsx';

export function ProductCard({
  product,
}: {
  product: {
    id: string;
    displayName: string;
    brand: string;
    category: string;
    imageUrl: string | null;
    highlights: string[];
  };
}) {
  return (
    <Link
      to={`/product/${product.id}`}
      className="group block overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-900/60 transition hover:border-saffron-400/40 hover:bg-ink-850"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-ink-850">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.displayName}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl text-ink-600">▢</div>
        )}
      </div>
      <div className="p-3">
        <p className="text-[11px] uppercase tracking-wide text-mist-500">{product.brand}</p>
        <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-mist-50">
          {product.displayName}
        </h3>
        {product.highlights.length > 0 ? (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-mist-500">
            {product.highlights.slice(0, 2).join(' · ')}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * The compact shape used by the conversational assistant, where only the
 * headline facts are known rather than the full component breakdown.
 */
export interface CompactRecommendation {
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
  priceIsSample: boolean;
}

export function RecommendationCard({
  recommendation,
  rank,
}: {
  recommendation: Recommendation | CompactRecommendation;
  rank: number;
}) {
  const badge = badgeName(recommendation.badge);
  const tone = recommendation.badge === 'best_overall' ? 'saffron' : 'sky';

  // The full recommendation uses bestPricePaise/bestRetailer; the compact
  // one (from the conversational agent) uses pricePaise/retailer.
  const price =
    'pricePaise' in recommendation ? recommendation.pricePaise : recommendation.bestPricePaise;
  const retailer =
    'retailer' in recommendation ? recommendation.retailer : recommendation.bestRetailer;

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-3 p-3 sm:p-4">
        <div className="hidden h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-850 sm:block">
          {recommendation.imageUrl ? (
            <img
              src={recommendation.imageUrl}
              alt={recommendation.displayName}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-mist-500">#{rank}</span>
            {badge ? <Badge tone={tone}>{badge}</Badge> : null}
            {recommendation.priceIsSample ? <Badge tone="saffron">Sample price</Badge> : null}
          </div>

          <Link
            to={`/product/${recommendation.productId}`}
            className="mt-1 block truncate text-sm font-semibold text-mist-50 hover:text-saffron-300"
          >
            {recommendation.displayName}
          </Link>

          <p className="mt-0.5 text-sm">
            <span className="font-semibold text-jade-300">{formatPaise(price)}</span>
            {retailer ? (
              <span className="ml-1.5 text-[11px] text-mist-500">at {retailerName(retailer)}</span>
            ) : null}
          </p>

          <p className="mt-1.5 text-[11px] leading-relaxed text-mist-400">{recommendation.summary}</p>

          <div className="mt-2.5 space-y-1.5">
            {'components' in recommendation && recommendation.components.length > 0
              ? recommendation.components.slice(0, 4).map((component) => (
                  <div key={component.key}>
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="truncate text-mist-400">{component.label}</span>
                      <span className="shrink-0 tabular-nums text-mist-500">
                        {Math.round(component.score * 100)}%
                      </span>
                    </div>
                    <div className="mt-1">
                      <ScoreBar
                        value={component.score}
                        tone={
                          component.score >= 0.65 ? 'jade' : component.score >= 0.4 ? 'saffron' : 'rose'
                        }
                      />
                    </div>
                  </div>
                ))
              : null}
          </div>

          {recommendation.strengths.length > 0 ? (
            <ul className="mt-3 space-y-0.5 text-[11px] leading-relaxed text-jade-300">
              {recommendation.strengths.slice(0, 2).map((strength) => (
                <li key={strength}>+ {strength}</li>
              ))}
            </ul>
          ) : null}
          {recommendation.weaknesses.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-rose-300">
              {recommendation.weaknesses.slice(0, 2).map((weakness) => (
                <li key={weakness}>− {weakness}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
