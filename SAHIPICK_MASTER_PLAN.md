# SahiPick — Master Plan

> Living document. Product architecture, implementation status, decisions and remaining work.
> Last updated: 2026-11-13

## 1. Product

SahiPick is a shopping **decision intelligence** platform for Indian consumers. It answers
four questions that shopping sites do not:

1. **What should I buy?** — ranked, explainable recommendations for a stated requirement.
2. **Why?** — evidence from specifications, owner reviews and reliability signals.
3. **Where and for how much?** — the *real* payable amount across retailers, after
   coupons, bank discounts, card offers, EMI, cashback, exchange and delivery.
4. **Now or later?** — price position versus observed history, with explicit uncertainty.

It is not a price tracker, not a chatbot, not an affiliate list. Affiliate links may
exist, but **commission can never influence ranking** (see ADR-0006).

### Non-negotiable integrity rules

| Rule | Enforcement |
|---|---|
| Never fabricate products, prices, reviews, offers, history, availability or warranty | `DataOrigin` on every record; `origin='sample'` is rendered with a visible label |
| Never present sample data as live retailer data | API returns `provenance.origin`; UI renders a provenance badge |
| Financial arithmetic is deterministic | `intelligence/pricing/offers.ts` — pure functions, no LLM in the math path |
| Never merge different variants | `intelligence/matching/identity.ts` — hard-field conflicts block exact match |
| Never call a review "fake" | Review analysis reports *signals* with a mandatory caveat |
| Affiliate commission never affects ranking | Commission is not even a field on the scoring input |

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ web/  React 19 + Vite 7 + Tailwind 4   (SPA, mobile-first, responsive)      │
│      Landing · Ask (streaming) · Discover · Product · Compare · Sources      │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ /api (JSON)  +  /api/chat/stream (SSE)
┌────────────────────────────────▼─────────────────────────────────────────────┐
│ server/  Node 26 · TypeScript executed natively · Express 5                   │
│                                                                              │
│  api/          routes: search · products · compare · chat · chat/stream      │
│                · price-history · links/inspect · providers · metrics         │
│  ai/           provider abstraction · intent · tools · guardrails · agent ·  │
│                pipeline (staged, streamed, parallel)                         │
│  intelligence/ categories (plugin registry) · matching · reviews · pricing  │
│                · pricehistory · recommendations · cache · metrics           │
│  retailers/    provider adapters + registry (each declares capabilities)     │
│  pipeline/     ingestion · matching · review analysis · seeding              │
│  db/           node:sqlite repositories + schema (idempotent)                │
│  net/          SSRF-guarded fetch + untrusted-content sanitiser             │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                        SQLite (WAL) — server/src/data/sahipick.db
```

### Why this stack (ADR-0001)

The build environment is **Termux on aarch64** (Android). That single constraint drives
the stack:

| Decision | Reason | Trade-off accepted |
|---|---|---|
| **TypeScript everywhere** | One language across server and web; no Python/Node boundary | Python's ML ecosystem is unavailable — see ADR-0002 |
| **Node native TS execution** (no ts-node/tsx/build step) | Node 26 strips types natively; zero build tooling, instant start | No runtime type-checking — `tsc --noEmit` runs in CI instead |
| **`node:sqlite` built-in** | No native compilation (better-sqlite3 fails often on aarch64 Termux) | Single-writer concurrency; fine for this scale |
| **SQLite, not Postgres** | No server to run on a phone | Migrations needed to reach Postgres later |
| **No Redis / RabbitMQ / S3** | Heavy native deps, no daemon supervisor on Termux | Background jobs use a durable SQLite job table (ADR-0004) |
| **Express 5** | Only server dependency; pure JS | — |
| **React 19 + Vite 8 + Tailwind 4** | Fast, no native deps, modern | — |
| **`node:test`** | Built-in test runner; no jest/vitest install | Fewer assertion helpers than vitest |

---

## 3. Systems map

SahiPick is built as independent systems. The blueprint's System A–N map to modules as
follows.

| Blueprint system | Status | Module |
|---|---|---|
| A — Personal shopping agent | 🟡 in progress | `ai/` (provider, intent, tools, guardrails, pipeline) |
| B — Product discovery engine | 🟡 adapters ready, live feeds pending | `retailers/` |
| C — Product identity & SKU matching | ✅ core complete | `intelligence/matching/identity.ts` |
| D — Technical product intelligence | ✅ 11 categories modelled | `intelligence/categories/`, `intelligence/recommendations/components.ts` |
| E — Review intelligence | ✅ core complete | `intelligence/reviews/` |
| F — Real purchase price engine | ✅ core complete | `intelligence/pricing/` |
| G — Price history & deal intelligence | ✅ core complete | `intelligence/pricehistory/` |
| H — Personalised decision engine | ✅ core complete | `intelligence/recommendations/scoring.ts` |
| I — Product comparison | ✅ API + UI complete | `api/index.ts` (`/api/compare`), `web/src/pages/Compare.tsx` |
| J — Product link & image understanding | 🟡 JSON-LD only | `retailers/user-link.ts` |
| K — Post-purchase ownership | ⬜ planned | needs `purchases`, `warranty` tables |
| L — User personalisation | ⬜ planned | needs `user_preferences` table |
| M — Savings & monitoring | 🟡 `price_alerts` table + freshness policies exist; no worker | ADR-0004 |
| N — Administration & operations | 🟡 provider health + `/api/metrics` exist; no admin UI | `retailers/registry.ts`, `intelligence/metrics.ts` |

Legend: ✅ core complete · 🟡 in progress · ⬜ planned

## 4. Key design decisions

### ADR-0001 — Stack: TypeScript + Node built-ins (Termux-first)
**Decision:** TypeScript server executed natively by Node 26, SQLite via `node:sqlite`.
**Alternatives:** Python/FastAPI (as used by ValuSee, Aria, ShopSense, CartPilot);
Postgres + Redis + RabbitMQ (ValuSee production topology).
**Why:** Every reference implementation is Python-based with heavy infrastructure. In
Termux, `psycopg2`, `redis`, `chromadb` and native wheels are a recurring failure
source, and there is no service supervisor. Python 3.13 *is* available, so a hybrid was
possible — but a single language removes an entire class of deployment risk.
**Consequence:** Category-specific ML evaluators (e.g. a learned review classifier)
will eventually need a Python sidecar. The intelligence modules are already isolated
behind pure interfaces so that boundary can be added without touching the API.

### ADR-0002 — Deterministic fact layer, LLM for language only
**Decision:** Money, dates, eligibility, budget and hard constraints are computed in
plain TypeScript. The LLM may discover, summarise and explain — never calculate.
**Why:** All four reference projects converge on this. Aria's guardrails caught a
fabricated price in its own recorded runs; ShopSense re-checks prices against store
pages before showing them.
**Enforcement:** `intelligence/pricing/offers.ts` is a pure function with no imports
outside the domain types. Tests assert determinism and order-independence.

### ADR-0003 — Honest unavailability over fabricated data
**Decision:** When a data source cannot be accessed, the API returns an explicit
`unavailable` / `unknown` state with a reason. Sample data is a separate provider,
opt-in via configuration, and every record it produces carries `origin='sample'`.
**Why:** The blueprint and ValuSee both forbid filling gaps with demo products.
**Enforcement:** `retailers/registry.ts` returns `ProviderHealth` per provider;
`Provenance.origin` is threaded through to the UI.

### ADR-0004 — Durable jobs in SQLite, not an in-memory queue
**Decision:** Scheduled work (price polling, alert evaluation) is stored in a
`monitoring_jobs` table and claimed by a worker loop.
**Why:** ValuSee uses RabbitMQ plus a separate worker; ShopSense persists monitors so
they survive restarts. On Termux there is no broker, but SQLite gives the same
durability guarantee with no extra process.

### ADR-0005 — Verdict-first matching, not confidence-first
**Decision:** Matching ranks by *verdict* (exact match > different variant > related >
unrelated) and uses confidence only to break ties.
**Why:** A proven RAM or storage difference legitimately yields high confidence, so a
confidence-only comparison would rank "definitely a different variant" above "probably
the same item". This was a real bug caught by the test suite during implementation.

### ADR-0006 — Commission is not part of the scoring input
**Decision:** The `Candidate` type passed to the scoring engine has no commission
field. Affiliate links are attached at the presentation layer only.
**Why:** Blueprint §11 and ValuSee's neutrality requirement.

### ADR-0007 — Colour matching is deliberately conservative
**Decision:** "Titanium Grey" and "Grey" are treated as different colours.
**Why:** Collapsing marketing colour names is a false-merge risk. The brief forbids
merging different variants, so the matcher prefers a conservative split and surfaces
the difference rather than hiding it.

### ADR-0008 — Bounded agent execution
**Decision:** The agent loop has a hard cap on tool calls, wall-clock time and token
budget. Identical tool calls are not repeated. On hitting a limit the agent answers
from what it gathered rather than failing.
**Why:** Aria caps at 8 tool calls / 60s; ShopSense caps steps, tokens and cost.

### ADR-0009 — Citation gate
**Decision:** A factual answer without at least one resolvable citation is rejected
before it reaches the user.
**Why:** Aria implements the same gate, and it is the practical defence against
hallucinated prices.

### ADR-0010 — Untrusted content handling
**Decision:** Any retailer/page text is labelled as data, stripped of invisible
characters, and never treated as instructions. Outbound fetches are restricted to
public addresses with SSRF checks.
**Why:** Prompt injection is an explicit requirement (ShopSense documents a full
mitigation stack; the blueprint requires it too).

### ADR-0011 — Category plugins, not category conditionals
**Decision:** Every category is a `CategoryProfile` declaring its own
specification schema, variant-defining fields, decision dimensions, review
aspects, risk rules, ownership-cost model and scoring components. The engine
reads from a registry and never branches on a category name.
**Why:** The brief requires a universal platform — a smartphone evaluator must
understand cameras, processors, battery and software updates, while a washing
machine evaluator must understand capacity, energy consumption, motor type,
service network and reliability. A scoring formula chosen per category cannot
scale past a handful of categories; a plugin can.
**Consequence:** A new category is one profile file. Verified: appliance,
fashion, grocery and audio queries return correct, budget-respecting
recommendations through the same code path as phones and laptops.

### ADR-0012 — Staged pipeline with streamed progress
**Decision:** The decision pipeline runs in visible stages (understand →
discover → match → recommend), each emitting a progress event with its own
measured duration over Server-Sent Events. Independent verification work runs
concurrently with bounded concurrency.
**Why:** The brief requires the user to see useful results immediately rather
than stare at a loader. Aria bounds its agent loop; ShopSense bounds steps,
tokens and cost; here the *stages themselves* are the unit of visibility.
**Measured:** 1144 ms end-to-end for a phone query (brief understood in 15 ms); 720 ms for a laptop query; 9 ms when the brief is too vague and a question is asked instead.

### ADR-0013 — Per-fact-kind freshness, not one cache TTL
**Decision:** Ten fact kinds, each with its own TTL — from 60 seconds for stock
to 30 days for product identity. The API exposes the policy so the UI can say
when information was last checked.
**Why:** "Do not reuse stale prices as current prices", but also "do not
repeatedly research the same products". One TTL cannot satisfy both.
**Consequence:** `intelligence/cache/freshness.ts` is the single place where
staleness is decided.

### ADR-0014 — Adapt permissively-licensed logic, never import it
**Decision:** Where a reference project has a permissive licence (ValuSee MIT,
Aria Apache-2.0), individual *rules* are adapted into SahiPick's own idiom with
attribution in `THIRD_PARTY_NOTICE.md` and a header comment in the adapted
file. Where the licence is absent or unclear (ShopSense, CartPilot,
ecommerce-price-tracker), nothing is copied — ideas only. Python projects are
never imported into this TypeScript stack.
**Why:** "Reuse existing working engineering wherever legally permitted, not
rewrite proven functionality" — but also "do not copy a complete competing
application and create architectural conflicts", and the target environment
cannot host a Python service.
**Concrete:** Aria's claim verifier replaced our naive price check (it
distinguishes a budget echo from a product price, which our version did not);
ValuSee's identity rules replaced ours (condition and connector are checked
before the SKU, and missing data lowers confidence). Both are covered by tests.

## 5. Data architecture

Implemented tables (`server/src/db/schema.sql`): `products`, `product_variants`,
`retailer_listings`, `offers`, `price_points`, `reviews`, `review_intelligence`,
`ingestion_runs`, `price_alerts`.

Every table stores provenance (JSON) and observation timestamps where the fact could
change. Planned tables (per blueprint §5): `users`, `user_preferences`, `user_devices`,
`shopping_sessions`, `conversation_messages`, `purchase_briefs`, `retailers`, `sellers`,
`product_identifiers`, `product_matches`, `offer_eligibility`, `review_evidence`,
`product_risk`, `comparisons`, `saved_products`, `notifications`, `purchases`,
`invoices`, `warranties`, `returns`, `refunds`, `monitoring_jobs`, `provider_health`,
`agent_traces`.

### Provenance model

`origin` ∈ `live | sample | derived | model_est | unknown`.

`live` = fetched from a source at a known time. `sample` = bundled demonstration data.
`derived` = computed by SahiPick. `model_est` = produced by an AI model and never
treated as fact. `unknown` = no usable provenance.

## 6. India-specific requirements

- All money in integer **paise**; display via `Intl` Indian digit grouping (`₹1,29,999`).
- Indian bank offers (HDFC, ICICI, Axis, SBI …) modelled as structured offer data.
- **Pincode-sensitive availability** planned as a first-class listing attribute.
- **Asia/Kolkata** timezone for all user-facing dates.
- Indian sale calendar (`pricehistory/sales-calendar.ts`): Great Indian Festival, Big
  Billion Days and Diwali windows.
- Review analysis supports **English, Hindi (Devanagari) and Hinglish**.
- GST-inclusive pricing is the Indian default; MRP is shown as a reference, never as
  the comparison basis.
- Regional language review content is first-class in the lexicon, not an afterthought.

## 7. Implementation order (dependency-aware stages)

| Stage | Scope | Status |
|---|---|---|
| 1 | Core architecture, UX, DB models, provider interfaces | 🟡 in progress |
| 2 | Product discovery, canonical products, variant matching, comparison | 🟡 in progress |
| 3 | Price observations, history, offers, deal intelligence | 🟡 in progress |
| 4 | Review ingestion, evidence, review intelligence, risk | 🟡 in progress |
| 5 | Conversational agent + personalised recommendations | 🟡 in progress |
| 6 | Monitoring, notifications, post-purchase management | ⬜ not started |
| 7 | Admin console, evaluation suites, production hardening | ⬜ not started |

These stages are an **implementation order**, not a reduction of the product vision.

## 8. Evaluation plan (Stage 7, designed now)

Metrics to implement as automated suites:

- Retrieval: Recall@k, nDCG@k, MRR over a labelled query→product set.
- Matching: exact-SKU accuracy, **variant separation accuracy** (the critical one).
- Reviews: claim groundedness (does every stated complaint trace to a quote?).
- Pricing: calculation correctness, offer eligibility correctness, order-independence.
- Recommendations: quality against human-labelled winners.
- Citations: completeness (share of factual claims with a resolvable citation).
- Agent: task success, latency, cost per turn, tool-call efficiency.
- Adversarial: wrong variants, misleading titles, stale prices, ineligible bank offers,
  contradictory reviews, missing specs, fabricated claims, **instructions embedded in
  retailer page text**.

The variant-separation and pricing suites already exist and run on every change.

## 9. Reference research summary

Studied (read, not cloned): ValuSee (MIT), Aria / agentic-shopping (Apache-2.0),
ShopSense (no licence stated), CartPilot (no licence — reference only). See
`SOURCE_AND_LICENSE_AUDIT.md` for licences and what was adapted.

What was genuinely useful and **has been implemented**:

1. ValuSee — deterministic fact layer; explicit unavailability; confirmation gate for
   uncertain identity; workflow state machine; durable monitors; BYO-LLM provider.
2. Aria — bounded tool loop; citation gate; guardrail middleware; measurable eval.
3. ShopSense — price verification before display; persisted preferences in agent context;
   shopping-only scope guard; request-check for state-changing tools; IST timezone.
4. CartPilot — purchase brief → choice questions → normalised constraints → plan →
   search → filter → retrieve → rank → compare → explain → self-check → memory.

What was **deliberately not** copied: Python/LangGraph stack, Redis/RabbitMQ/S3,
Chroma, Langfuse tracing, or any source code. All SahiPick code is original.

## 10. Remaining work — see `IMPLEMENTATION_STATUS.md`

Updated after every meaningful stage.
