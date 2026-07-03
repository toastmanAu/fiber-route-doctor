# Hosted Web Demo via GitHub Pages — Design

**Date:** 2026-07-03
**Status:** Drafted with best-judgment defaults (user AFK); awaiting review. Choices marked ★ are the ones to confirm.
**Deliverable:** The fiber-route-doctor web app hosted at `https://toastmanau.github.io/fiber-route-doctor/`, auto-deployed on push to master — the hackathon's "hosted demo" line item.

## What the demo actually is (the one real design decision)

GitHub Pages serves over **HTTPS**. Two browser rules shape what a visitor can do:
- **Mixed content:** an HTTPS page's `fetch` to `http://…` is blocked — *except* `http://localhost` / `http://127.0.0.1`, which browsers treat as potentially-trustworthy and allow.
- **CORS:** a cross-origin `fetch` needs the node to send `Access-Control-Allow-Origin`. fnn does not send CORS headers by default, so even a localhost node is typically CORS-blocked from the hosted page.

Consequence, stated honestly: **the in-browser wallet is fully live with zero backend** — a visitor can create a wallet, mint a real scoped biscuit token, and inspect it, all client-side (crypto + IndexedDB). The node-querying panels (Diagnose / Health / Liquidity / Map) work only when pointed at a reachable, CORS-enabled node (e.g. a visitor running fnn locally with CORS on, or via the CLI). ★ **Scope: ship the real app as-is, add a short banner explaining this, and point visitors to the CLI + the standalone map HTML for live-data viewing.** No backend, no proxy, matches "keep it simple."

A canned-snapshot "demo mode" (bundle real 246-node/650-channel testnet data so the Map/Liquidity panels render with no node) is the natural higher-impact follow-up — explicitly **out of scope** for this pass, noted below.

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
- **`apps/web/src/App.tsx`** (or a small `DemoBanner.tsx`) — a dismissible top banner shown only in production builds (`import.meta.env.PROD`): one sentence that the wallet is fully live in-browser, node panels need a CORS-enabled node, with links to the repo README (CLI usage) and the gap analysis. Keep it small and factual; no scope creep into the panels.
- **`README.md`** — add a "Live demo" line linking the Pages URL near the top, beside the gap-analysis link.

## Data flow

```
push master → Actions: npm ci → build apps/web (base=/fiber-route-doctor/) → upload dist artifact → deploy-pages
visitor → HTTPS page → wallet panel: 100% client-side (works) │ node panels: fetch(user node url) → works iff node is reachable + CORS-enabled
```

## Error handling / edge cases

- **Build fails in CI** → deploy job doesn't run; master's live site stays on the last good deploy. The `vite build` gate we already added catches wasm/bundling breakage before it reaches Pages.
- **Node unreachable/CORS-blocked** → the panels already surface `fetch failed` / error strings in their error banners; the demo banner pre-explains why, so it reads as expected rather than broken.
- **Base-path regression** → a smoke check in the workflow (grep the built `dist/index.html` for `/fiber-route-doctor/` asset prefixes) fails the build if `base` is misconfigured, before deploy.

## Testing

- Local: `npm run build --workspace @fiber-route-doctor/web` succeeds and `apps/web/dist/index.html` references `/fiber-route-doctor/assets/…` (the base-path assertion).
- `npm run typecheck` + `npm test` unaffected (this change is build config + a banner; the banner is trivial JSX with no logic to unit-test — typecheck is the gate, consistent with the other panels).
- Post-deploy manual check: load the Pages URL, confirm the app renders (not a blank/404), create a wallet, mint a token — the live client-side path, which is the demo's actual substance.
- No new automated tests: this is deployment plumbing; the app's behavior is already covered by the existing 230-test suite.

## Out of scope / backlog

- Canned "demo mode" with bundled testnet snapshot data (the higher-impact follow-up — bundle a `graph_nodes`/`graph_channels` fixture + a toggle so Map/Liquidity render offline).
- A CORS-proxy or hosted read-only node (a backend — explicitly rejected for "keep it simple").
- Custom domain / CNAME.
- Preview deploys per-PR.

## One-time setup note

The workflow enables Pages on first successful run (via `configure-pages` with `enablement: true`), so the only human step is confirming, in the repo's Settings → Pages, that the source shows "GitHub Actions" after the first deploy — no manual branch/folder selection. `gh` is already authenticated as `toastmanAu` if any API nudge is needed.
