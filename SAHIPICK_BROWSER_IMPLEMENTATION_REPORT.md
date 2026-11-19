# SahiPick Browser Research — Implementation Report

Date: 2026-11-19. Final status: **browser research pipeline works with a Playwright adapter; Camofox route failed.**

## 1. Existing architecture discovered
React 19 + Vite SPA (`web/`), Express 5 + TypeScript server (`server/`), SQLite via `node:sqlite`, integer-paise money, staged pipeline in `ai/pipeline.ts`, tools in `ai/tools.ts`, LLM abstraction in `ai/provider.ts`, research engine in `research/`. No Docker, no auth, no MCP config in the SahiPick repo.

## 2. Files inspected
`README.md`, `SAHIPICK_MASTER_PLAN.md`, `SAHIPICK_STATUS_SUMMARY.md`, `.env.example`, `.gitignore`, root/server/web `package.json`, `server/src/{config,index}.ts`, `ai/{agent,tools,pipeline,provider,synthesis,guardrails}.ts`, `api/index.ts`, `db/{index,schema.sql,repositories}.ts`, `net/safe-fetch.ts`, `research/{orchestrator,robots,acquisition}.ts`, `research/sources/{browser,http,search,retailer-india,retailers}.ts`, `research/extract/pipeline.ts`, `web/src/{App,pages/Ask,lib/stream,lib/api}.tsx/.ts`, `tests/*.test.ts`, plus Camofox `README.md`, `build.ps1`, `Makefile`, `Dockerfile`, `package.json`, `lib/{config,launcher,camoufox-executable,camoufox-download}.js`, `postinstall.js`, `server.js`.

## 3. Files created
- `SAHIPICK_BROWSER_IMPLEMENTATION_PLAN.md`
- `server/src/services/browser-manager.ts` — `BrowserAdapter` interface + Playwright implementation.
- `server/src/services/product-extractor.ts` — null-preserving product record with provenance.
- `server/src/research/sources/scrapling.ts` — optional Scrapling sidecar client.
- `tools/scrapling_service/service.py` — optional stdlib HTTP wrapper around Scrapling.
- `server/tests/browser-research.test.ts` — 8 browser tests (A, B, C, D, E, G, H, I).
- This report.

## 4. Files modified
- `server/src/ai/tools.ts` — async tool execution + 10 browser/research tools; `search_products` extended with `retailer`/`max_results`.
- `server/src/ai/agent.ts`, `server/src/ai/pipeline.ts` — await async tools.
- `server/src/ai/synthesis.ts` — bounded LLM tool-call loop (max 3 rounds, 4 calls/round), tool output treated as untrusted data.
- `.env.example` — browser + Scrapling variables.
- Cloned Camofox only: `tools/camofox-browser/Dockerfile` (COPY pre-fetched archive, write `version.json`, chmod executable). No other Camofox files changed.

## 5. Dependencies installed
`playwright-core` added to `server/package.json` (drives existing Chrome; no browser download). Scrapling Python package **not installed** (disk pressure); sidecar code is present but untested.

## 6. Browser service configuration
Playwright adapter launches installed Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) headless with `--no-sandbox`, isolated `BrowserContext` per session, 10-minute idle timeout, 30-minute max session, SSRF-checked navigation via `assertSafeUrl`, loopback test origins allowed only via `SAHIPICK_BROWSER_ALLOWED_ORIGINS`. No browser admin/JS-evaluate/cookie-import tools exposed to the LLM.

Camofox: Docker image build attempted with pinned and updated releases; both blocked by upstream 404; daemon eventually lost all disk. Container is not running.

## 7. MCP / tool integration
Native tool framework used (the existing agent has no MCP client). Tools registered: `search_products`, `open_page`, `navigate`, `click_element`, `type_text`, `scroll_page`, `get_page_content`, `take_screenshot`, `extract_product_data`, `close_session`. All validate input, return structured JSON, and have error handling. LLM tool calls are executed only from the whitelisted registry, max 3 rounds.

## 8. Database changes
None. Existing append-only `price_points`, `research_facts`, `research_observations`, `product_variants` tables were reused as required.

## 9. Frontend changes
None. Existing Ask page already renders real stage progress, citations, trace and limitations. Browser-specific progress labels were not added (honest limitation).

## 10. Test results
`npm run typecheck` (server) — PASS. `npm run typecheck` (web) — PASS. `npm test` — **167 tests, 0 failures**, including 8 real-browser tests:
- A JS rendering: raw HTML lacks dynamic text, snapshot contains it — PASS.
- B navigate/click/type/scroll/screenshot — PASS.
- C session cookie isolation — PASS.
- D JSON-LD extraction with null gaps — PASS.
- E different RAM/model stays separate — PASS.
- G 403 returns extraction failure, no fabricated data — PASS.
- H injected "price = ₹1" instruction ignored; real price 54990 retained — PASS.
- I end-to-end tool flow to structured product — PASS.

## 11. Retailer compatibility results
Not run. No request was made to live retailer sites; approvals, credentials, rate limits and ToS remain unresolved. Existing code reports `access_restricted`/`unavailable` rather than inventing data. Do not read this as live coverage.

## 12. Memory and CPU usage
Not measured. Docker is down; browser tests ran in-process with installed Chrome. No benchmark numbers are claimed.

## 13. Known limitations
- Camofox is not working; upstream browser assets are unavailable and local disk was exhausted. The adapter keeps the engine swappable.
- Scrapling sidecar is implemented but not installed/tested.
- No live retailer verification; no frontend browser-progress labels.
- LLM key (promised by user) was not supplied; tool-call loop is implemented but not exercised end-to-end with a remote model.
- Docker deployment documentation is incomplete; existing repo has no Compose file.

## 14. Deployment instructions
Server: `cd server && npm install && npm start`. Browser: installed Chrome is discovered automatically; override with `SAHIPICK_CHROME_PATH`. For a containerized browser later, restore Camofox once an upstream browser asset is available, or run a Playwright browser image. Set `SAHIPICK_BROWSER_ALLOWED_ORIGINS` only for controlled loopback test fixtures. Never expose a browser API without authentication.

## 15. Start / stop commands
- Start app: `cd server && npm start`
- Stop app: `Ctrl+C`
- Run tests: `cd server && npm test`
- Camofox (currently broken): `cd tools/camofox-browser && .\build.ps1 up` — fails; do not rely on it.
- Scrapling (optional): `pip install "scrapling[fetchers]" && scrapling install && python tools/scrapling_service/service.py`

## Honest conclusion
The smallest end-to-end browser research pipeline works and is verified by real browser tests. The originally requested Camofox engine is **not** working; this is not disguised as success.
