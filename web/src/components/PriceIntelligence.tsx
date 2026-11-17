import { useState } from 'react';
import type { ListingView, PriceBreakdown } from '../lib/api.ts';
import { formatPaise, formatPaisePrecise, retailerName, verdictCopy } from '../lib/format.ts';
import { Badge, Card, ScoreBar } from './ui.tsx';
import { ProvenanceBadge } from './Provenance.tsx';

/* ------------------------------------------------------------------ */
/* Price history chart                                                 */
/* ------------------------------------------------------------------ */

export function PriceHistoryChart({
  points,
  height = 120,
}: {
  points: { pricePaise: number; recordedAt: string }[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-ink-700 text-[11px] text-mist-500">
        Not enough price history to draw a chart yet.
      </div>
    );
  }

  const width = 640;
  const prices = points.map((point) => point.pricePaise);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const padding = 6;

  const x = (index: number): number =>
    padding + (index / (points.length - 1)) * (width - padding * 2);
  const y = (price: number): number =>
    height - padding - ((price - min) / span) * (height - padding * 2);

  const line = points.map((point, index) => `${x(index)},${y(point.pricePaise)}`).join(' ');
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;

  const last = points[points.length - 1];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Price history chart"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#41c88d" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#41c88d" stopOpacity="0" />
          </linearGradient>
        </defs>

        <polygon points={area} fill="url(#priceFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#41c88d"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point, index) => (
          <circle
            key={point.recordedAt + index}
            cx={x(index)}
            cy={y(point.pricePaise)}
            r={hover === index ? 4 : 2}
            fill="#7fe3b8"
            opacity={hover === index ? 1 : 0.55}
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>

      {hover !== null && points[hover] ? (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-ink-600 bg-ink-850 px-2 py-1 text-[11px] shadow-lg"
          style={{ left: `${(x(hover) / width) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <div className="font-semibold text-jade-300">
            {formatPaise(points[hover]?.pricePaise)}
          </div>
          <div className="text-mist-500">
            {new Date(points[hover]?.recordedAt ?? '').toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-1 flex justify-between text-[10px] text-mist-500">
        <span>Low {formatPaise(min)}</span>
        <span>Latest {formatPaise(last?.pricePaise ?? null)}</span>
        <span>High {formatPaise(max)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buy / wait                                                          */
/* ------------------------------------------------------------------ */

export function BuyWaitCard({ listing }: { listing: ListingView }) {
  const { buyWait } = listing;
  const copy = verdictCopy(buyWait.verdict);

  const tone =
    copy.tone === 'good'
      ? 'text-jade-300 border-jade-500/30 bg-jade-500/8'
      : copy.tone === 'warn'
        ? 'text-saffron-300 border-saffron-500/30 bg-saffron-500/8'
        : 'text-mist-300 border-ink-600 bg-ink-850';

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{copy.label}</span>
        <span className="text-[11px] tabular-nums opacity-80">
          {Math.round(buyWait.confidence * 100)}% confidence
        </span>
      </div>
      <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed opacity-90">
        {buyWait.reasons.slice(0, 3).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {buyWait.historyQuality < 0.5 ? (
        <p className="mt-1.5 text-[10px] opacity-70">
          Price history quality is low ({Math.round(buyWait.historyQuality * 100)}%), so treat this as a weak
          signal.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Offer breakdown                                                     */
/* ------------------------------------------------------------------ */

export function OfferBreakdown({ breakdown }: { breakdown: PriceBreakdown }) {
  const rows: { label: string; value: string; tone?: 'good' | 'muted' }[] = [
    { label: 'Listed price', value: formatPaise(breakdown.listPricePaise) },
  ];

  if (breakdown.mrpPaise) {
    rows.push({ label: 'MRP (reference only)', value: formatPaise(breakdown.mrpPaise), tone: 'muted' });
  }

  for (const applied of breakdown.applied) {
    if (applied.discountPaise <= 0) continue;
    rows.push({
      label: `${applied.title}${applied.certainty === 'conditional' ? ' (if you qualify)' : ''}`,
      value: `− ${formatPaise(applied.discountPaise)}`,
      tone: 'good',
    });
  }

  if (breakdown.deliveryFeePaise > 0) {
    rows.push({ label: 'Delivery', value: `+ ${formatPaise(breakdown.deliveryFeePaise)}`, tone: 'muted' });
  }

  if (breakdown.cashbackPaise > 0) {
    rows.push({
      label: 'Cashback (credited later, not a price cut)',
      value: formatPaise(breakdown.cashbackPaise),
      tone: 'muted',
    });
  }

  if (breakdown.exchangeBonusPaise > 0) {
    rows.push({
      label: 'Exchange value (depends on your old device)',
      value: formatPaise(breakdown.exchangeBonusPaise),
      tone: 'muted',
    });
  }

  return (
    <div>
      <div className="space-y-1.5 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <span className="text-mist-400">{row.label}</span>
            <span
              className={
                row.tone === 'good'
                  ? 'font-medium tabular-nums text-jade-300'
                  : row.tone === 'muted'
                    ? 'tabular-nums text-mist-500'
                    : 'tabular-nums text-mist-100'
              }
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1 border-t border-ink-700 pt-3 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-mist-200">Payable now (guaranteed)</span>
          <span className="text-base font-semibold tabular-nums text-jade-300">
            {formatPaise(breakdown.payablePaise)}
          </span>
        </div>
        {breakdown.conditionalDiscountPaise > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-mist-500">If you qualify for card/bank offers</span>
            <span className="tabular-nums text-saffron-300">
              {formatPaise(breakdown.bestCasePayablePaise)}
            </span>
          </div>
        ) : null}
      </div>

      {breakdown.emi ? (
        <div className="mt-2 rounded-lg bg-ink-850 px-2.5 py-2 text-[11px] text-mist-400">
          EMI {breakdown.emi.months} months · {formatPaisePrecise(breakdown.emi.monthlyPaise)}/month at{' '}
          {breakdown.emi.interestRatePercent}% · total {formatPaise(breakdown.emi.totalPaise)}
        </div>
      ) : null}

      {breakdown.skipped.length > 0 ? (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-mist-500 hover:text-mist-300">
            {breakdown.skipped.length} offer{breakdown.skipped.length === 1 ? '' : 's'} not applied
          </summary>
          <ul className="mt-1.5 space-y-1 text-mist-500">
            {breakdown.skipped.map((skipped) => (
              <li key={skipped.offerId}>
                <span className="text-mist-400">{skipped.title}</span> — {skipped.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Retailer listing card                                               */
/* ------------------------------------------------------------------ */

export function ListingCard({ listing }: { listing: ListingView }) {
  const { breakdown } = listing;
  const isBest = listing.isBestPrice;

  return (
    <Card className={`p-3.5 ${isBest ? 'border-jade-500/40' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-mist-100">{retailerName(listing.listing.retailer)}</span>
            {isBest ? <Badge tone="jade">Lowest guaranteed price</Badge> : null}
            {!listing.listing.inStock ? <Badge tone="rose">Out of stock</Badge> : null}
            {listing.listing.condition !== 'new' ? (
              <Badge tone="saffron">{listing.listing.condition}</Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-mist-500">
            {listing.listing.title}
          </p>
          {listing.listing.seller ? (
            <p className="mt-0.5 text-[10px] text-mist-500">Sold by {listing.listing.seller}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold tabular-nums text-jade-300">
            {formatPaise(breakdown.payablePaise)}
          </p>
          {breakdown.listPricePaise > breakdown.payablePaise ? (
            <p className="text-[10px] tabular-nums text-mist-500 line-through">
              {formatPaise(breakdown.listPricePaise)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <OfferBreakdown breakdown={breakdown} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ProvenanceBadge provenance={listing.listing.provenance} compact />
        {listing.listing.url ? (
          <a
            href={listing.listing.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-[11px] text-sky-300 hover:text-sky-400"
          >
            View on retailer ↗
          </a>
        ) : null}
      </div>

      {listing.priceStats ? (
        <div className="mt-3 border-t border-ink-700 pt-3">
          <BuyWaitCard listing={listing} />
        </div>
      ) : null}
    </Card>
  );
}
