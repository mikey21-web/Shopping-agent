# Implementation Status

> Living document. Completed, in-progress and blocked features, with evidence.
> Last updated: 2026-11-13

Legend: ✅ complete · 🟡 in progress · ⬜ not started · 🔒 blocked

---

## 1. Foundations

| Feature | State | Evidence |
|---|---|---|
| TypeScript everywhere, executed natively by Node 26 | ✅ | `server/package.json`, no build step for the server |
| SQLite via `node:sqlite` (no native compilation) | ✅ | `server/src/db/index.ts` |
| Express 5 API with typed routes | ✅ | `server/src/api/index.ts` |
| React 19 + Vite 7 + Tailwind 4 web app | ✅ | `web/` — builds to 317 kB JS / 35 kB CSS |
| Vite build works on Termux (no native addons) | ✅ | `web/package.json` npm `overrides` → `@rollup/wasm-node`, `lightningcss-wasm` |
| Idempotent schema + migrations | ✅ | `server/src/db/schema.sql`, `npm run migrate` |
| Repository layer (all SQL in one place) | ✅ | `server/src/db/repositories.ts` |
| Config from environment, secrets never committed | ✅ | `server/src/config.ts` |
| Type checking in CI (`tsc --noEmit`) | ✅ | `npm run typecheck` — clean for server and web |
| Performance regression guard | ✅ | The evaluation suite caught two real bugs: catastrophic regex backtracking in budget parsing, and 110 regex compilations per category lookup. Category detection went from 529 ms to 0.2 ms |

## 2. Intelligence engines

| Feature | State | Evidence |
|---|---|---|
| Specification normalisation (RAM, storage, SoC, display, battery, camera, price parsing) | ✅ | `intelligence/normalize/specs.ts` — 16 unit tests |
| SoC / GPU performance tier tables | ✅ | `intelligence/normalize/soc-tiers.ts` |
| Local-AI model capacity estimator (VRAM + RAM → model sizes) | ✅ | `soc-tiers.ts::localModelCapacity` |
| Product identity (brand + model + generation) | ✅ | `intelligence/matching/identity.ts` |
| Variant matching with explainable signals | ✅ | verdict-first ranking; verdict + confidence + signals + differences |
| **Identifier-first matching** (part number / SKU / GTIN decisive) | ✅ | `identity.ts` — conflicting identifiers block an exact match |
| **Condition & connector hard separators** | ✅ | Adapted from ValuSee (MIT) — checked *before* identifiers |
| **"Missing data is not agreement"** | ✅ | Adapted from ValuSee (MIT) — unknown fields lower confidence |
| Review analysis (aspects, sentiment, complaints, praise) | ✅ | `intelligence/reviews/analysis.ts` |
| English + Hindi + Hinglish lexicon | ✅ | `intelligence/reviews/lexicon.ts` — 24 aspects, 3 languages |
| Review authenticity signals (duplicate, burst, repetitive, distribution, verified ratio, incentive language) | ✅ | Explicit caveat always attached; never calls a review fake |
| Long-term ownership concerns | ✅ | Complaints clustered in older reviews |
| Deterministic offer engine | ✅ | `intelligence/pricing/offers.ts` — 9 tests incl. order-independence |
| Guaranteed vs conditional discount separation | ✅ | Cashback and exchange never subtracted from the payable amount |
| EMI arithmetic (integer paise) | ✅ | `intelligence/pricing/emi.ts` |
| Price statistics and buy-now-or-wait engine | ✅ | `intelligence/pricehistory/stats.ts` |
| Indian sale calendar (Great Indian Festival, Big Billion, Diwali) | ✅ | `pricehistory/sales-calendar.ts` |
| Recommendation engine with badges and evidence | ✅ | `intelligence/recommendations/scoring.ts` |
| Category-specific scoring profiles | ✅ | `intelligence/recommendations/components.ts` |
| Must-have constraint enforcement | ✅ | Excluded products are reported with a reason, not silently dropped |

## 3. Universal category framework

