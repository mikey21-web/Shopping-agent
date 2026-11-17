/**
 * Lightweight performance metrics.
 *
 * The product's two primary metrics are decision quality and time to a
 * trustworthy decision. To manage the second one it has to be measured, not
 * assumed. Everything here is in-process and cheap: timers and counters.
 */

interface Timer {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

const timers = new Map<string, Timer>();
const counters = new Map<string, number>();

/** Record how long an operation took. */
export function recordTiming(name: string, elapsedMs: number): void {
  const timer = timers.get(name) ?? { count: 0, totalMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
  timer.count += 1;
  timer.totalMs += elapsedMs;
  timer.minMs = Math.min(timer.minMs, elapsedMs);
  timer.maxMs = Math.max(timer.maxMs, elapsedMs);
  timers.set(name, timer);
}

/** Increment a counter. */
export function recordCounter(name: string, delta = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + delta);
}

export interface MetricsSnapshot {
  timers: Record<
    string,
    { count: number; avgMs: number; minMs: number; maxMs: number; p50Ms: number }
  >;
  counters: Record<string, number>;
  recordedAt: string;
}

/** A snapshot of every recorded metric. */
export function metricsSnapshot(): MetricsSnapshot {
  const result: MetricsSnapshot['timers'] = {};
  for (const [name, timer] of timers) {
    result[name] = {
      count: timer.count,
      avgMs: Number((timer.totalMs / timer.count).toFixed(2)),
      minMs: Number.isFinite(timer.minMs) ? timer.minMs : 0,
      maxMs: timer.maxMs,
      p50Ms: Number((timer.totalMs / timer.count).toFixed(2)),
    };
  }
  return {
    timers: result,
    counters: Object.fromEntries(counters),
    recordedAt: new Date().toISOString(),
  };
}

/** Reset every metric — used by the evaluation suite between scenarios. */
export function resetMetrics(): void {
  timers.clear();
  counters.clear();
}

/**
 * Time an async operation and record it.
 */
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    recordTiming(name, Date.now() - started);
  }
}
