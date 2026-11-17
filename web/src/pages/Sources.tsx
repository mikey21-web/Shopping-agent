import { useEffect, useState } from 'react';
import { api, type ProviderHealth, type ResearchSourceStatus } from '../lib/api.ts';
import { Badge, Card, SectionTitle, Skeleton } from '../components/ui.tsx';

const ACCESS_METHOD_LABELS: Record<string, string> = {
  official_api: 'Official API',
  affiliate_feed: 'Affiliate feed',
  merchant_feed: 'Merchant feed',
  public_page: 'Public page (user-supplied)',
  user_capture: 'User-confirmed capture',
  sample: 'Bundled sample data',
};

export function Sources() {
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [note, setNote] = useState('');
  const [health, setHealth] = useState<{
    aiProvider: string;
    remoteLlmConfigured: boolean;
    timeZone: string;
  } | null>(null);
  const [research, setResearch] = useState<{
    providers: ResearchSourceStatus[];
    retailers: ResearchSourceStatus[];
    browser: { configured: boolean; reason: string | null };
    enabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.providers(), api.health(), api.researchSources()])
      .then(([providerResult, healthResult, researchResult]) => {
        setProviders(providerResult.providers);
        setNote(providerResult.note);
        setHealth(healthResult);
        setResearch(researchResult);
      })
      .catch(() => setLoading(false))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Sources & status</h1>
        <p className="mt-1 text-xs leading-relaxed text-mist-500">
          Which retailers SahiPick can read, how it is allowed to read them, and what is currently
          unavailable. An unavailable source is reported as unavailable — it is never replaced by
          demonstration data.
        </p>
      </div>

      {health ? (
        <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-mist-500">Answer model</p>
            <p className="mt-0.5 text-xs font-semibold text-mist-100">
              {health.remoteLlmConfigured ? health.aiProvider : 'Deterministic grounded composer'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-mist-500">Timezone</p>
            <p className="mt-0.5 text-xs font-semibold text-mist-100">{health.timeZone}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-mist-500">Currency</p>
            <p className="mt-0.5 text-xs font-semibold text-mist-100">INR (integer paise)</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-mist-500">Retailers registered</p>
            <p className="mt-0.5 text-xs font-semibold text-mist-100">{providers.length}</p>
          </div>
        </Card>
      ) : null}

      <section>
        <SectionTitle title="Retailer providers" />
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => (
              <Card key={provider.providerId} className="p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-mist-50">{provider.providerName}</h3>
                    <Badge
                      tone={
                        provider.status === 'ok'
                          ? 'jade'
                          : provider.status === 'not_configured'
                            ? 'saffron'
                            : 'neutral'
                      }
                    >
                      {provider.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-mist-500">
                    {ACCESS_METHOD_LABELS[provider.accessMethod] ?? provider.accessMethod}
                  </span>
                </div>

                <p className="mt-1.5 text-[11px] leading-relaxed text-mist-400">{provider.reason}</p>
                {provider.hint ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-mist-500">{provider.hint}</p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">refresh every {provider.refreshIntervalMinutes} min</Badge>
                  <Badge tone="neutral">confidence {Math.round(provider.dataConfidence * 100)}%</Badge>
                  <Badge tone="neutral">{provider.categories.length} categories</Badge>
                  {provider.lastSuccessAt ? (
                    <Badge tone="jade">last success {provider.lastSuccessAt.slice(0, 10)}</Badge>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {research ? (
        <section className="space-y-3">
          <SectionTitle title="Universal acquisition — live research" />
          <Card className="p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={research.enabled ? 'jade' : 'saffron'}>
                web research {research.enabled ? 'enabled' : 'disabled'}
              </Badge>
              <Badge tone={research.browser.configured ? 'jade' : 'neutral'}>
                browser {research.browser.configured ? 'ready' : 'HTTP only'}
              </Badge>
              <span className="text-[11px] text-mist-500">
                {research.providers.filter((provider) => provider.configured).length} of {research.providers.length} search providers configured
              </span>
            </div>
          </Card>

          <div className="grid gap-2 sm:grid-cols-2">
            {research.retailers.map((retailer) => (
              <Card key={retailer.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-mist-100">{retailer.name}</h3>
                  <Badge tone={retailer.available ? 'jade' : 'saffron'} className="text-[9px]">
                    {retailer.available ? 'live' : 'needs setup'}
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] text-mist-500">
                  {retailer.domains?.join(', ') ?? '—'} · {retailer.access ?? 'page'}
                </p>
                {retailer.reason ? (
                  <p className="mt-1 text-[10px] text-saffron-300/80">{retailer.reason}</p>
                ) : null}
              </Card>
            ))}
          </div>

          <Card className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist-500">Search providers</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {research.providers.map((provider) => (
                <Badge key={provider.id} tone={provider.configured ? 'jade' : 'neutral'}>
                  {provider.name}
                  {provider.configured ? '' : ' — ' + (provider.reason ?? 'needs key')}
                </Badge>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      {note ? (
        <Card className="p-3.5">
          <p className="text-[11px] leading-relaxed text-mist-400">{note}</p>
        </Card>
      ) : null}

      <Card className="p-4">
        <h3 className="text-xs font-semibold text-mist-50">How to enable a live retailer</h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-mist-500">
          Each provider reads its credentials from the environment. Until they are present the provider stays
          registered but returns no products, and the UI says so. Nothing is hardcoded and no key is ever
          committed.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-850 px-3 py-2 text-[10px] text-mist-400">
{`# .env
AMAZON_PAAPI_ACCESS_KEY=...
AMAZON_PAAPI_SECRET_KEY=...
AMAZON_PAAPI_PARTNER_TAG=...
FLIPKART_AFFILIATE_ID=...
FLIPKART_AFFILIATE_TOKEN=...
AI_BASE_URL=https://...
AI_MODEL=...
AI_API_KEY=...`}
        </pre>
      </Card>
    </div>
  );
}
