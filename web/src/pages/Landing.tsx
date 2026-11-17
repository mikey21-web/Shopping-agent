import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { Button, Card, SectionTitle, Skeleton } from '../components/ui.tsx';
import { ProductCard } from '../components/ProductCard.tsx';

// SahiPick is universal: any product in any category. The engine resolves
// the category from the shopper's own words, so this list is a set of
// starting points rather than a limit on what can be asked.
const CATEGORIES = [
  { id: 'shoes', label: 'Shoes & footwear', icon: '⇡' },
  { id: 'smartphone', label: 'Smartphones', icon: '▢' },
  { id: 'laptop', label: 'Laptops', icon: '⌘' },
  { id: 'appliance', label: 'Home appliances', icon: '⌂' },
  { id: 'fashion', label: 'Fashion & apparel', icon: '◈' },
  { id: 'furniture', label: 'Furniture', icon: '▤' },
  { id: 'beauty', label: 'Beauty & personal care', icon: '✿' },
  { id: 'grocery', label: 'Grocery & food', icon: '◍' },
  { id: 'audio', label: 'Audio', icon: '♪' },
  { id: 'camera', label: 'Cameras', icon: '◉' },
  { id: 'tv', label: 'TVs', icon: '▭' },
  { id: 'automotive', label: 'Automotive', icon: '⬡' },
];

const EXAMPLES = [
  'I want to buy a good pair of shoes.',
  'Laptop under ₹70,000 for programming and local AI models',
  'A washing machine for a family of four — must be durable',
  'Good running shoes under ₹5,000 for daily jogging',
  'Skin care serum for sensitive skin',
  'Basmati rice for everyday cooking',
];

export function Landing() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<
    { id: string; displayName: string; brand: string; category: string; imageUrl: string | null; highlights: string[] }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  async function search(term: string): Promise<void> {
    if (!term.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.products({ q: term });
      setProducts(result.products);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="pt-4 text-center sm:pt-10">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/70 px-3 py-1 text-[11px] text-mist-400">
          <span aria-hidden className="text-saffron-400">
            ◆
          </span>
          Shopping decision intelligence for India
        </span>

        <h1 className="mx-auto mt-4 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          What should you buy,{' '}
          <span className="bg-gradient-to-r from-saffron-300 to-saffron-500 bg-clip-text text-transparent">
            why, and when
          </span>
          ?
        </h1>

        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-mist-400">
          Tell SahiPick what you need. It researches the options, separates the real price from the
          discount theatre, reads what owners actually complain about, and tells you whether to buy now
          or wait.
        </p>

        <form
          className="mx-auto mt-6 flex max-w-xl flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What do you want to buy? Any product, any category…"
            aria-label="Describe what you need"
            className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-mist-50 placeholder:text-mist-500 focus:border-saffron-400/60 focus:outline-none"
          />
          <Button type="submit" disabled={loading || !query.trim()} className="sm:w-32">
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuery(example);
                navigate('/ask', { state: { message: example } });
              }}
              className="rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-[11px] text-mist-400 transition hover:border-saffron-400/40 hover:text-saffron-300"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <Button onClick={() => navigate('/ask')} variant="outline">
            Open the shopping assistant →
          </Button>
        </div>
      </section>

      <section>
        <SectionTitle
          title="Browse by category"
          subtitle="Phones and laptops are fully modelled today; more categories are on the way."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              onClick={() => {
                setQuery(category.label);
                navigate('/discover');
              }}
              className="rounded-xl border border-ink-700/70 bg-ink-900/50 px-3 py-3 text-left transition hover:border-saffron-400/40"
            >
              <span className="text-lg text-saffron-400" aria-hidden>
                {category.icon}
              </span>
              <p className="mt-1 text-xs font-medium text-mist-100">{category.label}</p>
            </button>
          ))}
        </div>
      </section>

      {(loading || products.length > 0 || error) && (
        <section>
          <SectionTitle title="Search results" />
          {error ? (
            <Card className="p-4 text-xs text-rose-300">{error}</Card>
          ) : loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-44" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            title: 'Real payable price',
            body: 'Coupons, bank discounts, card offers, cashback, exchange and delivery are calculated separately — guaranteed savings shown apart from conditional ones.',
          },
          {
            title: 'Variant-safe matching',
            body: 'A 16GB/1TB unit is never merged with an 8GB/512GB one. Identifiers decide first; conflicting specs always split the variant.',
          },
          {
            title: 'Evidence, not vibes',
            body: 'Every complaint links back to a quote. Pattern warnings are labelled as signals, never as proof that a review is fake.',
          },
        ].map((item) => (
          <Card key={item.title} className="p-4">
            <h3 className="text-xs font-semibold text-mist-50">{item.title}</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mist-500">{item.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
