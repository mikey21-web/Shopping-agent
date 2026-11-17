import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { formatPaise, humanise } from '../lib/format.ts';
import { Badge, Card, EmptyState, ErrorNote, SectionTitle, Skeleton } from '../components/ui.tsx';

interface ComparisonResponse {
  productIds: string[];
  rows: { label: string; values: (string | number | null)[]; differs: boolean }[];
  highlights: string[];
  priceComparison: {
    productId: string;
    listingId: string | null;
    retailer: string | null;
    payablePaise: number | null;
    bestCasePaise: number | null;
    isSample: boolean;
  }[];
  reviewComparison: {
    productId: string;
    reviewCount: number;
    averageRating: number | null;
    authenticityRisk: number | null;
    topComplaints: string[];
  }[];
  notes: string[];
}

export function Compare() {
  const [catalogue, setCatalogue] = useState<
    { id: string; displayName: string; brand: string; category: string }[]
  >([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .products()
      .then((response) => setCatalogue(response.products))
      .catch(() => setCatalogue([]));
  }, []);

  function toggle(id: string): void {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (current.length >= 4) return current;
      return [...current, id];
    });
  }

  async function runComparison(): Promise<void> {
    if (selected.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.compare(selected));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Compare</h1>
        <p className="mt-1 text-xs leading-relaxed text-mist-500">
          Pick two to four products. Differences that actually matter are highlighted; rows where every
          product agrees are collapsed to keep the view readable.
        </p>
      </div>

      <Card className="p-4">
        <SectionTitle title="Select products" subtitle="Up to four at a time." />
        <div className="flex flex-wrap gap-1.5">
          {catalogue.map((product) => {
            const active = selected.includes(product.id);
            return (
              <button
                key={product.id}
                onClick={() => toggle(product.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] transition ${
                  active
                    ? 'border-saffron-400/50 bg-saffron-400/15 text-saffron-200'
                    : 'border-ink-700 bg-ink-850/60 text-mist-400 hover:text-mist-100'
                }`}
              >
                {product.displayName}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => void runComparison()}
          disabled={selected.length < 2 || loading}
          className="mt-3 rounded-xl bg-saffron-400 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-saffron-300 disabled:bg-ink-700 disabled:text-mist-500"
        >
          {loading ? 'Comparing…' : `Compare ${selected.length} selected`}
        </button>
        {error ? (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        ) : null}
      </Card>

      {result ? (
        <>
          <section>
            <SectionTitle
              title="Specifications"
              subtitle={`${result.highlights.length} attribute${result.highlights.length === 1 ? '' : 's'} differ`}
            />
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead>
                  <tr className="border-b border-ink-700">
                    <th className="px-3 py-2.5 font-medium text-mist-500">Attribute</th>
                    {result.productIds.map((id) => (
                      <th key={id} className="px-3 py-2.5 font-medium text-mist-200">
                        {catalogue.find((entry) => entry.id === id)?.displayName ?? id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.label} className="border-b border-ink-800 last:border-0">
                      <td className="px-3 py-2.5 text-mist-500">{row.label}</td>
                      {row.values.map((value, index) => (
                        <td
                          key={index}
                          className={`px-3 py-2.5 ${
                            row.differs ? 'font-medium text-mist-50' : 'text-mist-400'
                          }`}
                        >
                          {value === null ? '—' : String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section>
            <SectionTitle title="Real payable price" />
            <div className="grid gap-2 sm:grid-cols-2">
              {result.priceComparison.map((entry) => (
                <Card key={entry.productId} className="p-3.5">
                  <Link
                    to={`/product/${entry.productId}`}
                    className="text-xs font-semibold text-mist-50 hover:text-saffron-300"
                  >
                    {catalogue.find((item) => item.id === entry.productId)?.displayName ?? entry.productId}
                  </Link>
                  <p className="mt-1 text-lg font-bold tabular-nums text-jade-300">
                    {formatPaise(entry.payablePaise)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {entry.isSample ? <Badge tone="saffron">Sample price</Badge> : null}
                    {entry.bestCasePaise && entry.bestCasePaise !== entry.payablePaise ? (
                      <span className="text-[10px] text-mist-500">
                        with card offers {formatPaise(entry.bestCasePaise)}
                      </span>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle title="Owner feedback" />
            <div className="grid gap-2 sm:grid-cols-2">
              {result.reviewComparison.map((entry) => (
                <Card key={entry.productId} className="p-3.5">
                  <p className="text-xs font-semibold text-mist-50">
                    {catalogue.find((item) => item.id === entry.productId)?.displayName ?? entry.productId}
                  </p>
                  <p className="mt-1 text-[11px] text-mist-400">
                    {entry.reviewCount} reviews
                    {entry.averageRating ? ` · ${entry.averageRating.toFixed(1)}★` : ''}
                    {entry.authenticityRisk !== null
                      ? ` · pattern risk ${Math.round(entry.authenticityRisk * 100)}%`
                      : ''}
                  </p>
                  {entry.topComplaints.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-rose-300">
                      {entry.topComplaints.map((complaint) => (
                        <li key={complaint}>• {complaint}</li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              ))}
            </div>
          </section>

          {result.notes.length > 0 ? (
            <div className="space-y-2">
              {result.notes.map((note) => (
                <div
                  key={note}
                  className="rounded-xl border border-saffron-500/25 bg-saffron-500/8 px-3 py-2 text-[11px] text-saffron-300"
                >
                  {note}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : selected.length < 2 ? (
        <EmptyState
          title="Pick at least two products"
          message="Selections are shown above. SahiPick keeps different configurations separate, so comparing a 16GB laptop with an 8GB one is always allowed — but it will be labelled as a variant difference."
          icon="⇄"
        />
      ) : loading ? (
        <Skeleton className="h-48" />
      ) : null}
    </div>
  );
}
