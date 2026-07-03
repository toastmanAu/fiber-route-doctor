# Hosted Web Demo via GitHub Pages — Design

**Date:** 2026-07-03
**Status:** Approved — GitHub Actions deploy, project-page URL, AND demo-mode fixture (user pulled demo mode into scope). Choices marked ★ confirmed.
**Deliverable:** The fiber-route-doctor web app hosted at `https://toastmanau.github.io/fiber-route-doctor/`, auto-deployed on push to master — the hackathon's "hosted demo" line item.

## What the demo actually is (the one real design decision)

GitHub Pages serves over **HTTPS**. Two browser rules shape what a visitor can do:
- **Mixed content:** an HTTPS page's `fetch` to `http://…` is blocked — *except* `http://localhost` / `http://127.0.0.1`, which browsers treat as potentially-trustworthy and allow.
- **CORS:** a cross-origin `fetch` needs the node to send `Access-Control-Allow-Origin`. fnn does not send CORS headers by default, so even a localhost node is typically CORS-blocked from the hosted page.

Consequence: **the in-browser wallet is fully live with zero backend** — a visitor can create a wallet, mint a real scoped biscuit token, and inspect it, all client-side (crypto + IndexedDB). The node-querying panels can't reach a live node over the internet.

**Demo mode closes that gap (in scope).** We bundle a real captured testnet snapshot (`graph_nodes` + `graph_channels` = 246-node / 650-channel topology, plus this node's `node_info`/`list_peers`/`list_channels`) and a `demoFetch` that serves it. A "Demo data" toggle makes the panels run their *entire real pipeline* (pagination, parsing, model building, layout, attribution) over the captured wire data — no node, no CORS, no fabrication. This turns the hosted page into a genuine working showcase: the Map renders the real 246/650 network; Diagnose finds a real route between two mega-hubs; the Health probe correctly diagnoses the (real, isolated) demo node; Liquidity honestly shows the demo node's empty own-channel set. The wallet remains live regardless. A short banner explains that live-node queries require the CLI or a CORS-enabled node, and the Demo toggle is the no-setup path.

Honesty note: the snapshot is real captured data (v0.7.1 driveThree node, 2026-07-03), refreshable via a capture script — nothing is synthesized. The demo node being isolated is real and the tools reporting it accurately is itself part of the demonstration.

## Architecture (approved defaults)

★ **Deploy mechanism: GitHub Actions → Pages** (official `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`). Reproducible, no build output committed, redeploys on every merge to master. The workflow itself enables Pages (source = GitHub Actions) on first run, so no manual repo-settings step is required beyond the one-time confirmation that Actions has Pages write permission (the workflow declares `permissions: pages: write, id-token: write`).

★ **URL form: project page** `toastmanau.github.io/fiber-route-doctor/`. Requires Vite `base: "/fiber-route-doctor/"` so hashed asset URLs resolve under the subpath. The app is a single page with no client-side router, so there is no SPA-deep-link 404 concern (the one classic Pages gotcha does not apply here).

### Files

- **`apps/web/vite.config.ts`** — add `base: "/fiber-route-doctor/"`. It must NOT break local `npm run dev` (Vite dev honors `base` but still serves at root-relative during dev; verified this is fine for our single-page app). Keep the wasm + top-level-await plugins (required since Tier B).
- **`.github/workflows/deploy-pages.yml`** — new workflow:
  - Trigger: `push` to `master` (+ `workflow_dispatch` for manual redeploy).
  - Concurrency group `pages` so overlapping pushes don't race.
  - Job: checkout → setup-node 22 → `npm ci` → `npm run build --workspace @fiber-route-doctor/web` → `actions/upload-pages-artifact` with `path: apps/web/dist` → `actions/deploy-pages`.
  - `permissions: { contents: read, pages: write, id-token: write }`.
- **`scripts/capture-demo-fixtures.mjs`** — env-gated (like the smokes): mints a readonly token, paginates `graph_nodes`/`graph_channels`, calls `node_info`/`list_peers`/`list_channels`, and writes the five captured JSON-RPC *result* payloads to `apps/web/src/demo/fixtures.json`. Reproducible/refreshable; not hand-pasted. The committed fixture is what CI builds.
- **`apps/web/src/demo/fixtures.json`** — the committed snapshot (~680 KB; gzips small). Five keys: `graphNodes`, `graphChannels`, `nodeInfo`, `listPeers`, `listChannels`.
- **`apps/web/src/demo/demo-fetch.ts`** (the feature core, unit-tested) — `demoFetch: typeof fetch` that reads the JSON-RPC `method` from the request body and returns the matching fixture in a `{ jsonrpc, id, result }` envelope. Returns the full arrays in a single page with no `last_cursor`, which the client's cursor loop correctly treats as the last page (a full page is exactly 500; 650 ≠ 500 → stop). Also exports `DEMO_SOURCE`/`DEMO_TARGET` (the two mega-hub pubkeys, degree ~540 each — a route provably exists) and `DEMO_AMOUNT` for prefilling Diagnose.
- **Panel wiring** — `HealthPanel`/`LiquidityPanel`/`NetworkMapPanel` gain an optional `fetchOverride?: typeof fetch` prop; when set, each builds its `HealthClient`/`GraphClient` with `{ url, biscuit, fetchImpl: fetchOverride }` (url/token become irrelevant but harmless). `App.tsx`'s Diagnose `run()` uses `demoFetch` when demo mode is on and prefills source/target/amount from the demo constants.
- **`apps/web/src/App.tsx`** — a "Demo data (real testnet snapshot — no node needed)" toggle near the top. When on, passes `fetchOverride={demoFetch}` to all three panels and drives Diagnose via `demoFetch` + prefilled hubs. Plus a small factual banner (shown in prod) that the wallet is fully live client-side, live-node queries need the CLI or a CORS-enabled node, and the Demo toggle is the zero-setup path — with links to the README and gap analysis.
- **`README.md`** — add a "Live demo" line linking the Pages URL near the top, beside the gap-analysis link.

## Data flow

```
push master → Actions: npm ci → build apps/web (base=/fiber-route-doctor/) → upload dist artifact → deploy-pages
visitor → HTTPS page →
  wallet panel:      100% client-side (always works)
  Demo data ON:      panels use demoFetch(fixtures) → real 246/650 pipeline, no node
  Demo data OFF:     panels fetch(user node url) → works iff node reachable + CORS-enabled
```

## Error handling / edge cases

- **Build fails in CI** → deploy job doesn't run; master's live site stays on the last good deploy. The `vite build` gate we already added catches wasm/bundling breakage before it reaches Pages.
- **Node unreachable/CORS-blocked** → the panels already surface `fetch failed` / error strings in their error banners; the demo banner pre-explains why, so it reads as expected rather than broken.
- **Base-path regression** → a smoke check in the workflow (grep the built `dist/index.html` for `/fiber-route-doctor/` asset prefixes) fails the build if `base` is misconfigured, before deploy.

## Testing

- **`demoFetch` unit tests** (the one piece with logic): dispatches on JSON-RPC method (node_info/list_peers/list_channels/graph_nodes/graph_channels) → correct fixture envelope; the graph methods return a single non-500-length page so the client's pagination loop terminates. **Integration assertion**: `buildNetworkMapModel` over data pulled through `new GraphClient({ url: "demo", fetchImpl: demoFetch })` yields 246 nodes / 650 channels, and `DEMO_SOURCE`/`DEMO_TARGET` both appear in the model (guarantees the Diagnose demo has real endpoints). This runs the real pipeline against the fixture, so it also guards the fixture staying parseable.
- Base-path: `npm run build --workspace @fiber-route-doctor/web` succeeds and `apps/web/dist/index.html` references `/fiber-route-doctor/assets/…`.
- `npm run typecheck` + full `npm test` green (existing 230 + the demoFetch tests).
- Panels/App/banner are JSX wiring verified by typecheck (consistent with the other panels' testing posture); the `fetchOverride` seam is exercised by the demoFetch integration test.
- Post-deploy manual check: load the Pages URL, toggle Demo data, confirm the Map renders 246 nodes and Diagnose finds a route; create a wallet and mint a token.

## Out of scope / backlog

- A CORS-proxy or hosted read-only node (a backend — explicitly rejected for "keep it simple").
- Fabricated "healthy node" fixtures for Health/Liquidity — we show real captured data, isolated node and all.
- Auto-refreshing the fixture on a schedule (it's captured once for the hackathon; the script makes a manual refresh a one-liner).
- Custom domain / CNAME; per-PR preview deploys.

## One-time setup note

The workflow enables Pages on first successful run (via `configure-pages` with `enablement: true`), so the only human step is confirming, in the repo's Settings → Pages, that the source shows "GitHub Actions" after the first deploy — no manual branch/folder selection. `gh` is already authenticated as `toastmanAu` if any API nudge is needed.
