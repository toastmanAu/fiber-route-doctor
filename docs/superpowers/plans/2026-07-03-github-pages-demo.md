# GitHub Pages Hosted Demo (with Demo Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-deploy the web app to `https://toastmanau.github.io/fiber-route-doctor/` on push to master, with a "Demo data" toggle that runs the real diagnostic pipeline over a bundled real testnet snapshot (246 nodes / 650 channels) — no node, no CORS, nothing fabricated.

**Architecture:** Vite `base` + a GitHub Actions Pages workflow for hosting. Demo mode exploits the fact that `GraphClient`/`HealthClient` already accept a `fetchImpl`: a `demoFetch` serves captured JSON-RPC fixtures, so the panels' full pipeline (pagination → parse → model → layout → attribution) runs unchanged over real wire data. Panels gain an optional `fetchOverride` prop; App wires a toggle.

**Tech Stack:** Vite 5 (+ existing wasm/top-level-await plugins), React 18, GitHub Actions, TypeScript ESM, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-github-pages-demo-design.md`

## Global Constraints

- Node >= 22; tests from repo root: `npx vitest run <files>`, `npm run typecheck`; web build: `npm run build --workspace @fiber-route-doctor/web`.
- Repo style: compact TS, semicolons, double quotes; tests in `<workspace>/test/*.test.ts`.
- Pages base path is exactly `/fiber-route-doctor/` (repo name). The built `dist/index.html` must reference `/fiber-route-doctor/assets/…`.
- Demo data is REAL captured data (driveThree fnn v0.7.1, 2026-07-03) — nothing synthesized. The demo node is genuinely isolated; the tools reporting that accurately is part of the demo.
- `demoFetch` returns each graph array as a single page with NO `last_cursor` — a full page is exactly 500, and 650 ≠ 500 / 213 ≠ 500, so the client's cursor loop stops after one page.
- The biscuit token/passphrase never appear in fixtures, the workflow, or any committed file. Fixtures contain only public gossip + this node's public info.
- Every task: run the task's tests + `npm run typecheck` before committing.

## Client shapes to match (verified)

```ts
// GraphClient/HealthClient options accept fetchImpl:
new GraphClient({ url, biscuit?, fetchImpl? })   // HealthClient extends GraphClient
client.graphNodes()    // JSON-RPC "graph_nodes"    → result { nodes: RpcGraphNode[] }
client.graphChannels() // "graph_channels"          → result { channels: RpcChannelInfo[] }
client.nodeInfo()      // "node_info"               → result = RpcNodeInfo object
client.listPeers()     // "list_peers"              → result { peers: RpcPeerInfo[] }
client.listChannels()  // "list_channels"           → result { channels: RpcChannel[] }
loadGraph(client): Promise<GraphModel>   // pulls graphNodes+graphChannels
```

---

### Task 1: Vite base path + GitHub Actions Pages workflow

**Files:**
- Modify: `apps/web/vite.config.ts`
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: a production build under base `/fiber-route-doctor/`; a workflow that builds `apps/web` and deploys `apps/web/dist` to Pages on push to master.

- [ ] **Step 1: Set the Vite base path**

`apps/web/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
export default defineConfig({ base: "/fiber-route-doctor/", plugins: [react(), wasm(), topLevelAwait()] });
```

- [ ] **Step 2: Verify the build emits subpath-prefixed assets**

Run: `npm run build --workspace @fiber-route-doctor/web && grep -c "/fiber-route-doctor/assets/" apps/web/dist/index.html`
Expected: build exits 0; grep count ≥ 1 (assets are prefixed with the base path).

- [ ] **Step 3: Write the deploy workflow**

`.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy web demo to Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm run build --workspace @fiber-route-doctor/web
      - name: Verify base path in build
        run: grep -q "/fiber-route-doctor/assets/" apps/web/dist/index.html
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/web/dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/vite.config.ts .github/workflows/deploy-pages.yml
git commit -m "ci(web): vite base path + GitHub Actions Pages deploy workflow"
```

Note: the first push to master after this triggers the workflow, which enables Pages (source = GitHub Actions) via `configure-pages`. No manual repo-settings step is needed; if Pages write permission is not yet granted the first run will fail with a clear message and the repo owner enables it once under Settings → Actions → Workflow permissions.

---

### Task 2: Capture script + real fixtures.json

**Files:**
- Create: `scripts/capture-demo-fixtures.mjs`
- Create: `apps/web/src/demo/fixtures.json` (generated by running the script against the live node)

**Interfaces:**
- Produces: `apps/web/src/demo/fixtures.json` with exactly `{ graphNodes: RpcGraphNode[], graphChannels: RpcChannelInfo[], nodeInfo: object, listPeers: RpcPeerInfo[], listChannels: RpcChannel[] }` — the five captured JSON-RPC results (arrays unwrapped from their `{nodes}`/`{channels}`/`{peers}` envelopes).

- [ ] **Step 1: Write the capture script**

`scripts/capture-demo-fixtures.mjs`:

```javascript
// Capture a real testnet snapshot into the bundled demo fixture.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/capture-demo-fixtures.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP capture-demo-fixtures: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });

async function call(method, params) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}
async function paginate(method, field) {
  let out = [], cursor;
  for (;;) {
    const r = await call(method, [cursor ? { after: cursor } : {}]);
    const batch = r[field] ?? [];
    out.push(...batch);
    if (batch.length !== 500) break;
    cursor = r.last_cursor;
    if (!cursor) break;
  }
  return out;
}

const fixtures = {
  graphNodes: await paginate("graph_nodes", "nodes"),
  graphChannels: await paginate("graph_channels", "channels"),
  nodeInfo: await call("node_info", []),
  listPeers: (await call("list_peers", [])).peers ?? [],
  listChannels: (await call("list_channels", [{}])).channels ?? []
};

const outPath = "apps/web/src/demo/fixtures.json";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(fixtures));
console.log(`OK: wrote ${outPath} — ${fixtures.graphNodes.length} nodes, ${fixtures.graphChannels.length} channels, ${fixtures.listChannels.length} own channels, fnn v${fixtures.nodeInfo.version}`);
```

- [ ] **Step 2: Run it against the live node to generate the fixture**

Run: `FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 node --import tsx scripts/capture-demo-fixtures.mjs`
Expected: `OK: wrote apps/web/src/demo/fixtures.json — 213 nodes, 650 channels, 0 own channels, fnn v0.7.1` (counts may drift slightly with live gossip; anything > 200 nodes / 600 channels is fine).
If this errors on node access (no key / node down), report BLOCKED — the controller will run the capture and provide the fixture.

- [ ] **Step 3: Sanity-check the fixture parses and is secret-free**

Run: `node -e "const f=require('./apps/web/src/demo/fixtures.json'); if(!Array.isArray(f.graphChannels)||f.graphChannels.length<600) throw new Error('bad fixture'); if(JSON.stringify(f).match(/ed25519-private|Bearer|biscuit_private/)) throw new Error('secret leak'); console.log('fixture ok', f.graphChannels.length, 'channels')"`
Expected: `fixture ok 650 channels` (or the live count), no throw.

- [ ] **Step 4: Commit**

```bash
git add scripts/capture-demo-fixtures.mjs apps/web/src/demo/fixtures.json
git commit -m "feat(web): capture script + real testnet snapshot fixture for demo mode"
```

---

### Task 3: demoFetch + demo route selection

**Files:**
- Create: `apps/web/src/demo/demo-fetch.ts`
- Test: `apps/web/test/demo-fetch.test.ts`

**Interfaces:**
- Consumes: `apps/web/src/demo/fixtures.json` (Task 2); `GraphClient`, `loadGraph`, `buildNetworkMapModel`, `runDiagnosis`, `type RpcChannelInfo` from `@fiber-route-doctor/core`.
- Produces:
  - `demoFetch: typeof fetch` — dispatches on the request body's JSON-RPC `method`, returns the matching fixture in a `{ jsonrpc, id, result }` envelope (HTTP 200).
  - `pickDemoRoute(channels: RpcChannelInfo[]): { source: string; target: string; amount: string }` — endpoints of the highest-capacity channel (guarantees a direct route), `amount` = a modest fixed value ("1000").
  - `DEMO_SOURCE`, `DEMO_TARGET`, `DEMO_AMOUNT` — module constants from `pickDemoRoute(fixtures.graphChannels)`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/demo-fetch.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { demoFetch, pickDemoRoute, DEMO_SOURCE, DEMO_TARGET, DEMO_AMOUNT } from "../src/demo/demo-fetch.js";
import { GraphClient, loadGraph, buildNetworkMapModel, runDiagnosis, CKB_ASSET, type RpcChannelInfo } from "@fiber-route-doctor/core";

async function rpc(method: string): Promise<unknown> {
  const res = await demoFetch("http://demo", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: [{}] }) });
  return (await res.json()).result;
}

describe("demoFetch", () => {
  it("serves each RPC method's fixture in a JSON-RPC envelope", async () => {
    expect((await rpc("graph_nodes") as { nodes: unknown[] }).nodes.length).toBeGreaterThan(200);
    expect((await rpc("graph_channels") as { channels: unknown[] }).channels.length).toBeGreaterThan(600);
    expect((await rpc("node_info") as { version: string }).version).toBeTruthy();
    expect((await rpc("list_peers") as { peers: unknown[] }).peers).toBeInstanceOf(Array);
    expect((await rpc("list_channels") as { channels: unknown[] }).channels).toBeInstanceOf(Array);
  });
  it("echoes the request id", async () => {
    const res = await demoFetch("http://demo", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "node_info", params: [] }) });
    expect((await res.json()).id).toBe(42);
  });
  it("runs the REAL pipeline: model over demoFetch yields the full network", async () => {
    const client = new GraphClient({ url: "demo", fetchImpl: demoFetch });
    const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
    const m = buildNetworkMapModel(nodes, channels);
    expect(m.stats.channelCount).toBeGreaterThan(600);
    expect(m.stats.nodeCount).toBeGreaterThan(200);
    // demo route endpoints are real nodes in the model
    const keys = new Set(m.nodes.map((n) => n.pubkey));
    expect(keys.has(DEMO_SOURCE)).toBe(true);
    expect(keys.has(DEMO_TARGET)).toBe(true);
  });
  it("finds a real payable route between the demo endpoints", async () => {
    const model = await loadGraph(new GraphClient({ url: "demo", fetchImpl: demoFetch }));
    const report = await runDiagnosis(model, { source: DEMO_SOURCE, target: DEMO_TARGET, amount: BigInt(DEMO_AMOUNT), asset: CKB_ASSET });
    expect(report.path.length).toBeGreaterThanOrEqual(1);
    expect(report.verdict).toBe("payable");
  });
});

describe("pickDemoRoute", () => {
  it("returns the endpoints of the highest-capacity channel", () => {
    const chans = [
      { channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb", capacity: "0x64" },
      { channel_outpoint: "0x2", node1: "0xcc", node2: "0xdd", capacity: "0xc8" }
    ] as RpcChannelInfo[];
    const r = pickDemoRoute(chans);
    expect(r).toEqual({ source: "0xcc", target: "0xdd", amount: "1000" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/test/demo-fetch.test.ts`
Expected: FAIL — no `demo-fetch.js`.

- [ ] **Step 3: Write minimal implementation**

First, enable JSON imports for the web workspace — `apps/web/tsconfig.json` (base config has no `resolveJsonModule`):

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"], "resolveJsonModule": true }, "include": ["src", "test"] }
```

`apps/web/src/demo/demo-fetch.ts`:

```typescript
import type { RpcChannelInfo } from "@fiber-route-doctor/core";
import fixtures from "./fixtures.json";

const RESULT_BY_METHOD: Record<string, unknown> = {
  node_info: fixtures.nodeInfo,
  list_peers: { peers: fixtures.listPeers },
  list_channels: { channels: fixtures.listChannels },
  graph_nodes: { nodes: fixtures.graphNodes },
  graph_channels: { channels: fixtures.graphChannels }
};

/** A fetch impl that serves the bundled real testnet snapshot — no node, no CORS. */
export const demoFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
  const result = RESULT_BY_METHOD[body.method ?? ""] ?? null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const DEMO_AMOUNT_VALUE = "1000";

