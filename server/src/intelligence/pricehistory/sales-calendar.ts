/**
 * Indian retail sale calendar.
 *
 * Major marketplaces run their biggest discounts around a small number of
 * predictable windows: the two "Big Billion" events, the Great Indian
 * Festival, and the Diwali/Deepavali period (which anchors most festive
 * discounting in India, roughly October to November).
 *
 * These windows are used to (a) warn the shopper when a price is unlikely to
 * fall further and (b) flag historically inflated reference prices.
 * Dates are approximate and expressed as UTC day ranges.
 */

export interface SaleWindow {
  id: string;
  name: string;
  /** Inclusive ISO date (UTC). */
  start: string;
  /** Inclusive ISO date (UTC). */
  end: string;
  retailers: string[];
  note: string;
}

/** Known sale windows from 2024 onwards. Extend as new seasons are announced. */
export const SALE_WINDOWS: SaleWindow[] = [
  {
    id: 'amazon-great-indian-festival-2024',
    name: 'Amazon Great Indian Festival',
    start: '2024-10-03',
    end: '2024-10-07',
    retailers: ['amazon_in'],
    note: 'Amazon’s flagship festive sale.',
  },
  {
    id: 'flipkart-bbd-2024',
    name: 'Flipkart Big Billion Days',
    start: '2024-10-03',
    end: '2024-10-06',
    retailers: ['flipkart'],
    note: 'Flipkart’s flagship festive sale.',
  },
  {
    id: 'amazon-gif-2025',
    name: 'Amazon Great Indian Festival',
    start: '2025-10-04',
    end: '2025-10-08',
    retailers: ['amazon_in'],
    note: 'Amazon’s flagship festive sale.',
  },
  {
    id: 'flipkart-bbd-2025',
    name: 'Flipkart Big Billion Days',
    start: '2025-10-04',
    end: '2025-10-07',
    retailers: ['flipkart'],
    note: 'Flipkart’s flagship festive sale.',
  },
  {
    id: 'amazon-gif-2026',
    name: 'Amazon Great Indian Festival',
    start: '2026-10-06',
    end: '2026-10-10',
    retailers: ['amazon_in'],
    note: 'Amazon’s flagship festive sale.',
  },
  {
    id: 'flipkart-bbd-2026',
    name: 'Flipkart Big Billion Days',
    start: '2026-10-06',
    end: '2026-10-09',
    retailers: ['flipkart'],
    note: 'Flipkart’s flagship festive sale.',
  },
];

/** The Diwali/Deepavali festive window, which anchors most Indian festive pricing. */
export const DIWALI_WINDOWS: { year: number; start: string; end: string }[] = [
  { year: 2024, start: '2024-10-31', end: '2024-11-05' },
  { year: 2025, start: '2025-10-18', end: '2025-10-23' },
  { year: 2026, start: '2026-11-07', end: '2026-11-12' },
];

function toUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Is `date` inside any known sale window for the given retailer? */
export function isInSaleWindow(date: Date, retailer?: string): SaleWindow | null {
  const day = toUtcDay(date);
  for (const window of SALE_WINDOWS) {
    if (retailer && !window.retailers.includes(retailer)) continue;
    if (day >= parseDay(window.start) && day <= parseDay(window.end)) return window;
  }
  return null;
}

/** The next upcoming sale window for a retailer, if one is scheduled. */
export function nextSaleWindow(date: Date, retailer?: string): SaleWindow | null {
  const day = toUtcDay(date);
  const upcoming = SALE_WINDOWS.filter(
    (window) =>
      (!retailer || window.retailers.includes(retailer)) && parseDay(window.end) >= day,
  ).sort((a, b) => parseDay(a.start) - parseDay(b.start));
  return upcoming[0] ?? null;
}

/** Days until the next sale window ends (0 when inside one). */
export function daysUntilSaleEnd(date: Date, retailer?: string): number | null {
  const window = nextSaleWindow(date, retailer);
  if (!window) return null;
  const day = toUtcDay(date);
  const end = parseDay(window.end);
  if (day > end) return null;
  return Math.round((end - day) / 86_400_000);
}

/** Whether we are inside the Diwali window for the given year. */
export function isDiwaliWindow(date: Date): boolean {
  const day = toUtcDay(date);
  return DIWALI_WINDOWS.some((w) => day >= parseDay(w.start) && day <= parseDay(w.end));
}
