# Fiber Network Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive force-directed map of the gossiped Fiber topology — web panel with route overlay + `map` CLI command exporting a self-contained HTML artifact.

**Architecture:** Pure model builder (`buildNetworkMapModel`) + deterministic d3-force layout (`computeLayout`) + shared style constants, all in `packages/core`, consumed identically by the React web panel and the Node CLI HTML exporter. Rendering is hand-rolled SVG on both surfaces.

**Tech Stack:** TypeScript ESM strict, Vitest, npm workspaces, React (web), `d3-force@^3.0.0` (core's first runtime dep — layout math only; v3 uses a deterministic internal LCG).

**Spec:** `docs/superpowers/specs/2026-07-03-fiber-network-map-design.md`

## Global Constraints

- Node >= 22; tests from repo root: `npx vitest run <files>`, `npm run typecheck`.
- Repo style: compact TS, semicolons, double quotes, tests in `<workspace>/test/*.test.ts`.
- Capacity is u128 hex from RPC → bigint math internally → decimal strings in the model (JSON-safe; u128 overflows Number).
- `MapEdge.disabled` = NEITHER direction enabled; a null `update_info_of_nodeN` counts as not-enabled for that direction.
- Hubs = top 10 by totalCapacity (bigint), ties by higher degree, then pubkey ascending; zero-degree nodes never rank.
- Layout MUST be deterministic: phyllotaxis initial positions (golden angle 2.399963229728653), `simulation.stop()` + manual tick loop (default 300), positions clamped to `[24, width-24] × [24, height-24]`.
- Style constants/scales live ONLY in `packages/core/src/network-map-style.ts`: NODE_R 4–20, EDGE_W 1–6 (sqrt scales); colors own #3498db, hub #2ecc71, isolated #e74c3c, node #95a5a6, edge #7f8c8d, disabled edge #e74c3c (dashed), route #f1c40f (+2px).
- Exported HTML is fully self-contained: no `http://`/`https://` substrings, all data embedded; the biscuit token must never appear in it. User-sourced strings (node names) must be HTML-escaped.
- Exit codes: 0 success (empty topology is still success), 2 usage/probe errors.
- Every task: run the task's tests + `npm run typecheck` before committing.

---

### Task 1: d3-force dependency, map types, buildNetworkMapModel

**Files:**
- Modify: `packages/core/package.json` (add dependencies/devDependencies)
- Create: `packages/core/src/network-map-types.ts`
- Create: `packages/core/src/network-map.ts`
- Create: `packages/core/test/network-fixtures.ts` (shared fixtures — NOT a `.test.ts` file, so importing it never re-registers suites)
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/test/network-map.test.ts`

**Interfaces:**
- Consumes: `RpcGraphNode`, `RpcChannelInfo`, `Hex` from `./types.js`.
- Produces: `MapNode`, `MapEdge`, `HubEntry`, `NetworkMapModel`, `LayoutPoint` (network-map-types); `buildNetworkMapModel(graphNodes: RpcGraphNode[], graphChannels: RpcChannelInfo[], ownPubkey?: Hex): NetworkMapModel`.

- [ ] **Step 1: Add the dependency**

In `packages/core/package.json` add:

```json
  "dependencies": { "d3-force": "^3.0.0" },
  "devDependencies": { "@types/d3-force": "^3.0.10" }
```

Run: `npm install` (repo root). Expected: lockfile updates, exit 0.

- [ ] **Step 2: Write the shared fixtures and the failing test**

`packages/core/test/network-fixtures.ts`:

```typescript
import type { RpcChannelInfo, RpcGraphNode } from "../src/index.js";

export function gnode(pubkey: string, name: string | null = null): RpcGraphNode {
  return { pubkey, node_name: name, addresses: [`/ip4/1.1.1.1/tcp/1`], timestamp: "0x1" };
}
export function gchan(over: Partial<RpcChannelInfo> = {}): RpcChannelInfo {
  return {
    channel_outpoint: "0x01", node1: "0xaa", node2: "0xbb", capacity: "0x64",
    funding_udt_type_script: null,
    update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" },
    update_info_of_node2: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" },
    ...over
  };
}
```

`packages/core/test/network-map.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildNetworkMapModel } from "../src/index.js";
import { gnode, gchan } from "./network-fixtures.js";