/** Endpoints of the highest-capacity channel — guarantees a direct route exists. */
export function pickDemoRoute(channels: RpcChannelInfo[]): { source: string; target: string; amount: string } {
  let best = channels[0];
  for (const c of channels) if (BigInt(c.capacity) > BigInt(best.capacity)) best = c;
  return { source: best.node1, target: best.node2, amount: DEMO_AMOUNT_VALUE };
}

const route = pickDemoRoute(fixtures.graphChannels as RpcChannelInfo[]);
export const DEMO_SOURCE = route.source;
export const DEMO_TARGET = route.target;
export const DEMO_AMOUNT = route.amount;
```

Note: `fixtures.json` is ~680 KB; a plain `import` bundles it into the JS chunk (fine — it's the demo payload). The `apps/web/tsconfig.json` change above (`resolveJsonModule: true`) makes tsc accept the import; Vite handles it natively. Commit the tsconfig change with this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/test/demo-fetch.test.ts && npm run typecheck`
Expected: PASS. If the "payable route" test fails because the top-capacity channel is disabled or UDT-funded, adjust `pickDemoRoute` to pick the highest-capacity channel whose `funding_udt_type_script` is null AND has an enabled direction — but try the simple version first (the top channel is very likely CKB + enabled).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/demo/demo-fetch.ts apps/web/test/demo-fetch.test.ts apps/web/tsconfig.json
git commit -m "feat(web): demoFetch serving the real snapshot + demo route selection"
```

---

### Task 4: Panel `fetchOverride` prop

**Files:**
- Modify: `apps/web/src/HealthPanel.tsx`, `apps/web/src/LiquidityPanel.tsx`, `apps/web/src/NetworkMapPanel.tsx`
- Test: `npm run typecheck` + existing web tests green (props are wiring; the demoFetch integration test already exercises the client-with-fetchImpl path).

**Interfaces:**
- Consumes: `demoFetch` shape (`typeof fetch`).
- Produces: each panel accepts an optional `fetchOverride?: typeof fetch`; when present, every `new HealthClient({...})` / `new GraphClient({...})` in that panel includes `fetchImpl: fetchOverride`. Existing props preserved (NetworkMapPanel keeps `routeOutpoints`).

- [ ] **Step 1: HealthPanel**

`apps/web/src/HealthPanel.tsx` — change the signature and the client construction:

```tsx
export function HealthPanel({ fetchOverride }: { fetchOverride?: typeof fetch }) {
```
and at the `runHealthProbe(new HealthClient({ url, biscuit: token || undefined }))` site:
```tsx
      const report = await runHealthProbe(new HealthClient({ url, biscuit: token || undefined, fetchImpl: fetchOverride }));
```
(`fetchImpl: undefined` is harmless — GraphClient falls back to native fetch.)

- [ ] **Step 2: LiquidityPanel**

`apps/web/src/LiquidityPanel.tsx`:
```tsx
export function LiquidityPanel({ fetchOverride }: { fetchOverride?: typeof fetch }) {
```
```tsx
      const channels = await new HealthClient({ url, biscuit: token || undefined, fetchImpl: fetchOverride }).listChannels();
```

- [ ] **Step 3: NetworkMapPanel**

`apps/web/src/NetworkMapPanel.tsx`:
```tsx
export function NetworkMapPanel({ routeOutpoints, fetchOverride }: { routeOutpoints: string[]; fetchOverride?: typeof fetch }) {
```
```tsx
      const client = new HealthClient({ url, biscuit: token || undefined, fetchImpl: fetchOverride });
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run apps/web`
Expected: typecheck clean; existing web tests pass (App still renders the panels without the new prop — it's optional).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/HealthPanel.tsx apps/web/src/LiquidityPanel.tsx apps/web/src/NetworkMapPanel.tsx
git commit -m "feat(web): panels accept an optional fetchOverride for demo mode"
```

---

### Task 5: App demo toggle + banner + Diagnose demo wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `npm run typecheck` + existing web tests green.

**Interfaces:**
- Consumes: `demoFetch`, `DEMO_SOURCE`, `DEMO_TARGET`, `DEMO_AMOUNT` (Task 3); panels' `fetchOverride` prop (Task 4).
- Produces: a `demo` boolean state; a toggle UI; when on, panels get `fetchOverride={demoFetch}`, Diagnose runs through `demoFetch`, and source/target/amount are prefilled from the demo constants; a production-only banner.

- [ ] **Step 1: Wire the toggle, banner, and demo Diagnose**

`apps/web/src/App.tsx` — full updated file:

```tsx
import React, { useState } from "react";
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type RouteReport } from "@fiber-route-doctor/core";
import { buildProbe } from "./probe-form.js";
import { buildRouteView } from "./route-view.js";
import { RouteGraph } from "./RouteGraph.js";
import { HealthPanel } from "./HealthPanel.js";
import { LiquidityPanel } from "./LiquidityPanel.js";
import { NetworkMapPanel } from "./NetworkMapPanel.js";
import { WalletProvider } from "./wallet-context.js";
import { WalletPanel } from "./WalletPanel.js";
import { demoFetch, DEMO_SOURCE, DEMO_TARGET, DEMO_AMOUNT } from "./demo/demo-fetch.js";

export function App() {
  const [url, setUrl] = useState("http://127.0.0.1:8227");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("1000");
  const [asset, setAsset] = useState("");
  const [out, setOut] = useState("");
  const [report, setReport] = useState<RouteReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  function toggleDemo(on: boolean) {
    setDemo(on);
    if (on) { setSource(DEMO_SOURCE); setTarget(DEMO_TARGET); setAmount(DEMO_AMOUNT); setAsset(""); }
  }

  async function run() {
    setBusy(true);
    try {
      const probe = buildProbe({ source, target, amount, asset });
      const model = await loadGraph(new GraphClient({ url, fetchImpl: demo ? demoFetch : undefined }));
      const report: RouteReport = await runDiagnosis(model, probe);
      setReport(report);
      setOut(formatReportText(report));
    } catch (e) {
      setReport(null);
      setOut(`error: ${String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <WalletProvider>
      <main style={{ fontFamily: "monospace", maxWidth: 720, margin: "2rem auto" }}>
        {import.meta.env.PROD && (
          <div style={{ background: "#0d1b2a", border: "1px solid #3498db", padding: "0.6rem", marginBottom: "1rem", fontSize: 13 }}>
            The wallet below is fully live in your browser (create a key, mint a real biscuit token — no backend).
            Toggle <strong>Demo data</strong> to explore a real 246-node / 650-channel testnet snapshot with no node.
            Live queries against your own node need the CLI or a CORS-enabled node — see the{" "}
            <a href="https://github.com/toastmanAu/fiber-route-doctor" style={{ color: "#3498db" }}>README</a> and{" "}
            <a href="https://github.com/toastmanAu/fiber-route-doctor/blob/master/docs/GAP-ANALYSIS.md" style={{ color: "#3498db" }}>gap analysis</a>.
          </div>
        )}
        <label style={{ display: "block", marginBottom: "1rem" }}>
          <input type="checkbox" checked={demo} onChange={(e) => toggleDemo(e.target.checked)} /> Demo data (real testnet snapshot — no node needed)
        </label>
        <WalletPanel />
        <h1>Fiber Route Doctor</h1>
        {([["node url", url, setUrl], ["source pubkey", source, setSource], ["target pubkey", target, setTarget], ["amount", amount, setAmount], ["asset (blank=CKB)", asset, setAsset]] as const).map(([label, val, set]) => (
          <div key={label} style={{ margin: "0.4rem 0" }}>
            <label>{label}: <input value={val} onChange={(e) => set(e.target.value)} style={{ width: 420 }} /></label>
          </div>
        ))}
        <button onClick={run} disabled={busy}>{busy ? "diagnosing…" : "Diagnose"}</button>
        {report && <RouteGraph view={buildRouteView(report)} />}
        <pre style={{ background: "#111", color: "#0f0", padding: "1rem", marginTop: "1rem", whiteSpace: "pre-wrap" }}>{out}</pre>
        <HealthPanel fetchOverride={demo ? demoFetch : undefined} />
        <LiquidityPanel fetchOverride={demo ? demoFetch : undefined} />
        <NetworkMapPanel routeOutpoints={report?.path.map((h) => h.channelOutpoint) ?? []} fetchOverride={demo ? demoFetch : undefined} />
      </main>
    </WalletProvider>
  );
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npm run typecheck && npx vitest run apps/web && npm run build --workspace @fiber-route-doctor/web`
Expected: typecheck clean; web tests pass; production build succeeds (exercises `import.meta.env.PROD`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): Demo data toggle, banner, and demo-driven Diagnose"
```

---

### Task 6: README live-demo link + full gate

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs + final verification).

- [ ] **Step 1: Add the live-demo link**

In `README.md`, immediately after the gap-analysis link line near the top, add:

```markdown
**🌐 [Live demo](https://toastmanau.github.io/fiber-route-doctor/)** — try the in-browser wallet, and toggle "Demo data" to explore a real 246-node / 650-channel testnet snapshot with no node.
```

- [ ] **Step 2: Full gate**

Run: `npm test && npm run typecheck && npm run build --workspace @fiber-route-doctor/web`
Expected: all tests green (230 + demoFetch tests), typecheck clean, web build succeeds with `/fiber-route-doctor/assets/` in `dist/index.html`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: link the hosted live demo from the README"
```

---

## Verification checklist (post-plan)

- `npm test` green, `npm run typecheck` exit 0, `npm run build --workspace @fiber-route-doctor/web` exit 0 with subpath-prefixed assets.
- After merge to master: the Actions workflow runs green and Pages serves the app; open the URL, toggle Demo data, confirm the Map renders ~246 nodes and Diagnose returns a payable route between the demo hubs; create a wallet and mint a token.
- Fixture is secret-free (Task 2 Step 3 guard) and real (captured, not synthesized).