| Feature | State | Evidence |
|---|---|---|
| Category profile schema (spec fields, variant fields, decision dimensions, risks, ownership model, review aspects) | ✅ | `intelligence/categories/types.ts` |
| Category registry with alias/request-term detection | ✅ | `intelligence/categories/index.ts` |
| **11 categories registered** | ✅ | smartphone, laptop, tv, audio, smartwatch, camera, appliance, furniture, fashion, beauty, grocery |
| Per-category ownership cost models | ✅ | Appliances model electricity from rated power; consumables model cost-per-use |
| Per-category risk rules | ✅ | e.g. OLED burn-in, soldered RAM, counterfeit risk in beauty, allergen risk in grocery |
| Category-aware variant fields | ✅ | Appliances separate by capacity, shoes by size, phones by RAM/storage |
| Verified working across categories | ✅ | Live queries for appliance / fashion / grocery / audio all return correct, budget-respecting results |
| Bespoke scoring for every category | 🟡 | Only smartphone + laptop have bespoke component sets; the rest use the generic set, and the UI says so |

## 4. Performance architecture

| Feature | State | Evidence |
|---|---|---|
| Staged decision pipeline (understand → discover → match → recommend) | ✅ | `ai/pipeline.ts` |
| Server-Sent Events streaming with real per-stage timings | ✅ | `POST /api/chat/stream` |
| Parallel verification with bounded concurrency | ✅ | `withConcurrency` — 3 candidates verified concurrently |
| Freshness policies per fact kind | ✅ | `intelligence/cache/freshness.ts` — 10 fact kinds, from 60 s (stock) to 30 d (identity) |
| TTL cache with hit/miss counters | ✅ | `intelligence/cache/cache.ts` |
| In-flight de-duplication (no duplicate concurrent research) | ✅ | `cached()` shares one promise per key |
| Metrics endpoint | ✅ | `GET /api/metrics` — timers, counters, cache stats, freshness table |
| Performance evaluation suite | ✅ | `tests/performance.test.ts` — 3 scenarios + 5 adversarial checks |
| Measured stage timings | ✅ | 1144 ms total for a phone query (understand 15 ms); 720 ms for a laptop query; 9 ms for a clarification |
| Frontend shows real stage progress | ✅ | `web/src/lib/stream.ts`, `web/src/pages/Ask.tsx` |

## 5. Conversational agent

| Feature | State | Evidence |
|---|---|---|
| Natural-language requirement extraction | ✅ | `ai/intent.ts` — budget, category, priorities, workloads, must-haves |
| Hinglish budget parsing ("30 हजार से कम", "under 25k") | ✅ | `parseBudget` |
| Targeted follow-up questions | ✅ | Asked when the brief has gaps, never guessed |
| Deterministic grounded composer (no API key needed) | ✅ | `ai/provider.ts::GroundedLocalProvider` |
| OpenAI-compatible provider (any vendor) | ✅ | `ai/provider.ts::OpenAiCompatibleProvider` |
| Tool registry with JSON schemas | ✅ | `ai/tools.ts` — 7 tools |
| Bounded execution (tool-call cap, wall-clock cap) | ✅ | `MAX_TOOL_CALLS = 8`, 20 s budget |
| Citation gate | ✅ | Adapted from Aria (Apache-2.0) |
| Claim verifier (price / rating / discount) | ✅ | Adapted from Aria (Apache-2.0) — handles limit echoes, price bands, derived differences |
| Budget guard | ✅ | Over-budget products removed and reported |
| Stock guard | ✅ | Out-of-stock listings cannot be presented as buyable; truthful "out of stock" is not flagged |
| Untrusted-content handling + SSRF protection | ✅ | `net/safe-fetch.ts` |
| Conversation memory across turns | ⬜ | Sessions are stateless today |
| Model-written synthesis (LLM path) | 🟡 | Implemented behind `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`; unexercised against a live model in this environment |

## 6. Retailer integrations