describe("buildNetworkMapModel", () => {
  it("computes degree, capacity totals, stats, and marks own node", () => {
    const m = buildNetworkMapModel(
      [gnode("0xaa", "alpha"), gnode("0xbb")],
      [gchan(), gchan({ channel_outpoint: "0x02", node2: "0xcc", capacity: "0xc8" })],
      "0xaa"
    );
    const aa = m.nodes.find((n) => n.pubkey === "0xaa")!;
    expect(aa).toMatchObject({ name: "alpha", degree: 2, totalCapacity: "300", isOwn: true, isolated: false });
    expect(m.stats).toEqual({ nodeCount: 3, channelCount: 2, totalCapacity: "300" });
  });
  it("synthesizes nodes seen only as channel endpoints", () => {
    const m = buildNetworkMapModel([], [gchan()]);
    expect(m.nodes.map((n) => n.pubkey).sort()).toEqual(["0xaa", "0xbb"]);
    expect(m.nodes[0].name).toBeNull();
  });
  it("flags isolated nodes (in graph_nodes, zero channels)", () => {
    const m = buildNetworkMapModel([gnode("0xdd", "loner")], []);
    expect(m.nodes[0]).toMatchObject({ isolated: true, degree: 0, totalCapacity: "0" });
  });
  it("marks an edge disabled only when NO direction is enabled (null update info = not enabled)", () => {
    const both = gchan();
    const one = gchan({ channel_outpoint: "0x02", update_info_of_node2: null });
    const none = gchan({ channel_outpoint: "0x03", update_info_of_node1: null, update_info_of_node2: { timestamp: "0x1", enabled: false, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" } });
    const m = buildNetworkMapModel([], [both, one, none]);
    expect(m.edges.map((e) => e.disabled)).toEqual([false, false, true]);
  });
  it("handles u128 capacities exactly", () => {
    const m = buildNetworkMapModel([], [gchan({ capacity: "0xffffffffffffffffff" })]);
    expect(m.edges[0].capacity).toBe("4722366482869645213695");
  });
  it("ranks hubs by capacity, tie-broken by degree then pubkey, max 10, zero-degree excluded", () => {
    const chans = [
      gchan({ channel_outpoint: "0x1", node1: "0x01", node2: "0x02", capacity: "0x64" }), // 01:100, 02:100
      gchan({ channel_outpoint: "0x2", node1: "0x01", node2: "0x03", capacity: "0x64" }), // 01:200(d2), 03:100
      gchan({ channel_outpoint: "0x3", node1: "0x04", node2: "0x05", capacity: "0xc8" })  // 04:200(d1), 05:200(d1)
    ];
    const m = buildNetworkMapModel([gnode("0x09", "idle")], chans);
    expect(m.hubs.map((h) => h.pubkey)).toEqual(["0x01", "0x04", "0x05", "0x02", "0x03"]);
    expect(m.hubs.every((h) => h.degree > 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/core/test/network-map.test.ts`
Expected: FAIL — `buildNetworkMapModel` not exported.

- [ ] **Step 4: Write minimal implementation**

`packages/core/src/network-map-types.ts`:

```typescript
import type { Hex } from "./types.js";

export interface MapNode {
  pubkey: Hex;
  name: string | null;
  degree: number;
  totalCapacity: string; // decimal string, bigint-safe
  isolated: boolean;
  isOwn: boolean;
}
export interface MapEdge {
  outpoint: Hex;
  a: Hex;
  b: Hex;
  capacity: string;
  disabled: boolean; // no enabled direction
}
export interface HubEntry { pubkey: Hex; name: string | null; degree: number; totalCapacity: string; }
export interface NetworkMapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  hubs: HubEntry[];
  stats: { nodeCount: number; channelCount: number; totalCapacity: string };
}
export interface LayoutPoint { x: number; y: number; }
```

`packages/core/src/network-map.ts`:

```typescript
import type { Hex, RpcChannelInfo, RpcGraphNode } from "./types.js";
import type { HubEntry, MapEdge, MapNode, NetworkMapModel } from "./network-map-types.js";

const HUB_COUNT = 10;

function edgeDisabled(c: RpcChannelInfo): boolean {
  const dir1 = c.update_info_of_node1?.enabled ?? false;
  const dir2 = c.update_info_of_node2?.enabled ?? false;
  return !dir1 && !dir2;
}

export function buildNetworkMapModel(graphNodes: RpcGraphNode[], graphChannels: RpcChannelInfo[], ownPubkey?: Hex): NetworkMapModel {
  const names = new Map<string, string | null>();
  for (const n of graphNodes) names.set(n.pubkey, n.node_name ?? null);
  const degree = new Map<string, number>();
  const capacity = new Map<string, bigint>();
  let totalCapacity = 0n;
  const edges: MapEdge[] = graphChannels.map((c) => {
    const cap = BigInt(c.capacity);
    totalCapacity += cap;
    for (const endpoint of [c.node1, c.node2]) {
      degree.set(endpoint, (degree.get(endpoint) ?? 0) + 1);
      capacity.set(endpoint, (capacity.get(endpoint) ?? 0n) + cap);
      if (!names.has(endpoint)) names.set(endpoint, null); // endpoint not gossiped in graph_nodes
    }
    return { outpoint: c.channel_outpoint, a: c.node1, b: c.node2, capacity: cap.toString(), disabled: edgeDisabled(c) };
  });
  const nodes: MapNode[] = [...names.entries()].map(([pubkey, name]) => ({
    pubkey,
    name,
    degree: degree.get(pubkey) ?? 0,
    totalCapacity: (capacity.get(pubkey) ?? 0n).toString(),
    isolated: (degree.get(pubkey) ?? 0) === 0,
    isOwn: pubkey === ownPubkey
  }));
  const hubs: HubEntry[] = nodes
    .filter((n) => n.degree > 0)
    .toSorted((x, y) => {
      const capDiff = BigInt(y.totalCapacity) - BigInt(x.totalCapacity);
      if (capDiff !== 0n) return capDiff > 0n ? 1 : -1;
      if (y.degree !== x.degree) return y.degree - x.degree;
      return x.pubkey < y.pubkey ? -1 : 1;
    })
    .slice(0, HUB_COUNT)
    .map((n) => ({ pubkey: n.pubkey, name: n.name, degree: n.degree, totalCapacity: n.totalCapacity }));
  return { nodes, edges, hubs, stats: { nodeCount: nodes.length, channelCount: edges.length, totalCapacity: totalCapacity.toString() } };
}
```

`packages/core/src/index.ts` — add after the liquidity exports:

```typescript
export * from "./network-map-types.js";
export * from "./network-map.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/network-map.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json package-lock.json packages/core/src/network-map-types.ts packages/core/src/network-map.ts packages/core/src/index.ts packages/core/test/network-fixtures.ts packages/core/test/network-map.test.ts
git commit -m "feat(core): network map model builder with hubs and d3-force dependency"
```

---

### Task 2: Shared style constants and scales

**Files:**
- Create: `packages/core/src/network-map-style.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./network-map-style.js";`)
- Test: `packages/core/test/network-map-style.test.ts`

**Interfaces:**
- Consumes: nothing (pure constants + math).
- Produces: `NODE_R_MIN=4, NODE_R_MAX=20, EDGE_W_MIN=1, EDGE_W_MAX=6, ROUTE_EXTRA_WIDTH=2`; `COLOR_OWN="#3498db", COLOR_HUB="#2ecc71", COLOR_ISOLATED="#e74c3c", COLOR_NODE="#95a5a6", COLOR_EDGE="#7f8c8d", COLOR_EDGE_DISABLED="#e74c3c", COLOR_ROUTE="#f1c40f"`; `nodeRadius(capacity: string, maxCapacity: string): number`; `edgeWidth(capacity: string, maxCapacity: string): number`; `nodeColor(n: { isOwn: boolean; isolated: boolean }, isHub: boolean): string`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/network-map-style.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  nodeRadius, edgeWidth, nodeColor,
  NODE_R_MIN, NODE_R_MAX, EDGE_W_MIN, EDGE_W_MAX,
  COLOR_OWN, COLOR_HUB, COLOR_ISOLATED, COLOR_NODE
} from "../src/index.js";

describe("scales", () => {
  it("maps zero to the minimum and max to the maximum (sqrt scale)", () => {
    expect(nodeRadius("0", "1000")).toBe(NODE_R_MIN);
    expect(nodeRadius("1000", "1000")).toBe(NODE_R_MAX);
    expect(edgeWidth("0", "500")).toBe(EDGE_W_MIN);
    expect(edgeWidth("500", "500")).toBe(EDGE_W_MAX);
  });
  it("is sqrt-shaped: quarter capacity gives half the range", () => {
    const r = nodeRadius("250", "1000");
    expect(r).toBeCloseTo(NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * 0.5, 1);
  });
  it("handles zero max and u128 values without throwing", () => {
    expect(nodeRadius("0", "0")).toBe(NODE_R_MIN);
    expect(nodeRadius("4722366482869645213695", "4722366482869645213695")).toBe(NODE_R_MAX);
  });
});

describe("nodeColor precedence", () => {
  it("own > hub > isolated > default", () => {
    expect(nodeColor({ isOwn: true, isolated: true }, true)).toBe(COLOR_OWN);
    expect(nodeColor({ isOwn: false, isolated: true }, true)).toBe(COLOR_HUB);
    expect(nodeColor({ isOwn: false, isolated: true }, false)).toBe(COLOR_ISOLATED);
    expect(nodeColor({ isOwn: false, isolated: false }, false)).toBe(COLOR_NODE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/network-map-style.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/network-map-style.ts`:

```typescript
export const NODE_R_MIN = 4;
export const NODE_R_MAX = 20;
export const EDGE_W_MIN = 1;
export const EDGE_W_MAX = 6;
export const ROUTE_EXTRA_WIDTH = 2;

export const COLOR_OWN = "#3498db";
export const COLOR_HUB = "#2ecc71";
export const COLOR_ISOLATED = "#e74c3c";
export const COLOR_NODE = "#95a5a6";
export const COLOR_EDGE = "#7f8c8d";
export const COLOR_EDGE_DISABLED = "#e74c3c";
export const COLOR_ROUTE = "#f1c40f";

/** sqrt-scale a bigint-string value in [0, max] onto [outMin, outMax]; max<=0 or value<=0 -> outMin. */
function sqrtScale(value: string, max: string, outMin: number, outMax: number): number {
  const v = BigInt(value), m = BigInt(max);
  if (m <= 0n || v <= 0n) return outMin;
  // ratio via scaled integer division to stay exact for u128 values
  const ratio = Math.sqrt(Number((v * 10_000n) / m) / 10_000);
  return outMin + (outMax - outMin) * Math.min(1, ratio);
}

export function nodeRadius(capacity: string, maxCapacity: string): number {
  return sqrtScale(capacity, maxCapacity, NODE_R_MIN, NODE_R_MAX);
}
export function edgeWidth(capacity: string, maxCapacity: string): number {
  return sqrtScale(capacity, maxCapacity, EDGE_W_MIN, EDGE_W_MAX);
}
export function nodeColor(n: { isOwn: boolean; isolated: boolean }, isHub: boolean): string {
  if (n.isOwn) return COLOR_OWN;
  if (isHub) return COLOR_HUB;
  if (n.isolated) return COLOR_ISOLATED;
  return COLOR_NODE;
}
```

Add to `packages/core/src/index.ts`: `export * from "./network-map-style.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/network-map-style.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/network-map-style.ts packages/core/src/index.ts packages/core/test/network-map-style.test.ts
git commit -m "feat(core): shared network map style constants and sqrt scales"
```

---

### Task 3: Deterministic d3-force layout

**Files:**
- Create: `packages/core/src/network-layout.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./network-layout.js";`)
- Test: `packages/core/test/network-layout.test.ts`

**Interfaces:**
- Consumes: `NetworkMapModel`, `LayoutPoint`, `Hex` (Task 1); `d3-force` (Task 1 dependency).
- Produces: `computeLayout(model: NetworkMapModel, opts: { width: number; height: number; ticks?: number }): Map<Hex, LayoutPoint>` — deterministic, clamped to `[24, width-24] × [24, height-24]`, default 300 ticks.

- [ ] **Step 1: Write the failing test**

`packages/core/test/network-layout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildNetworkMapModel, computeLayout } from "../src/index.js";
import { gnode, gchan } from "./network-fixtures.js";

const MODEL = buildNetworkMapModel(
  [gnode("0xaa", "a"), gnode("0xbb", "b"), gnode("0xcc", "c"), gnode("0xdd", "loner")],
  [
    gchan({ channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb" }),
    gchan({ channel_outpoint: "0x2", node1: "0xbb", node2: "0xcc", capacity: "0x2710" })
  ]
);

describe("computeLayout", () => {
  it("is deterministic: identical inputs give identical positions", () => {
    const p1 = computeLayout(MODEL, { width: 800, height: 600 });
    const p2 = computeLayout(MODEL, { width: 800, height: 600 });
    expect([...p1.entries()]).toEqual([...p2.entries()]);
  });
  it("positions every node, finite and within the clamp bounds", () => {
    const p = computeLayout(MODEL, { width: 800, height: 600, ticks: 50 });
    expect(p.size).toBe(4);
    for (const { x, y } of p.values()) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(24);
      expect(x).toBeLessThanOrEqual(800 - 24);
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y).toBeLessThanOrEqual(600 - 24);
    }
  });
  it("gives distinct nodes distinct positions", () => {
    const p = computeLayout(MODEL, { width: 800, height: 600, ticks: 50 });
    const keys = [...p.values()].map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("returns an empty map for an empty model", () => {
    const empty = buildNetworkMapModel([], []);
    expect(computeLayout(empty, { width: 800, height: 600 }).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/network-layout.test.ts`
Expected: FAIL — `computeLayout` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/network-layout.ts`:

```typescript
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import type { Hex } from "./types.js";
import type { LayoutPoint, NetworkMapModel } from "./network-map-types.js";

const MARGIN = 24;
const DEFAULT_TICKS = 300;
const GOLDEN_ANGLE = 2.399963229728653;
const LINK_DIST_MAX = 100;
const LINK_DIST_MIN = 50;

interface SimNode extends SimulationNodeDatum { id: string; }
interface SimLink { source: string; target: string; }

export function computeLayout(model: NetworkMapModel, opts: { width: number; height: number; ticks?: number }): Map<Hex, LayoutPoint> {
  const { width, height } = opts;
  const ticks = opts.ticks ?? DEFAULT_TICKS;
  // deterministic phyllotaxis initial positions — no randomness anywhere
  const simNodes: SimNode[] = model.nodes.map((n, i) => ({
    id: n.pubkey,
    x: width / 2 + 12 * Math.sqrt(i + 0.5) * Math.cos(i * GOLDEN_ANGLE),
    y: height / 2 + 12 * Math.sqrt(i + 0.5) * Math.sin(i * GOLDEN_ANGLE)
  }));
  const links: SimLink[] = model.edges.map((e) => ({ source: e.a, target: e.b }));
  const maxEdgeCap = model.edges.reduce((m, e) => { const c = BigInt(e.capacity); return c > m ? c : m; }, 0n);
  const linkDistance = (i: number): number => {
    if (maxEdgeCap === 0n) return LINK_DIST_MAX;
    const ratio = Number((BigInt(model.edges[i].capacity) * 100n) / maxEdgeCap) / 100;
    return LINK_DIST_MAX - (LINK_DIST_MAX - LINK_DIST_MIN) * ratio; // higher capacity pulls closer
  };
  const sim = forceSimulation<SimNode>(simNodes)
    .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((_l, i) => linkDistance(i)).strength(0.5))
    .force("charge", forceManyBody<SimNode>().strength(-80))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide<SimNode>(14))
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
  const out = new Map<Hex, LayoutPoint>();
  for (const n of simNodes) {
    out.set(n.id, {
      x: Math.min(width - MARGIN, Math.max(MARGIN, n.x ?? width / 2)),
      y: Math.min(height - MARGIN, Math.max(MARGIN, n.y ?? height / 2))
    });
  }
  return out;
}
```

Add to `packages/core/src/index.ts`: `export * from "./network-layout.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/network-layout.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/network-layout.ts packages/core/src/index.ts packages/core/test/network-layout.test.ts
git commit -m "feat(core): deterministic d3-force network layout"
```

---

### Task 4: Web view-model

**Files:**
- Create: `apps/web/src/network-map-view.ts`
- Test: `apps/web/test/network-map-view.test.ts`

**Interfaces:**
- Consumes: `NetworkMapModel`, `LayoutPoint`, style functions/constants from `@fiber-route-doctor/core`.
- Produces: `ViewNode { pubkey; x; y; r; color; label: string | null; isOwn: boolean }`, `ViewEdge { outpoint; x1; y1; x2; y2; width; color; dashed: boolean; onRoute: boolean }`, `NetworkMapView { nodes: ViewNode[]; edges: ViewEdge[]; empty: boolean }`; `buildNetworkMapView(model: NetworkMapModel, positions: Map<string, LayoutPoint>, routeOutpoints?: string[]): NetworkMapView`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/network-map-view.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildNetworkMapView } from "../src/network-map-view.js";
import { COLOR_OWN, COLOR_ROUTE, COLOR_EDGE_DISABLED, NODE_R_MAX, type NetworkMapModel, type LayoutPoint } from "@fiber-route-doctor/core";

const MODEL: NetworkMapModel = {
  nodes: [
    { pubkey: "0xaa", name: "alpha", degree: 2, totalCapacity: "300", isolated: false, isOwn: true },
    { pubkey: "0xbb", name: null, degree: 1, totalCapacity: "100", isolated: false, isOwn: false }
  ],
  edges: [
    { outpoint: "0x1", a: "0xaa", b: "0xbb", capacity: "100", disabled: false },
    { outpoint: "0x2", a: "0xaa", b: "0xbb", capacity: "200", disabled: true }
  ],
  hubs: [{ pubkey: "0xaa", name: "alpha", degree: 2, totalCapacity: "300" }],
  stats: { nodeCount: 2, channelCount: 2, totalCapacity: "300" }
};
const POS = new Map<string, LayoutPoint>([["0xaa", { x: 100, y: 100 }], ["0xbb", { x: 200, y: 200 }]]);

describe("buildNetworkMapView", () => {
  it("builds node rows with position, scaled radius, precedence color (own beats hub), and label", () => {
    const v = buildNetworkMapView(MODEL, POS);
    expect(v.nodes[0]).toMatchObject({ pubkey: "0xaa", x: 100, y: 100, r: NODE_R_MAX, color: COLOR_OWN, label: "alpha", isOwn: true });
    expect(v.empty).toBe(false);
  });
  it("marks disabled edges dashed/red and route edges gold with extra width", () => {
    const v = buildNetworkMapView(MODEL, POS, ["0x1"]);
    const route = v.edges.find((e) => e.outpoint === "0x1")!;
    const dis = v.edges.find((e) => e.outpoint === "0x2")!;
    expect(route).toMatchObject({ onRoute: true, color: COLOR_ROUTE, dashed: false });
    expect(dis).toMatchObject({ onRoute: false, color: COLOR_EDGE_DISABLED, dashed: true });
    expect(route.width).toBeGreaterThan(0);
  });
  it("skips edges whose endpoints lack positions and flags empty models", () => {
    const v = buildNetworkMapView(MODEL, new Map([["0xaa", { x: 1, y: 1 }]]));
    expect(v.edges).toEqual([]);
    const emptyModel: NetworkMapModel = { nodes: [], edges: [], hubs: [], stats: { nodeCount: 0, channelCount: 0, totalCapacity: "0" } };
    expect(buildNetworkMapView(emptyModel, new Map()).empty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/test/network-map-view.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/network-map-view.ts`:

```typescript
import {
  COLOR_EDGE, COLOR_EDGE_DISABLED, COLOR_ROUTE, ROUTE_EXTRA_WIDTH,
  edgeWidth, nodeColor, nodeRadius,
  type LayoutPoint, type NetworkMapModel
} from "@fiber-route-doctor/core";

export interface ViewNode { pubkey: string; x: number; y: number; r: number; color: string; label: string | null; isOwn: boolean; }
export interface ViewEdge { outpoint: string; x1: number; y1: number; x2: number; y2: number; width: number; color: string; dashed: boolean; onRoute: boolean; }
export interface NetworkMapView { nodes: ViewNode[]; edges: ViewEdge[]; empty: boolean; }

const maxOf = (values: string[]): string =>
  values.reduce((m, v) => (BigInt(v) > BigInt(m) ? v : m), "0");

export function buildNetworkMapView(model: NetworkMapModel, positions: Map<string, LayoutPoint>, routeOutpoints: string[] = []): NetworkMapView {
  const hubs = new Set(model.hubs.map((h) => h.pubkey));
  const route = new Set(routeOutpoints);
  const maxNodeCap = maxOf(model.nodes.map((n) => n.totalCapacity));
  const maxEdgeCap = maxOf(model.edges.map((e) => e.capacity));
  const nodes: ViewNode[] = model.nodes.flatMap((n) => {
    const p = positions.get(n.pubkey);
    if (!p) return [];
    return [{ pubkey: n.pubkey, x: p.x, y: p.y, r: nodeRadius(n.totalCapacity, maxNodeCap), color: nodeColor(n, hubs.has(n.pubkey)), label: n.name, isOwn: n.isOwn }];
  });
  const edges: ViewEdge[] = model.edges.flatMap((e) => {
    const pa = positions.get(e.a), pb = positions.get(e.b);
    if (!pa || !pb) return [];
    const onRoute = route.has(e.outpoint);
    return [{
      outpoint: e.outpoint, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
      width: edgeWidth(e.capacity, maxEdgeCap) + (onRoute ? ROUTE_EXTRA_WIDTH : 0),
      color: onRoute ? COLOR_ROUTE : e.disabled ? COLOR_EDGE_DISABLED : COLOR_EDGE,
      dashed: e.disabled && !onRoute,
      onRoute
    }];
  });
  return { nodes, edges, empty: model.nodes.length === 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/test/network-map-view.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/network-map-view.ts apps/web/test/network-map-view.test.ts
git commit -m "feat(web): network map view-model with route overlay"
```

---

### Task 5: NetworkMapPanel component + App wiring with route overlay

**Files:**
- Create: `apps/web/src/NetworkMapPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: manual (React component; view-model logic already tested in Task 4) — `npm run typecheck` is the gate.

**Interfaces:**
- Consumes: `GraphClient`, `HealthClient`, `buildNetworkMapModel`, `computeLayout` from core; `buildNetworkMapView` (Task 4); `RouteReport` (existing App state).
- Produces: `<NetworkMapPanel routeOutpoints={string[]} />`; App passes `report?.path.map((h) => h.channelOutpoint) ?? []`.

- [ ] **Step 1: Write the component**

`apps/web/src/NetworkMapPanel.tsx`:

```tsx
import React, { useMemo, useRef, useState } from "react";
import { HealthClient, buildNetworkMapModel, computeLayout, type NetworkMapModel, type MapNode } from "@fiber-route-doctor/core";
import { buildNetworkMapView } from "./network-map-view.js";

const W = 900, H = 620;

export function NetworkMapPanel({ routeOutpoints }: { routeOutpoints: string[] }) {
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");
  const [model, setModel] = useState<NetworkMapModel | null>(null);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: W, h: H });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const runId = useRef(0);

  async function load() {
    const id = ++runId.current;
    setBusy(true);
    setError("");
    try {
      const client = new HealthClient({ url, biscuit: token || undefined });
      const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
      const ownPubkey = token ? await client.nodeInfo().then((n) => n.pubkey).catch(() => undefined) : undefined;
      if (id !== runId.current) return;
      setModel(buildNetworkMapModel(nodes, channels, ownPubkey));
      setSelected(null);
      setViewBox({ x: 0, y: 0, w: W, h: H });
    } catch (e) {
      if (id !== runId.current) return;
      setModel(null);
      setError(String(e));
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }

  const positions = useMemo(() => (model ? computeLayout(model, { width: W, height: H }) : null), [model]);
  const view = useMemo(() => (model && positions ? buildNetworkMapView(model, positions, routeOutpoints) : null), [model, positions, routeOutpoints]);

  function onWheel(e: React.WheelEvent) {
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    setViewBox((v) => {
      const w = Math.min(W * 5, Math.max(W / 5, v.w * factor));
      const h = (w / W) * H;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });
  }
  function onPointerDown(e: React.PointerEvent) { drag.current = { x: e.clientX, y: e.clientY }; }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const scale = viewBox.w / W;
    setViewBox((v) => ({ ...v, x: v.x - (e.clientX - drag.current!.x) * scale, y: v.y - (e.clientY - drag.current!.y) * scale }));
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp() { drag.current = null; }

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Network Map</h2>
      <div style={{ margin: "0.4rem 0" }}>
        <label>node url: <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <div style={{ margin: "0.4rem 0" }}>
        <label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <button onClick={load} disabled={busy}>{busy ? "loading…" : "Load map"}</button>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {model && view?.empty && <p style={{ color: "#888" }}>no gossiped topology — node may be isolated</p>}
      {model && view && !view.empty && (
        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
          <svg
            width={W} height={H} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            style={{ background: "#111", border: "1px solid #444", cursor: "grab", touchAction: "none" }}
            onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
          >
            {view.edges.map((e) => (
              <line key={e.outpoint} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                stroke={e.color} strokeWidth={e.width} strokeDasharray={e.dashed ? "4 3" : undefined} opacity={0.8} />
            ))}
            {view.nodes.map((n) => (
              <g key={n.pubkey} onClick={() => setSelected(model.nodes.find((m) => m.pubkey === n.pubkey) ?? null)} style={{ cursor: "pointer" }}>
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} stroke="#fff" strokeWidth={n.isOwn ? 2 : 0.5} />
                {n.label && <text x={n.x} y={n.y - n.r - 4} textAnchor="middle" fontSize="10" fill="#ccc">{n.label}</text>}
              </g>
            ))}
          </svg>
          <div style={{ minWidth: 260 }}>
            <div style={{ color: "#888" }}>{model.stats.nodeCount} nodes · {model.stats.channelCount} channels</div>
            {selected && (
              <div style={{ border: "1px solid #444", padding: "0.6rem", margin: "0.6rem 0" }}>
                <strong>{selected.name ?? "(unnamed)"}</strong>
                <div style={{ fontSize: 12, wordBreak: "break-all" }}>{selected.pubkey}</div>
                <div>{selected.degree} channel(s) · capacity {selected.totalCapacity}</div>
              </div>
            )}
            <h3 style={{ marginBottom: "0.3rem" }}>Top hubs</h3>
            <ol style={{ paddingLeft: "1.2rem", margin: 0 }}>
              {model.hubs.map((h) => (
                <li key={h.pubkey} style={{ fontSize: 13 }}>{h.name ?? `${h.pubkey.slice(0, 10)}…`} — {h.degree} ch, cap {h.totalCapacity}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire into App**

`apps/web/src/App.tsx`: add the import and render after `<LiquidityPanel />`:

```tsx
import { NetworkMapPanel } from "./NetworkMapPanel.js";
// ... inside <main>, after <LiquidityPanel />:
      <NetworkMapPanel routeOutpoints={report?.path.map((h) => h.channelOutpoint) ?? []} />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run apps/web`
Expected: typecheck clean; existing web tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/NetworkMapPanel.tsx apps/web/src/App.tsx
git commit -m "feat(web): interactive network map panel with pan/zoom and route overlay"
```

---

### Task 6: CLI map args and dispatch

**Files:**
- Create: `apps/cli/src/commands/map.ts` (args only)
- Modify: `apps/cli/src/dispatch.ts`
- Test: `apps/cli/test/map-args.test.ts`, `apps/cli/test/dispatch.test.ts` (append one case)

**Interfaces:**
- Consumes: flag-loop pattern from `apps/cli/src/commands/liquidity.ts`.
- Produces: `MapArgs { url: string; biscuit?: string; profile?: string; authTokenFile?: string; out: string; json: boolean; width: number; height: number }`; `parseMapArgs(rest: string[]): MapArgs` — `--url` required; `--out` default `"fiber-map.html"`; `--width`/`--height` default 1200/800, validated integers 200..8000; dispatch accepts `"map"`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/map-args.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMapArgs } from "../src/commands/map.js";

describe("parseMapArgs", () => {
  it("parses url, token flags, out, dimensions, json", () => {
    const a = parseMapArgs(["--url", "http://n:8231", "--profile", "dt", "--out", "x.html", "--width", "1600", "--height", "900", "--json"]);
    expect(a).toMatchObject({ url: "http://n:8231", profile: "dt", out: "x.html", width: 1600, height: 900, json: true });
  });
  it("defaults out/width/height and booleans", () => {
    expect(parseMapArgs(["--url", "u"])).toMatchObject({ out: "fiber-map.html", width: 1200, height: 800, json: false });
  });
  it("requires --url and validates dimensions", () => {
    expect(() => parseMapArgs([])).toThrow(/--url/);
    expect(() => parseMapArgs(["--url", "u", "--width", "50"])).toThrow(/width/);
    expect(() => parseMapArgs(["--url", "u", "--height", "1.5"])).toThrow(/height/);
    expect(() => parseMapArgs(["--url", "u", "--width", "9000"])).toThrow(/width/);
  });
});
```

Append to `apps/cli/test/dispatch.test.ts` (inside the existing describe):

```typescript
  it("routes the map command", () => {
    expect(parseCommand(["map", "--url", "u"])).toEqual({ command: "map", rest: ["--url", "u"] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/cli/test/map-args.test.ts apps/cli/test/dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`apps/cli/src/dispatch.ts` — extend:

```typescript
export type Command = "diagnose" | "keys" | "token" | "health" | "liquidity" | "map";
const COMMANDS: Command[] = ["diagnose", "keys", "token", "health", "liquidity", "map"];
```

`apps/cli/src/commands/map.ts`:

```typescript
export interface MapArgs {
  url: string; biscuit?: string; profile?: string; authTokenFile?: string;
  out: string; json: boolean; width: number; height: number;
}

const DIM_MIN = 200, DIM_MAX = 8000;

function parseDim(name: "width" | "height", raw: string | undefined, fallback: number): number {
  const v = Number(raw ?? String(fallback));
  if (!Number.isInteger(v) || v < DIM_MIN || v > DIM_MAX) throw new Error(`--${name} must be an integer between ${DIM_MIN} and ${DIM_MAX}`);
  return v;
}

export function parseMapArgs(rest: string[]): MapArgs {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) { bools.add(key); } else { flags.set(key, next); i++; }
  }
  const url = flags.get("url");
  if (!url) throw new Error("missing required flag --url");
  return {
    url, biscuit: flags.get("biscuit"), profile: flags.get("profile"), authTokenFile: flags.get("auth-token-file"),
    out: flags.get("out") ?? "fiber-map.html",
    json: bools.has("json"),
    width: parseDim("width", flags.get("width"), 1200),
    height: parseDim("height", flags.get("height"), 800)
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/map-args.test.ts apps/cli/test/dispatch.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/map.ts apps/cli/src/dispatch.ts apps/cli/test/map-args.test.ts apps/cli/test/dispatch.test.ts
git commit -m "feat(cli): map command args parsing and dispatch"
```

---

### Task 7: Self-contained HTML renderer

**Files:**
- Create: `apps/cli/src/map-html.ts`
- Test: `apps/cli/test/map-html.test.ts`

**Interfaces:**
- Consumes: `NetworkMapModel`, `LayoutPoint`, style constants/functions from `@fiber-route-doctor/core`.
- Produces: `renderMapHtml(model: NetworkMapModel, positions: Map<string, LayoutPoint>, opts: { width: number; height: number }): string` — self-contained HTML; `escapeHtml(s: string): string` (exported for tests).

- [ ] **Step 1: Write the failing test**

`apps/cli/test/map-html.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderMapHtml, escapeHtml } from "../src/map-html.js";
import type { NetworkMapModel, LayoutPoint } from "@fiber-route-doctor/core";

const MODEL: NetworkMapModel = {
  nodes: [
    { pubkey: "0xaa", name: "alpha <script>", degree: 1, totalCapacity: "100", isolated: false, isOwn: true },
    { pubkey: "0xbb", name: null, degree: 1, totalCapacity: "100", isolated: false, isOwn: false }
  ],
  edges: [{ outpoint: "0x1", a: "0xaa", b: "0xbb", capacity: "100", disabled: false }],
  hubs: [{ pubkey: "0xaa", name: "alpha <script>", degree: 1, totalCapacity: "100" }],
  stats: { nodeCount: 2, channelCount: 1, totalCapacity: "100" }
};
const POS = new Map<string, LayoutPoint>([["0xaa", { x: 100, y: 100 }], ["0xbb", { x: 300, y: 300 }]]);

describe("escapeHtml", () => {
  it("escapes angle brackets, ampersands, and quotes", () => {
    expect(escapeHtml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
  });
});

describe("renderMapHtml", () => {
  const html = renderMapHtml(MODEL, POS, { width: 1200, height: 800 });
  it("is a self-contained document with inline svg and embedded model data", () => {
    expect(html).toContain("<svg");
    expect(html).toContain('type="application/json"');
    expect(html).toContain("2 nodes");
    expect(html).toContain("1 channels");
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("escapes node names everywhere they appear", () => {
    expect(html).not.toContain("alpha <script>");
    expect(html).toContain("alpha &lt;script&gt;");
  });
  it("renders an honest empty-state document for an empty model", () => {
    const empty: NetworkMapModel = { nodes: [], edges: [], hubs: [], stats: { nodeCount: 0, channelCount: 0, totalCapacity: "0" } };
    const out = renderMapHtml(empty, new Map(), { width: 800, height: 600 });
    expect(out).toContain("no gossiped topology");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/test/map-html.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Write minimal implementation**

`apps/cli/src/map-html.ts`:

```typescript
import {
  COLOR_EDGE, COLOR_EDGE_DISABLED,
  edgeWidth, nodeColor, nodeRadius,
  type LayoutPoint, type NetworkMapModel
} from "@fiber-route-doctor/core";

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const maxOf = (values: string[]): string => values.reduce((m, v) => (BigInt(v) > BigInt(m) ? v : m), "0");

export function renderMapHtml(model: NetworkMapModel, positions: Map<string, LayoutPoint>, opts: { width: number; height: number }): string {
  const { width, height } = opts;
  if (model.nodes.length === 0) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Fiber Network Map</title></head><body style="font-family:monospace;background:#111;color:#ccc"><p>no gossiped topology — node may be isolated</p></body></html>`;
  }
  const hubs = new Set(model.hubs.map((h) => h.pubkey));
  const maxNodeCap = maxOf(model.nodes.map((n) => n.totalCapacity));
  const maxEdgeCap = maxOf(model.edges.map((e) => e.capacity));

  const edgeSvg = model.edges.map((e) => {
    const pa = positions.get(e.a), pb = positions.get(e.b);
    if (!pa || !pb) return "";
    const w = edgeWidth(e.capacity, maxEdgeCap);
    const color = e.disabled ? COLOR_EDGE_DISABLED : COLOR_EDGE;
    const dash = e.disabled ? ' stroke-dasharray="4 3"' : "";
    return `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="${color}" stroke-width="${w.toFixed(1)}"${dash} opacity="0.8"/>`;
  }).join("\n");

  const nodeSvg = model.nodes.map((n) => {
    const p = positions.get(n.pubkey);
    if (!p) return "";
    const r = nodeRadius(n.totalCapacity, maxNodeCap);
    const color = nodeColor(n, hubs.has(n.pubkey));
    const label = n.name ? `<text x="${p.x.toFixed(1)}" y="${(p.y - r - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#ccc">${escapeHtml(n.name)}</text>` : "";
    return `<g class="node" data-pubkey="${escapeHtml(n.pubkey)}" style="cursor:pointer"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" stroke="#fff" stroke-width="${n.isOwn ? 2 : 0.5}"/>${label}</g>`;
  }).join("\n");

  const hubList = model.hubs.map((h) =>
    `<li>${h.name ? escapeHtml(h.name) : `${escapeHtml(h.pubkey.slice(0, 10))}…`} — ${h.degree} ch, cap ${h.totalCapacity}</li>`
  ).join("\n");

  const payload = JSON.stringify({ nodes: model.nodes }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fiber Network Map</title>
<style>body{font-family:monospace;background:#111;color:#ccc;margin:1rem}#detail{border:1px solid #444;padding:.6rem;min-height:3rem;max-width:${width}px;word-break:break-all}</style>
</head><body>
<h1>Fiber Network Map</h1>
<p>${model.stats.nodeCount} nodes · ${model.stats.channelCount} channels · total capacity ${model.stats.totalCapacity}</p>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#181818;border:1px solid #444">
${edgeSvg}
${nodeSvg}
</svg>
<div id="detail">click a node for details</div>
<h2>Top hubs</h2>
<ol>${hubList}</ol>
<script type="application/json" id="map-data">${payload}</script>
<script>
const data = JSON.parse(document.getElementById("map-data").textContent);
const byKey = new Map(data.nodes.map(n => [n.pubkey, n]));
const detail = document.getElementById("detail");
for (const g of document.querySelectorAll("g.node")) {
  g.addEventListener("click", () => {
    const n = byKey.get(g.dataset.pubkey);
    if (!n) return;
    detail.textContent = (n.name || "(unnamed)") + " · " + n.pubkey + " · " + n.degree + " channel(s) · capacity " + n.totalCapacity;
  });
}
</script>
</body></html>`;
}
```

Route overlay is web-only per spec; the exporter imports only the constants it renders with.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/map-html.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/map-html.ts apps/cli/test/map-html.test.ts
git commit -m "feat(cli): self-contained network map HTML renderer"
```

---

### Task 8: runMap wired into main

**Files:**
- Modify: `apps/cli/src/commands/map.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/map-run.test.ts`

**Interfaces:**
- Consumes: `parseMapArgs` (Task 6), `renderMapHtml` (Task 7); `HealthClient`, `buildNetworkMapModel`, `computeLayout`, `RpcChannelInfo`, `RpcGraphNode` from core; `resolveToken`/`NodeFsTokenStore` from biscuit (same wiring as liquidity).
- Produces: `runMap(rest: string[], deps?: MapDeps): Promise<number>` where `MapDeps = { fetchGraph?: (args: MapArgs) => Promise<{ nodes: RpcGraphNode[]; channels: RpcChannelInfo[]; ownPubkey?: string }>; writeFile?: (path: string, content: string) => void; print?: (s: string) => void }`. Behavior: parse errors print + return 2; `--json` prints the model; otherwise renders HTML, writes to `args.out`, prints `wrote <out> (<n> nodes, <c> channels)`; returns 0. main.ts wires `if (command === "map") process.exit(await runMap(rest));`.

- [ ] **Step 1: Write the failing test**

`apps/cli/test/map-run.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runMap } from "../src/commands/map.js";
import type { RpcChannelInfo, RpcGraphNode } from "@fiber-route-doctor/core";

const NODES: RpcGraphNode[] = [{ pubkey: "0xaa", node_name: "alpha", addresses: [], timestamp: "0x1" }];
const CHANNELS: RpcChannelInfo[] = [{
  channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb", capacity: "0x64", funding_udt_type_script: null,
  update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" },
  update_info_of_node2: null
}];

function deps() {
  return {
    fetchGraph: vi.fn(async () => ({ nodes: NODES, channels: CHANNELS, ownPubkey: "0xaa" })),
    writeFile: vi.fn(),
    print: vi.fn()
  };
}

describe("runMap", () => {
  it("writes a self-contained HTML file and announces it", async () => {
    const d = deps();
    expect(await runMap(["--url", "http://n/"], d)).toBe(0);
    const [path, content] = d.writeFile.mock.calls[0];
    expect(path).toBe("fiber-map.html");
    expect(String(content)).toContain("<svg");
    expect(String(content)).not.toMatch(/https?:\/\//);
    expect(String(d.print.mock.calls[0][0])).toContain("wrote fiber-map.html (2 nodes, 1 channels)");
  });
  it("--json prints the model and writes nothing", async () => {
    const d = deps();
    await runMap(["--url", "http://n/", "--json"], d);
    expect(d.writeFile).not.toHaveBeenCalled();
    const body = JSON.parse(String(d.print.mock.calls[0][0]));
    expect(body.stats).toEqual({ nodeCount: 2, channelCount: 1, totalCapacity: "100" });
    expect(body.nodes.find((n: { pubkey: string }) => n.pubkey === "0xaa").isOwn).toBe(true);
  });
  it("returns 2 and prints usage error on bad args", async () => {
    const d = deps();
    expect(await runMap([], d)).toBe(2);
    expect(String(d.print.mock.calls[0][0])).toContain("--url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/test/map-run.test.ts`
Expected: FAIL — `runMap` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/cli/src/commands/map.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HealthClient, buildNetworkMapModel, computeLayout,
  type RpcChannelInfo, type RpcGraphNode
} from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";
import { renderMapHtml } from "../map-html.js";

const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");

async function defaultFetchGraph(args: MapArgs): Promise<{ nodes: RpcGraphNode[]; channels: RpcChannelInfo[]; ownPubkey?: string }> {
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  const client = new HealthClient({ url: args.url, biscuit: token });
  const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
  const ownPubkey = token ? await client.nodeInfo().then((n) => n.pubkey).catch(() => undefined) : undefined;
  return { nodes, channels, ownPubkey };
}

export interface MapDeps {
  fetchGraph?: (args: MapArgs) => Promise<{ nodes: RpcGraphNode[]; channels: RpcChannelInfo[]; ownPubkey?: string }>;
  writeFile?: (path: string, content: string) => void;
  print?: (s: string) => void;
}

export async function runMap(rest: string[], deps: MapDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  let args: MapArgs;
  try {
    args = parseMapArgs(rest);
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const fetchGraph = deps.fetchGraph ?? defaultFetchGraph;
  const writeFile = deps.writeFile ?? ((p: string, c: string) => writeFileSync(p, c));
  const { nodes, channels, ownPubkey } = await fetchGraph(args);
  const model = buildNetworkMapModel(nodes, channels, ownPubkey);
  if (args.json) {
    print(JSON.stringify(model, null, 2));
    return 0;
  }
  const positions = computeLayout(model, { width: args.width, height: args.height });
  writeFile(args.out, renderMapHtml(model, positions, { width: args.width, height: args.height }));
  print(`wrote ${args.out} (${model.stats.nodeCount} nodes, ${model.stats.channelCount} channels)`);
  return 0;
}
```

`apps/cli/src/main.ts` — add the import and dispatch line next to liquidity:

```typescript
import { runMap } from "./commands/map.js";
// ... inside main():
  if (command === "map") process.exit(await runMap(rest));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/map-run.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/map.ts apps/cli/src/main.ts apps/cli/test/map-run.test.ts
git commit -m "feat(cli): map command rendering self-contained HTML export"
```

---

### Task 9: Gated live smoke and README

**Files:**
- Create: `scripts/map-live-smoke.mjs`
- Modify: `package.json` (add `smoke:map`)
- Modify: `README.md` (add `## Fiber Network Map` section after Channel Liquidity Snapshot)

**Interfaces:**
- Consumes: env-gated pattern from `scripts/liquidity-live-smoke.mjs`; core map functions; biscuit mint trio.
- Produces: `npm run smoke:map` — SKIP exit 0 without env; live run builds model from the gossiped graph, computes layout, writes HTML to a temp path, asserts non-trivial output.

- [ ] **Step 1: Write the smoke script**

`scripts/map-live-smoke.mjs`:

```javascript
// Build a network map from a live Fiber node's gossiped topology.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/map-live-smoke.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient, buildNetworkMapModel, computeLayout } from "../packages/core/src/index.ts";
import { renderMapHtml } from "../apps/cli/src/map-html.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP map-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const client = new HealthClient({ url, biscuit: token });
const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
const ownPubkey = await client.nodeInfo().then((n) => n.pubkey).catch(() => undefined);
const model = buildNetworkMapModel(nodes, channels, ownPubkey);
const positions = computeLayout(model, { width: 1200, height: 800 });
const html = renderMapHtml(model, positions, { width: 1200, height: 800 });
const out = join(tmpdir(), `fiber-map-smoke-${Date.now()}.html`);
writeFileSync(out, html);
if (html.length < 500) { console.error("FAIL: suspiciously small HTML output"); process.exit(1); }
console.log(`OK: ${model.stats.nodeCount} nodes, ${model.stats.channelCount} channels, own=${ownPubkey ? "marked" : "unknown"} — wrote ${out} (${html.length} bytes)`);
```

`package.json` — add to scripts:

```json
    "smoke:map": "node --import tsx scripts/map-live-smoke.mjs"
```

- [ ] **Step 2: Verify the gated skip path**

Run: `npm run smoke:map`
Expected: `SKIP map-live-smoke: ...`, exit 0.

- [ ] **Step 3: Update README**

Add after the Channel Liquidity Snapshot section:

```markdown
## Fiber Network Map

The gossiped network topology as an interactive force-directed map — nodes sized by
capacity, disabled channels dashed red, hubs ranked, your node highlighted.

```bash
# export a self-contained HTML map (no external assets — host or share the file)
fiber-route-doctor map --profile driveThree --url http://127.0.0.1:8231 --out fiber-map.html

# dump the raw model instead
fiber-route-doctor map --profile driveThree --url http://127.0.0.1:8231 --json
```

The web app's Network Map panel is interactive (pan/zoom, click for node details) and
overlays the most recent Diagnose route in gold — run a diagnosis, watch the path light
up on the topology. Layout is deterministic (same graph → same map).

Live validation: `FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:map`
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/map-live-smoke.mjs package.json README.md
git commit -m "feat: gated map live-smoke and README docs"
```

---

## Verification checklist (post-plan)

- `npm test` green (177 existing + new), `npm run typecheck` exit 0.
- `npm run smoke:map` SKIPs cleanly; live run against driveThree (500 gossiped channels) writes a temp HTML — manual run by Phill or with approval; open the HTML in a browser to eyeball the layout.
- Web: `npm run dev` in apps/web — load map, click nodes, run a Diagnose and confirm the route overlays in gold.
