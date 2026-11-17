/** Formatting helpers shared across the UI. */

export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatPaisePrecise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

const RETAILER_NAMES: Record<string, string> = {
  amazon_in: 'Amazon.in',
  flipkart: 'Flipkart',
  croma: 'Croma',
  reliance_digital: 'Reliance Digital',
  vijay_sales: 'Vijay Sales',
  sample: 'Sample retailer',
};

export function retailerName(id: string | null | undefined): string {
  if (!id) return '—';
  return RETAILER_NAMES[id] ?? id;
}

const BADGE_NAMES: Record<string, string> = {
  best_overall: 'Best overall',
  best_value: 'Best value',
  best_performance: 'Best performance',
  best_long_term: 'Best long-term',
  best_budget: 'Best budget',
  best_alternative: 'Alternative',
};

export function badgeName(badge: string | null | undefined): string {
  if (!badge) return '';
  return BADGE_NAMES[badge] ?? badge;
}

const VERDICT_COPY: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  buy_now: { label: 'Buy now', tone: 'good' },
  fair_price: { label: 'Fair price', tone: 'neutral' },
  wait: { label: 'Wait', tone: 'warn' },
  insufficient_data: { label: 'Not enough history', tone: 'neutral' },
};

export function verdictCopy(verdict: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  return VERDICT_COPY[verdict] ?? { label: verdict, tone: 'neutral' };
}

/** Format an ISO timestamp in the user's timezone (IST). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/** Title-case a snake_case identifier for display. */
export function humanise(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Very small markdown subset renderer for agent answers. */
export function renderSimpleMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />');
}
