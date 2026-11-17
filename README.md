# SahiPick

Universal shopping decision intelligence for India. Tell it what you need in
plain language; it asks only the questions that change the shortlist, researches
the open web, verifies evidence, calculates exact Indian pricing in paise, and
explains the decision with a trace you can challenge.

Works for **any product category** — shoes, phones, laptops, appliances,
furniture, fashion, beauty, grocery, automotive, and anything else — through a
generic fallback when no specialised profile is registered.

## What it does

- **Buyer intelligence** — extracts the budget, intended use, priorities and
  constraints from a single sentence, then asks conditional follow-ups (shoe
  size and fit, not camera and battery). Skip any question or say "you decide".
- **Data acquisition** — 11 Indian retailer adapters (Amazon, Flipkart, Myntra,
  AJIO, Croma, Reliance Digital, Tata CLiQ, Blinkit, Zepto, Decathlon,
  Roadster) plus provider-independent search (Brave, Exa, Linkup, SearxNG,
  Cloudflare, DuckDuckGo). Browser escalation for JS-rendered pages.
- **Universal extraction** — JSON-LD → embedded JSON → retailer adapter →
  rendered DOM cascade, with strict Zod schemas and full provenance. Missing
  values stay null; nothing is invented.
- **Product identity** — deterministic size/standard/width/gender matching so a
  UK 9 and a UK 10 are never merged.
- **Deep research** — planner, parallel bounded workers, adaptive follow-ups,
  research memory, evidence graph, and decision-readiness checks.
- **Ownership intelligence** — complaint clustering, review syndication
  detection, variant and date tracking. Counts are reported as counts, never
  extrapolated into failure rates.
- **Deterministic pricing** — list, sale, coupons, bank offers, cashback,
  exchange, EMI, shipping and eligibility, all in integer paise. No LLM ever
  does the arithmetic.
- **Decision engine** — hard constraints first, then eight dimensions scored
  by the category's own evaluator, with badges and a 7-section trace.
- **SSE progress** — real per-stage timings, no simulated bars.

## Run locally

```bash
# Backend (Node 22+, TypeScript via Node's native type stripping)
cd server
npm install
npm run seed          # load the clearly-labelled sample catalogue
npm start             # http://localhost:4000

# Frontend
cd web
npm install
npm run dev           # or npm run build -> server serves web/dist
```

Copy `.env.example` to `.env` at the repository root and add the API keys you
want. All keys are optional; DuckDuckGo and the retailer adapters work
keylessly, and unavailable sources are reported honestly.

## Tests

```bash
cd server && npm test        # 148 tests, 0 failures
cd web && npm run typecheck && npm run build
```

## Deploy

The Express server serves the built frontend from `web/dist`, so a single
Node host (VPS, Render, Railway, Vercel with a Node runtime) is enough. Set
`PORT`, `DATABASE_PATH` and the API keys in the host's environment. Use a
persistent volume for the SQLite database in production.

## Licence

MIT. See `THIRD_PARTY_NOTICE.md` in the server directory for attribution of
open-source components used as references.
