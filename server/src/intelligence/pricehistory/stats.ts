/**
 * Price statistics and the buy-now-or-wait engine.
 *
 * The engine is deliberately conservative. With little history it says so
 * instead of guessing. It never claims to predict a future price — it only
 * reports where today's price sits relative to observed history, how volatile
 * the price has been, and whether a known sale window is running.
 */

import type {
  BuyWaitAssessment,
  BuyWaitVerdict,
  PricePoint,
  PriceStats,
  Provenance,
} from '../../domain/types.ts';
import { daysUntilSaleEnd, isInSaleWindow, nextSaleWindow } from './sales-calendar.ts';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1] ?? 0;
    const hi = sorted[mid] ?? 0;
    return Math.round((lo + hi) / 2);
  }
  return sorted[mid] ?? 0;
}

/**
 * Summarise a price history.
 * `reliable` requires a meaningful number of observations spanning some time.
 */
export function computePriceStats(points: PricePoint[]): PriceStats | null {
  if (points.length === 0) return null;

  const sorted = [...points].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  const prices = sorted.map((p) => p.pricePaise);
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length);
  const med = median(prices);

  const variance =
    prices.length > 1
      ? prices.reduce((sum, p) => sum + (p - avg) ** 2, 0) / (prices.length - 1)
      : 0;
  const volatility = avg > 0 ? Math.sqrt(variance) / avg : 0;

  const first = sorted[0];
  const spanDays = first
    ? (new Date(latest.recordedAt).getTime() - new Date(first.recordedAt).getTime()) /
      86_400_000
    : 0;

  const reliable = points.length >= 5 && spanDays >= 7;

  return {
    listingId: latest.listingId,
    observations: points.length,
    minPaise: min,
    maxPaise: max,
    avgPaise: avg,
    medianPaise: med,
    latestPaise: latest.pricePaise,
    latestAt: latest.recordedAt,
    discountVsAvg: avg > 0 ? Math.max(0, (avg - latest.pricePaise) / avg) : 0,
    belowLowPaise: Math.max(0, latest.pricePaise - min),
    volatility,
    reliable,
  };
}

export interface BuyWaitOptions {
  /** Retailer, used to look up sale windows. */
  retailer?: string | null;
  /** True when the price history came from bundled sample data. */
  isSample?: boolean;
  /** Evaluation time. */
  now?: Date;
  /** Extra discount currently available, in paise (already applied to current). */
  currentDiscountPaise?: number;
}

/**
 * Decide whether to buy now or wait.
 *
 * Signals used:
 *  - position of today's price against the historical average and low
 *  - how volatile the price has been
 *  - whether a sale window is running (waiting is unlikely to help right now)
 *  - how much history we actually have (drives confidence)
 */
