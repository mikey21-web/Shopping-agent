# Source & Licence Audit

> Every external dependency, dataset and reference consulted for SahiPick, with its
> licence, how it is used, and whether any of its code was copied.
> Last updated: 2026-11-13

## Principle

SahiPick's implementation is **original**. Reference projects were studied for
architecture and ideas only. Where a small piece of logic was adapted, it is
recorded in `THIRD_PARTY_NOTICE.md` with attribution, and the adapted file
carries a header comment naming the origin, its licence and the nature of the
change.

---

## 1. Runtime dependencies (installed)

| Dependency | Version | Licence | Use | Notes |
|---|---|---|---|---|
| `express` | ^5.3.0 | MIT | HTTP server / API | Only runtime dependency |
| `react`, `react-dom` | ^19.2.0 | MIT | Web UI | |
| `react-router-dom` | ^7.9.1 | MIT | Client routing | |
| `vite` | ^7.3.8 | MIT | Frontend build/dev server | **Pinned down from v8** — see §4 |
| `@vitejs/plugin-react` | ^4.7.0 | MIT | React fast refresh | |
| `tailwindcss`, `@tailwindcss/vite` | ^4.3.5 | MIT | Styling | |
| `typescript` | ^5.9.0 | Apache-2.0 | Type checking (`tsc --noEmit`) | |
| `@types/node`, `@types/express`, `@types/react`, `@types/react-dom` | various | MIT | Type definitions | |

**npm overrides** (`web/package.json`) — required for Termux compatibility:

| Override | From | To | Licence | Why |
|---|---|---|---|---|
| `rollup` | `@rollup/rollup-android-arm64` (native `.node`) | `@rollup/wasm-node` | MIT | Native addons cannot be dlopen'ed in the Android linker namespace |
| `lightningcss` | `lightningcss` (native `.node`) | `lightningcss-wasm` | MIT | Same reason |

**Node built-ins used** (MIT, part of the Node.js distribution):
`node:sqlite` (database), `node:test` (test runner), `node:http`, `node:fs`,
`node:dns`, `node:net`, `node:crypto`, `node:url`, `node:path`, `node:os`.

No native addons, no compiled binaries, no external databases, no message
brokers. This is deliberate: the target environment is Termux on aarch64,
where native compilation is slow and frequently fails.

## 2. Reference projects — inspected at source, not just README

All six were cloned and their actual source read (`app/`, `demo/`, `src/`).

