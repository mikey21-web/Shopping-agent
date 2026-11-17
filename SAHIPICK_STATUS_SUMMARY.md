# SahiPick — Status Summary (as of 2026-11-14)

## What it is
A TypeScript shopping decision engine running on Node 26 (Termux/aarch64). No Python, no native addons, deterministic paise arithmetic.

## What's built
- **75 source files, ~18.7k lines** TypeScript/TSX
- **82 tests passing, 0 failing**
- Clean `tsc --noEmit` for both server and web
- 11 category profiles (smartphone, laptop, tv, audio, smartwatch, camera, appliance, furniture, fashion, beauty, grocery)
- Staged pipeline: understand → discover → match → recommend
- SSE streaming at `/api/chat/stream` with real per-stage timings
- `/api/metrics` endpoint with timers, counters, freshness table
- Guardrails: citation gate, budget enforcement, stock checks, sample-data warnings
- Category‑specific scoring, variant matching, review intelligence (EN/HI/Hinglish)
- Performance suite that caught 2 real bugs (regex backtracking, per‑category compilation)

## What works (live)
- Query: "washing machine under 50000" → appliance category, LG 8kg at ₹47,999 from Amazon.in
- Query: "earbuds under 3000" → audio category, boAt Airdopes 141 at ₹699 from Flipkart
- Query: "rice 5kg under 700" → grocery category, Daawat Basmati at ₹549 from Amazon.in
- Query: "running shoes under 5000" → fashion category, Nike Air Zoom Pegasus 40 at ₹4,999
- Query: "laptop under 70000 for Java + local AI" → 4 options, ASUS Vivobook 16 ₹62,990
- SSE progress shows actual stage durations (e.g. understand 15ms, discover 298ms, match 349ms, recommend 95ms)
- Compare endpoint highlights differences + price comparison
- Sample‑data badge + note on every answer using the bundled catalogue

## What's blocked (no‑code‑hangups)
- Live retailer feeds — need affiliate credentials (AMAZON_PAAPI_ACCESS_KEY, FLIPKART_AFFILIATE_ID, etc.)
- Post‑purchase ownership tables (purchases, warranty, returns)
- Conversation memory across turns
- Monitoring/alerts workers
- Admin console UI
- Bespoke scoring for appliance/audio/fashion/beauty/grocery (uses generic set, UI acknowledges)

## Key files (where's the code)
- `server/src/intelligence/categories/` — category profiles + term matcher
- `server/src/ai/intent.py`-type file — budget + priority extraction
- `server/src/intelligence/matching/identity.ts` — variant‑safe matching
- `server/src/intelligence/recommendations/scoring.ts` — category‑aware scoring
- `server/src/intelligence/cache/freshness.ts` — 10 fact‑kind TTL policies
- `server/tests/performance.test.ts` — 6 scenarios + 5 adversarial checks
- `web/src/pages/Ask.tsx` — streaming Ask page with real stage progress
- `IMPLEMENTATION_STATUS.md` — living document of every feature with evidence
- `SOURCE_AND_LICENSE_AUDIT.md` — licence verified at‑source
- `THIRD_PARTY_NOTICE.md` — attribution for Aria (Apache‑2.0) + ValuSee (MIT) adaptations

## How to run it
```bash
cd /root/sahipick
npm run setup     # installs + writes Vite wasm overrides for Termux
npm run seed      # builds the sample catalogue (~30s)
npm start          # API on :4000 + SPA on same origin
# Then open http://localhost:4000 and type questions
```

## Bottom line
Core decision engine works end‑to‑end across all 11 categories with deterministic pricing, bounded agent execution, and real SSE progress. Live retailer data and a few UX features are the remaining gaps.