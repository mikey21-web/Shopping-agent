import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { Card, EmptyState, ErrorNote, SectionTitle, Skeleton } from '../components/ui.tsx';
import { ProductCard } from '../components/ProductCard.tsx';

const CATEGORY_FILTERS = [
  { id: '', label: 'All' },
  { id: 'smartphone', label: 'Phones' },
  { id: 'laptop', label: 'Laptops' },
  { id: 'tv', label: 'TVs' },
  { id: 'audio', label: 'Audio' },
  { id: 'smartwatch', label: 'Watches' },
  { id: 'camera', label: 'Cameras' },
  { id: 'appliance', label: 'Appliances' },
  { id: 'fashion', label: 'Fashion' },
  { id: 'beauty', label: 'Beauty' },
  { id: 'grocery', label: 'Grocery' },
];

export function Discover() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [products, setProducts] = useState<
    { id: string; displayName: string; brand: string; category: string; imageUrl: string | null; highlights: string[] }[]
  >([]);
  const [providers, setProviders] = useState<
    {
      providerId: string;
      providerName: string;
      status: string;
      reason: string;
      hint: string | null;
      count: number;
      isSample: boolean;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .discover(query, category || undefined)
      .then((result) => {
        if (cancelled) return;
        setProducts(result.catalogue);
        setProviders(result.providers);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Discovery failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, category]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Discover</h1>
        <p className="mt-1 text-xs leading-relaxed text-mist-500">
          Search the catalogue and see exactly which data sources responded — and which could not be read.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-mist-50 placeholder:text-mist-500 focus:border-saffron-400/60 focus:outline-none"
        />
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {CATEGORY_FILTERS.map((filter) => (
          <button
            key={filter.id || 'all'}
            onClick={() => setCategory(filter.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
              category === filter.id
                ? 'border-saffron-400/50 bg-saffron-400/15 text-saffron-200'
                : 'border-ink-700 bg-ink-900/60 text-mist-400 hover:text-mist-100'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {providers.length > 0 ? (
        <Card className="p-3.5">
          <SectionTitle
            title="Data sources"
            subtitle="SahiPick never substitutes demo data for a source it could not read."
          />
          <ul className="space-y-1.5">
            {providers.map((provider) => (
              <li key={provider.providerId} className="text-[11px] leading-relaxed">
                <span
                  className={
                    provider.status === 'ok'
                      ? 'text-jade-300'
                      : provider.status === 'not_configured'
                        ? 'text-saffron-300'
                        : 'text-mist-500'
                  }
                >
                  {provider.providerName}
                </span>{' '}
                <span className="text-mist-500">— {provider.reason}</span>
                {provider.hint ? (
                  <p className="mt-0.5 pl-1 text-[10px] text-mist-500">{provider.hint}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section>
        <SectionTitle
          title={loading ? 'Loading…' : `${products.length} product${products.length === 1 ? '' : 's'}`}
          subtitle="Entries marked as sample data are from the bundled demonstration catalogue, not a live retailer feed."
        />
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-44" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            title="Nothing matched"
            message="Try a broader term, or ask SahiPick directly — it can explain when a source is unavailable rather than guessing."
            icon="⌕"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      <Card className="p-4">
        <h3 className="text-xs font-semibold text-mist-50">Want the reasoning, not just a list?</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-mist-500">
          The assistant explains why each option leads, shows the real payable price, and tells you when to
          wait.
        </p>
        <Link
          to="/ask"
          className="mt-2 inline-block text-[11px] text-saffron-300 hover:text-saffron-200"
        >
          Ask SahiPick →
        </Link>
      </Card>
    </div>
  );
}