| Project | Licence found | Code reused? | Outcome |
|---|---|---|---|
| [ValuSee](https://github.com/biheto/ValuSee) | **MIT** (`LICENSE`) | **Yes — adapted, attributed** | Its `app/shopping/identity.py` identity rules were adapted into our matcher. See `THIRD_PARTY_NOTICE.md`. |
| [Aria / agentic-shopping](https://github.com/caprion/agentic-shopping) | **Apache-2.0** (`LICENSE`) | **Yes — adapted, attributed** | Its `demo/app/guardrails.py` claim-verification rules were adapted into our answer guardrail. See `THIRD_PARTY_NOTICE.md`. |
| [ShopSense](https://github.com/raghav-malik/ShopSense) | **None found** | **No** | No `LICENSE` file in the repository. Read only for architectural understanding: per-turn step/token/cost budgets, price verification against store pages before display, scope guard, request-check before state-changing tools, `Asia/Kolkata` handling, untrusted-web-text sanitisation. All of these concepts were already implemented in SahiPick independently; none were copied. |
| [CartPilot](https://github.com/olicy666/CartPilot) | **None found** (README states a formal licence should be added before public reuse) | **No** | Read only for the purchase-brief → choice-question → normalised-constraint → plan → filter → rank → compare → explain → self-check workflow shape, and for its `backend/data/category_skills/*.json` category-profile shape (category id, aliases, decision dimensions, required specs, scenario weights, common risks, ranking rules). SahiPick's category framework was designed independently and is a superset — it adds a specification schema, variant fields, risk *rules* and an ownership-cost model per category. |
| [ecommerce-price-tracker](https://github.com/niks-data/ecommerce-price-tracker) | **None found**; repository contains only a `README.md` (no source) | **No** | Nothing to integrate. The price-observation model (timestamped observations, change detection) was implemented independently in `intelligence/pricehistory/`. |
| [pyJedAI](https://github.com/INFORMSJoC/2023.0410) | **Apache-2.0** (`LICENSE`) | **No** | Python entity-resolution library with blocking, clustering, progressive matching and IR evaluation metrics. Its *concepts* informed our evaluation plan (blocking → candidate generation, precision/recall for matching accuracy). Adopting the library itself would add a Python dependency to a Termux deployment and duplicate functionality we already have in TypeScript. **Decision: independently implement, do not integrate.** |

### What each reference actually contributed

| Reference | Idea taken | Where it landed |
|---|---|---|
| ValuSee | Deterministic fact layer; honest data boundary; identity confirmation gate; workflow state machine; durable monitors; BYO-LLM provider | ADR-0002, ADR-0003, ADR-0004, ADR-0008 |
| Aria | Bounded tool loop; citation gate; guardrail middleware; measurable evaluation; graceful degradation without an LLM key | `ai/agent.ts`, `ai/guardrails.ts`, `tests/performance.test.ts` |
| ShopSense | Price verification before display; persisted preferences in agent context; shopping-only scope guard; request-check for state-changing tools; IST timezone; untrusted-content sanitisation | `ai/guardrails.ts` (stock guard), `net/safe-fetch.ts`, `config.ts` |
| CartPilot | Purchase brief → choice questions → normalised constraints → plan → filter → rank → compare → explain → self-check | `ai/intent.ts`, `ai/pipeline.ts` |
| pyJedAI | Blocking → candidate generation; matching precision/recall as an evaluation metric | `intelligence/matching/identity.ts`, evaluation plan in `SAHIPICK_MASTER_PLAN.md` |

### Licences of note

- **ValuSee — MIT.** Permits reuse with attribution. One file adapted; attribution
  given in `THIRD_PARTY_NOTICE.md` and in the file header.
- **Aria — Apache-2.0.** Permits reuse with attribution and a NOTICE file.
  Apache 2.0 §4(b) requires modified files to carry prominent change notices;
  the adapted file does. `THIRD_PARTY_NOTICE.md` discharges the NOTICE
  obligation.
- **ShopSense / CartPilot / ecommerce-price-tracker** — no permissive licence
  was established, so **no code was copied and no code may be copied**. Ideas
  only, and they were independently implemented.

## 3. Datasets — NOT currently used

SahiPick ships **no third-party dataset**. The bundled catalogue is authored
in-repository as clearly-labelled sample data (`origin='sample'`), covering
smartphones, laptops, appliances, audio, fashion and grocery so that the
category framework is exercised beyond electronics.

Datasets considered and **deliberately not used**:

| Dataset | Licence | Why not used |
|---|---|---|
| Amazon Reviews 2023 (McAuley-Lab) | Research-use terms | US marketplace, USD pricing, no Indian availability or bank offers. Would violate "do not assume US data represents Indian availability" |
| Amazon Shopping Queries (amazon-science/esci-data) | Public | Candidate for a **gold evaluation set for retrieval metrics** (Recall@k, nDCG, MRR) — US queries, but the metric is language-agnostic. Stage 7 candidate, with attribution |
| Olist Brazilian E-Commerce | CC BY-NC-SA 4.0 | **NC restriction** conflicts with commercial intent. Not used |
| τ-bench (retail) | See project | Candidate for agent tool-use evaluation (Stage 7) |
| Google Product Taxonomy | Public | Candidate for category normalisation |

## 4. Toolchain decisions forced by the environment

Two build-tool decisions were made specifically because the development
environment is **Termux/Proot on Android**, where native Node addons cannot be
loaded:

| Issue | Decision |
|---|---|
| Vite 8 uses Rolldown, whose native `.node` binding cannot be dlopen'ed | Pinned **Vite 7** (Rollup + esbuild), with `rollup` overridden to `@rollup/wasm-node` |
| `lightningcss` ships a native `.node` binding | Overridden to `lightningcss-wasm` |
| Vite 8 also required a rolldown native binding | Resolved by the Vite 7 pin above |
| `esbuild` is a standalone binary, not an addon | Works unmodified — no override needed |

Both overrides point at the official WASM builds published by the same
upstream projects, under the same MIT licences.

## 5. Rules for contributors

1. **No new runtime dependency** without recording it here with licence and use.
2. **Prefer Node built-ins** and pure TypeScript over native addons — Termux
   compatibility is a hard constraint.
3. **No dataset with non-commercial or unclear terms** may be bundled.
4. **No code copy** from a reference whose licence has not been verified.
5. Every new data source must declare its licence and provenance before use.
6. Secrets stay in environment variables; `.env` is git-ignored and never committed.
7. Any adapted logic must be recorded in `THIRD_PARTY_NOTICE.md` *and* carry a
   header comment in the adapted file.