| Feature | State | Evidence |
|---|---|---|
| Provider interface with capability + terms declaration | ✅ | `retailers/types.ts` |
| Registry reporting per-provider outcomes, including failures | ✅ | `retailers/registry.ts` |
| Credential-gated adapters for Amazon.in, Flipkart, Croma, Reliance Digital, Vijay Sales | ✅ | `retailers/credential-gated.ts` — report `not_configured` with the exact variables missing |
| User-submitted product link reader (JSON-LD) | ✅ | `retailers/user-link.ts` — works with no credentials |
| **Live feed request signing and payload mapping** | 🔒 | Blocked on retailer credentials + programme approval |
| Myntra, Ajio, Nykaa, Tata CLiQ, JioMart adapters | ⬜ | Not started |
| Pincode-sensitive availability | ⬜ | Schema field reserved; no provider supplies it yet |
| Product link / screenshot understanding (System J) | ⬜ | JSON-LD only today; OCR and vision not started |
| Browser-extension capture | ⬜ | Not started |

## 7. Data quality and integrity

| Feature | State | Evidence |
|---|---|---|
| `DataOrigin` on every record (live / sample / derived / model_est / unknown) | ✅ | `domain/types.ts` |
| Provenance rendered as a visible badge in the UI | ✅ | `web/src/components/Provenance.tsx` |
| Sample data never presented as live | ✅ | Badge + explicit note + guardrail violation |
| Affiliate commission structurally absent from ranking | ✅ | `Candidate` type has no commission field |
| No fabricated prices, reviews, offers or history | ✅ | All records originate from stored rows |
| Budget, eligibility, arithmetic all deterministic | ✅ | No LLM in the financial path |

## 8. User experience

| Screen | State | Evidence |
|---|---|---|
| Landing with conversational entry | ✅ | `web/src/pages/Landing.tsx` |
| Conversational assistant with streaming progress | ✅ | `web/src/pages/Ask.tsx` |
| Discovery with per-provider status | ✅ | `web/src/pages/Discover.tsx` |
| Product detail: price, offers, history, specs, variants, cross-retailer matching, review intelligence | ✅ | `web/src/pages/ProductDetail.tsx` |
| Comparison with highlighted differences | ✅ | `web/src/pages/Compare.tsx` |
| Sources & provider health | ✅ | `web/src/pages/Sources.tsx` |
| Mobile-first responsive layout | ✅ | Bottom nav under `sm`, single-column stacks |
| Post-purchase ownership (System K) | ⬜ | Not started |
| Saved products / price alerts (System M) | ⬜ | `price_alerts` table exists; no UI |
| User preferences & personalisation (System L) | ⬜ | Not started |
| Administration console (System N) | 🟡 | Provider health + metrics exist; no admin UI |

## 9. Test coverage

| Suite | State |
|---|---|
| Spec normalisation (16 tests) | ✅ |
| Variant matching and product identity (12 tests) | ✅ |
| Pricing and offer eligibility (9 tests) | ✅ |
| Guardrails — claim verification, citation gate, budget, stock (12 tests) | ✅ |
| Category framework and identity rules (12 tests) | ✅ |
| Performance evaluation + adversarial correctness (6 tests, isolated via `npm run test:perf`) | ✅ |
| **Total** | ✅ **82 passing, 0 failing** |

## 10. Blocked work

| Item | Blocker | How to unblock |
|---|---|---|
| Live retailer feeds | Retailer affiliate/merchant programmes require approved credentials | Apply for the programmes; set the environment variables listed in `web/src/pages/Sources.tsx` |
| Model-written synthesis | No API key in this environment | Set `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` — works with OpenAI, OpenRouter, Groq, Ollama or any OpenAI-compatible server |
| OCR / vision extraction | No OCR engine installed; native bindings are blocked in Termux | Use a WASM OCR engine (tesseract.js) or a vision API |
| Durable background jobs | No message broker available | Implemented instead as a SQLite job table with a worker loop (ADR-0004) |

## 11. Next work, in order

1. **Live retailer adapters** — request signing and payload mapping for the five registered retailers.
2. **Product link & image understanding** — OCR, vision extraction, confidence gating, user confirmation.
3. **Conversation memory** — session persistence and preference learning.
4. **Post-purchase ownership** — purchases, invoices, warranty, return and refund deadlines.
5. **Monitoring & alerts** — durable price monitors and notifications.
6. **User preferences & profile**.
7. **Administration console**.
8. **More categories** — bespoke scoring models for appliance, audio, tv, fashion, beauty, grocery.
9. **Evaluation expansion** — retrieval Recall@k / nDCG against a labelled query set; matching precision/recall.