export function assessBuyWait(
  stats: PriceStats | null,
  options: BuyWaitOptions = {},
): BuyWaitAssessment {
  const now = options.now ?? new Date();
  const reasons: string[] = [];

  if (!stats || stats.observations === 0) {
    return {
      verdict: 'insufficient_data',
      confidence: 0,
      reasons: ['No price history has been recorded for this listing yet.'],
      historicalLowPaise: null,
      expectedImprovementDays: null,
      historyQuality: 0,
    };
  }

  if (stats.observations < 5) {
    reasons.push(
      `Only ${stats.observations} price observation${stats.observations === 1 ? '' : 's'} recorded — not enough to judge price movement.`,
    );
    if (options.isSample) {
      reasons.push('This history comes from bundled sample data, so it cannot predict real prices.');
    }
    return {
      verdict: 'insufficient_data',
      confidence: 0.1,
      reasons,
      historicalLowPaise: stats.minPaise,
      expectedImprovementDays: null,
      historyQuality: Math.min(0.3, stats.observations / 5 / 3),
    };
  }

  // Confidence in the history itself.
  let historyQuality = Math.min(1, stats.observations / 30);
  if (!stats.reliable) historyQuality = Math.min(historyQuality, 0.45);
  if (options.isSample) historyQuality *= 0.4;

  const current = stats.latestPaise;
  const atLow = current <= stats.minPaise + Math.max(100, stats.minPaise * 0.01);
  const aboveAvg = stats.avgPaise > 0 ? (current - stats.avgPaise) / stats.avgPaise : 0;
  const aboveMedian = stats.medianPaise > 0 ? (current - stats.medianPaise) / stats.medianPaise : 0;

  const saleNow = isInSaleWindow(now, options.retailer ?? undefined);
  const upcomingSale = nextSaleWindow(now, options.retailer ?? undefined);
  const daysToSaleEnd = daysUntilSaleEnd(now, options.retailer ?? undefined);

  let verdict: BuyWaitVerdict = 'fair_price';
  let confidence = 0.35 + historyQuality * 0.45;

  if (atLow) {
    verdict = 'buy_now';
    confidence = 0.55 + historyQuality * 0.4;
    reasons.push(
      `Current price of ₹${(current / 100).toLocaleString('en-IN')} is at the lowest recorded level (low: ₹${(stats.minPaise / 100).toLocaleString('en-IN')}).`,
    );
  } else if (aboveAvg > 0.15) {
    verdict = 'wait';
    confidence = 0.4 + historyQuality * 0.4;
    reasons.push(
      `Current price is ${Math.round(aboveAvg * 100)}% above the recorded average of ₹${(stats.avgPaise / 100).toLocaleString('en-IN')}.`,
    );
  } else if (aboveMedian > 0.08) {
    verdict = 'wait';
    confidence = 0.35 + historyQuality * 0.3;
    reasons.push(
      `Current price is above the typical price for this product (median ₹${(stats.medianPaise / 100).toLocaleString('en-IN')}).`,
    );
  } else if (aboveAvg < -0.05) {
    verdict = 'buy_now';
    confidence = 0.45 + historyQuality * 0.35;
    reasons.push(
      `Current price is ${Math.round(Math.abs(aboveAvg) * 100)}% below the recorded average.`,
    );
  } else {
    verdict = 'fair_price';
    reasons.push(
      `Current price is close to the recorded average of ₹${(stats.avgPaise / 100).toLocaleString('en-IN')}.`,
    );
  }

  if (stats.volatility > 0.08) {
    reasons.push(
      `Price has been volatile (±${Math.round(stats.volatility * 100)}%), so waiting could still pay off.`,
    );
    confidence -= 0.1;
  }

  if (saleNow) {
    reasons.push(
      `${saleNow.name} is currently running — this is already a discounted window, so prices are unlikely to drop further this week.`,
    );
    confidence += 0.05;
  } else if (upcomingSale && daysToSaleEnd !== null) {
    reasons.push(
      `${upcomingSale.name} runs from ${upcomingSale.start} to ${upcomingSale.end}; waiting may yield a lower price.`,
    );
    confidence -= 0.05;
  }

  if (options.currentDiscountPaise && options.currentDiscountPaise > 0) {
    reasons.push(
      `Additional discounts of ₹${(options.currentDiscountPaise / 100).toLocaleString('en-IN')} are currently available.`,
    );
  }

  if (options.isSample) {
    reasons.push(
      'This assessment is based on bundled sample data and must not be used to time a real purchase.',
    );
  }

  confidence = Math.max(0.05, Math.min(0.95, confidence));

  const expectedImprovementDays =
    verdict === 'wait' && upcomingSale
      ? Math.max(0, Math.round((new Date(upcomingSale.end).getTime() - now.getTime()) / 86_400_000))
      : null;

  return {
    verdict,
    confidence: Number(confidence.toFixed(2)),
    reasons,
    historicalLowPaise: stats.minPaise,
    expectedImprovementDays,
    historyQuality: Number(historyQuality.toFixed(2)),
  };
}

/** Provenance helper for price-derived data. */
export function derivedProvenance(source: string, note?: string): Provenance {
  return {
    origin: 'derived',
    source,
    observedAt: new Date().toISOString(),
    confidence: 0.8,
    note: note ?? null,
  };
}
