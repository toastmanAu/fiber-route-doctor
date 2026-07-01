# Fiber Route Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a routing-diagnostics tool for Fiber that, given a source node, target node, amount and asset, reports whether a payment would succeed, via which path, and — when it would not — the ranked concrete reasons and fixes.

**Architecture:** A TypeScript monorepo with a UI-free core engine (`packages/core`) that ingests the Fiber gossip graph (`graph_nodes` + `graph_channels`), builds an immutable directed multigraph, self-computes a constrained best path, and produces a structured `RouteReport`. `build_router` is used only as an optional "the node's own router agrees" cross-check. Two thin apps consume the core: a CLI (`apps/cli`) and a hosted web demo (`apps/web`).

**Tech Stack:** TypeScript (Node ≥22), Vitest for tests, tsx for the CLI, Vite + React for the web app. No blockchain SDK needed for the MVP — plain JSON-RPC over `fetch`.

## Global Constraints

- Node.js ≥ 22, npm ≥ 11 (matches the sibling `fiber-wallet` project).
- Target Fiber node RPC is **v0.9.x**: identities are `pubkey` (hex compressed secp256k1), NOT `peer_id`; enums and fields are snake_case; amounts/rates are `0x`-prefixed hex strings (`u64`/`u128`).
- All monetary/rate values crossing the RPC boundary are hex strings; convert to `bigint` at the edge and use `bigint` everywhere internally.
- License: MIT.
- The `diagnose()` function and everything it calls MUST be pure and synchronous (no network, no `Date.now()` in logic paths that affect output). All network access lives in `GraphClient` / `RouteProbe`.
- Immutability: model and report objects are treated as read-only; never mutate inputs.
- Package/workspace names: `@fiber-route-doctor/core`, `@fiber-route-doctor/cli`, `@fiber-route-doctor/web`.
- **Type-check gate:** Vitest uses esbuild (strips types, does NOT type-check). Every task's verification MUST run `npm run typecheck` (tsc --noEmit) in addition to `npm test`; both must pass before commit.

---

### Task 1: Monorepo scaffold + test tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace layout; `@fiber-route-doctor/core` resolves; `npm test` runs Vitest.

- [ ] **Step 1: Write the failing test**

`packages/core/test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index.js";

describe("core package", () => {
  it("exposes a version constant", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Create the workspace files**

Root `package.json`:
```json
{
  "name": "fiber-route-doctor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22", "npm": ">=11" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p packages/core/tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    coverage: { provider: "v8", include: ["packages/core/src/**"] }
  }
});
```

`packages/core/package.json`:
```json
{
  "name": "@fiber-route-doctor/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "license": "MIT"
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/core/src/index.ts`:
```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 3: Install and run the test to verify it passes**

Run: `npm install && npm test`
Expected: 1 passing test (`core package > exposes a version constant`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with core package and vitest"
```

---

### Task 2: Core types

**Files:**
- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: all shared types — `Hex`, `AssetId`, `UdtScript`, raw RPC shapes (`RpcGraphNode`, `RpcChannelInfo`, `RpcChannelUpdateInfo`), normalized model shapes (`DirectedEdge`, `GraphNodeInfo`), and probe/report shapes (`ProbeRequest`, `Verdict`, `ReasonCause`, `Reason`, `Fix`, `ReportHop`, `RouteReport`, `ProbeResult`).

- [ ] **Step 1: Write the failing test**

`packages/core/test/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CKB_ASSET, type ProbeRequest } from "../src/index.js";

describe("core types", () => {
  it("exports the native asset sentinel and accepts a ProbeRequest literal", () => {
    const probe: ProbeRequest = {
      source: "0xaa",
      target: "0xbb",
      amount: 1000n,
      asset: CKB_ASSET
    };
    expect(CKB_ASSET).toBe("CKB");
    expect(probe.amount).toBe(1000n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types`
Expected: FAIL — `CKB_ASSET` / `ProbeRequest` not exported.

- [ ] **Step 3: Write `types.ts`**

`packages/core/src/types.ts`:
```ts
export type Hex = string; // 0x-prefixed

/** "CKB" = native asset; otherwise a stable hex key derived from the UDT type script. */
export type AssetId = "CKB" | Hex;
export const CKB_ASSET: AssetId = "CKB";

export interface UdtScript { code_hash: Hex; hash_type: string; args: Hex; }

// ---- Raw RPC shapes (Fiber v0.9, snake_case) ----
export interface RpcChannelUpdateInfo {
  timestamp: Hex;
  enabled: boolean;
  fee_rate: Hex;           // u64 hex
  tlc_expiry_delta: Hex;   // u64 hex, milliseconds
  tlc_minimum_value: Hex;  // u128 hex
  tlc_maximum_value?: Hex; // u128 hex, optional
}
export interface RpcChannelInfo {
  channel_outpoint: Hex;
  node1: Hex;
  node2: Hex;
  capacity: Hex;                       // u128 hex
  funding_udt_type_script: UdtScript | null;
  update_info_of_node1: RpcChannelUpdateInfo | null; // node1 -> node2
  update_info_of_node2: RpcChannelUpdateInfo | null; // node2 -> node1
}
export interface RpcGraphNode {
  pubkey: Hex;
  node_name?: string | null;
  addresses: string[];
  timestamp: Hex;
}

// ---- Normalized model ----
export interface DirectedEdge {
  channelOutpoint: Hex;
  from: Hex;
  to: Hex;
  asset: AssetId;
  capacity: bigint;
  enabled: boolean;
  feeRate: bigint;         // per the channel's advertised forwarding fee rate
  tlcExpiryDelta: bigint;  // milliseconds
  tlcMinimumValue: bigint;
  tlcMaximumValue: bigint | null;
}
export interface GraphNodeInfo { pubkey: Hex; name: string | null; addresses: string[]; }

// ---- Probe & report ----
export interface ProbeRequest {
  source: Hex;
  target: Hex;
  amount: bigint;
  asset: AssetId;
  maxFeeRate?: bigint;      // per-thousand ceiling, default 5 (0.5%)
  maxTotalExpiry?: bigint;  // ms ceiling, optional
}

export type Verdict = "payable" | "risky" | "blocked";

export type ReasonCause =
  | "target_absent"
  | "no_asset_channel"
  | "asset_mismatch"
  | "channel_disabled"
  | "below_min_value"
  | "above_max_value"
  | "insufficient_capacity"
  | "expiry_over_limit"
  | "fee_over_limit"
  | "router_declined";

export interface Reason {
  cause: ReasonCause;
  channelOutpoint?: Hex;
  detail: string;
}
export interface Fix { detail: string; }

export interface ReportHop {
  index: number;
  from: Hex;
  to: Hex;
  channelOutpoint: Hex;
  asset: AssetId;
  fee: bigint;
  expiryDelta: bigint;
}

export interface RouteReport {
  verdict: Verdict;
  probe: ProbeRequest;
  path: ReportHop[];
  totalFee: bigint;
  totalExpiry: bigint;
  reasons: Reason[];
  fixes: Fix[];
  routerConfirmed: boolean;
}

/** Result of the optional build_router cross-check. */
export type ProbeResult =
  | { kind: "router_path"; channelOutpoints: Hex[] }
  | { kind: "router_error"; message: string }
  | { kind: "skipped" };
```

- [ ] **Step 4: Re-export from index**

`packages/core/src/index.ts`:
```ts
export const VERSION = "0.1.0";
export * from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add shared RPC, model, probe, and report types"
```

---

### Task 3: GraphModel (build immutable multigraph + queries)

**Files:**
- Create: `packages/core/src/graph-model.ts`
- Create: `packages/core/src/asset.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/graph-model.test.ts`

**Interfaces:**
- Consumes: `RpcGraphNode`, `RpcChannelInfo`, `DirectedEdge`, `GraphNodeInfo`, `AssetId` (Task 2).
- Produces:
  - `assetIdOf(script: UdtScript | null): AssetId`
  - `class GraphModel` with static `fromRpc(nodes: RpcGraphNode[], channels: RpcChannelInfo[]): GraphModel` and instance methods `hasNode(pubkey: Hex): boolean`, `node(pubkey: Hex): GraphNodeInfo | undefined`, `edgesFrom(pubkey: Hex): DirectedEdge[]`, `edgesTo(pubkey: Hex): DirectedEdge[]`, `allEdges(): DirectedEdge[]`, `assetsOf(pubkey: Hex): Set<AssetId>`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/graph-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { GraphModel, assetIdOf, type RpcChannelInfo, type RpcGraphNode } from "../src/index.js";

const nodes: RpcGraphNode[] = [
  { pubkey: "0xA", addresses: [], timestamp: "0x1" },
  { pubkey: "0xB", addresses: [], timestamp: "0x1" }
];
const channels: RpcChannelInfo[] = [
  {
    channel_outpoint: "0xchan1",
    node1: "0xA",
    node2: "0xB",
    capacity: "0x64", // 100
    funding_udt_type_script: null,
    update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0xa", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" },
    update_info_of_node2: { timestamp: "0x1", enabled: false, fee_rate: "0x14", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" }
  }
];

describe("assetIdOf", () => {
  it("maps null funding script to native CKB", () => {
    expect(assetIdOf(null)).toBe("CKB");
  });
  it("derives a stable hex key for a UDT script", () => {
    const a = assetIdOf({ code_hash: "0x11", hash_type: "type", args: "0x22" });
    const b = assetIdOf({ code_hash: "0x11", hash_type: "type", args: "0x22" });
    expect(a).toBe(b);
    expect(a).not.toBe("CKB");
  });
});

describe("GraphModel.fromRpc", () => {
  it("expands each channel into up to two directed edges by update info", () => {
    const m = GraphModel.fromRpc(nodes, channels);
    const outA = m.edgesFrom("0xA");
    expect(outA).toHaveLength(1);
    expect(outA[0]).toMatchObject({ from: "0xA", to: "0xB", enabled: true, feeRate: 10n, capacity: 100n, asset: "CKB" });
    const outB = m.edgesFrom("0xB");
    expect(outB[0]).toMatchObject({ from: "0xB", to: "0xA", enabled: false, feeRate: 20n });
  });
  it("answers node and reachability queries", () => {
    const m = GraphModel.fromRpc(nodes, channels);
    expect(m.hasNode("0xA")).toBe(true);
    expect(m.hasNode("0xZ")).toBe(false);
    expect(m.edgesTo("0xB")).toHaveLength(1);
    expect(m.allEdges()).toHaveLength(2);
    expect([...m.assetsOf("0xA")]).toEqual(["CKB"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- graph-model`
Expected: FAIL — `GraphModel` / `assetIdOf` not exported.

- [ ] **Step 3: Write `asset.ts`**

`packages/core/src/asset.ts`:
```ts
import type { AssetId, UdtScript } from "./types.js";

/** Stable, order-independent key for an asset. null => native CKB. */
export function assetIdOf(script: UdtScript | null): AssetId {
  if (script === null) return "CKB";
  return `udt:${script.code_hash}:${script.hash_type}:${script.args}`;
}
```

- [ ] **Step 4: Write `graph-model.ts`**

`packages/core/src/graph-model.ts`:
```ts
import { assetIdOf } from "./asset.js";
import type { AssetId, DirectedEdge, GraphNodeInfo, Hex, RpcChannelInfo, RpcChannelUpdateInfo, RpcGraphNode } from "./types.js";

function bi(hex: Hex): bigint { return BigInt(hex); }

function makeEdge(
  outpoint: Hex, from: Hex, to: Hex, asset: AssetId, capacity: bigint, u: RpcChannelUpdateInfo
): DirectedEdge {
  return {
    channelOutpoint: outpoint,
    from, to, asset, capacity,
    enabled: u.enabled,
    feeRate: bi(u.fee_rate),
    tlcExpiryDelta: bi(u.tlc_expiry_delta),
    tlcMinimumValue: bi(u.tlc_minimum_value),
    tlcMaximumValue: u.tlc_maximum_value === undefined ? null : bi(u.tlc_maximum_value)
  };
}

export class GraphModel {
  private constructor(
    private readonly nodes: Map<Hex, GraphNodeInfo>,
    private readonly outgoing: Map<Hex, DirectedEdge[]>,
    private readonly incoming: Map<Hex, DirectedEdge[]>,
    private readonly edges: DirectedEdge[]
  ) {}

  static fromRpc(nodes: RpcGraphNode[], channels: RpcChannelInfo[]): GraphModel {
    const nodeMap = new Map<Hex, GraphNodeInfo>();
    for (const n of nodes) nodeMap.set(n.pubkey, { pubkey: n.pubkey, name: n.node_name ?? null, addresses: n.addresses });

    const outgoing = new Map<Hex, DirectedEdge[]>();
    const incoming = new Map<Hex, DirectedEdge[]>();
    const edges: DirectedEdge[] = [];
    const push = (map: Map<Hex, DirectedEdge[]>, key: Hex, e: DirectedEdge) => {
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    };

    for (const c of channels) {
      const asset = assetIdOf(c.funding_udt_type_script);
      const capacity = bi(c.capacity);
      if (c.update_info_of_node1) {
        const e = makeEdge(c.channel_outpoint, c.node1, c.node2, asset, capacity, c.update_info_of_node1);
        edges.push(e); push(outgoing, e.from, e); push(incoming, e.to, e);
      }
      if (c.update_info_of_node2) {
        const e = makeEdge(c.channel_outpoint, c.node2, c.node1, asset, capacity, c.update_info_of_node2);
        edges.push(e); push(outgoing, e.from, e); push(incoming, e.to, e);
      }
    }
    return new GraphModel(nodeMap, outgoing, incoming, edges);
  }

  hasNode(pubkey: Hex): boolean { return this.nodes.has(pubkey); }
  node(pubkey: Hex): GraphNodeInfo | undefined { return this.nodes.get(pubkey); }
  edgesFrom(pubkey: Hex): DirectedEdge[] { return this.outgoing.get(pubkey) ?? []; }
  edgesTo(pubkey: Hex): DirectedEdge[] { return this.incoming.get(pubkey) ?? []; }
  allEdges(): DirectedEdge[] { return this.edges; }
  assetsOf(pubkey: Hex): Set<AssetId> {
    const s = new Set<AssetId>();
    for (const e of this.edgesFrom(pubkey)) s.add(e.asset);
    for (const e of this.edgesTo(pubkey)) s.add(e.asset);
    return s;
  }
}
```

- [ ] **Step 5: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./asset.js";
export * from "./graph-model.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- graph-model`
Expected: PASS (all assertions).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): GraphModel builds immutable directed multigraph from gossip data"
```

---

### Task 4: Constrained best-path finder

**Files:**
- Create: `packages/core/src/find-path.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/find-path.test.ts`

**Interfaces:**
- Consumes: `GraphModel` (Task 3), `ProbeRequest`, `ReportHop`, `DirectedEdge` (Task 2).
- Produces:
  - `interface PathResult { hops: ReportHop[]; totalFee: bigint; totalExpiry: bigint }`
  - `function edgeUsable(edge: DirectedEdge, probe: ProbeRequest): boolean` — true if the edge can carry the probe amount/asset (enabled, asset match, capacity ≥ amount, amount within min/max value).
  - `function findBestPath(model: GraphModel, probe: ProbeRequest): PathResult | null` — least-total-fee path from source to target using only usable edges; null if none.

Rationale: least-fee Dijkstra mirrors Fiber's fee-weighted pathfinding closely enough for diagnosis, and is deterministic. `fee` charged on a hop = `amount * feeRate / 1000` (per-thousand), matching Fiber's `max_fee_rate` "per thousand" semantics.

- [ ] **Step 1: Write the failing test**

`packages/core/test/find-path.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { GraphModel, findBestPath, edgeUsable, CKB_ASSET, type ProbeRequest, type RpcChannelInfo } from "../src/index.js";

function chan(op: string, a: string, b: string, feeAB: string, opts: Partial<{ enabled: boolean; cap: string; min: string }> = {}): RpcChannelInfo {
  const u = { timestamp: "0x1", enabled: opts.enabled ?? true, fee_rate: feeAB, tlc_expiry_delta: "0x3e8", tlc_minimum_value: opts.min ?? "0x1" };
  return {
    channel_outpoint: op, node1: a, node2: b, capacity: opts.cap ?? "0xf4240", // 1_000_000
    funding_udt_type_script: null,
    update_info_of_node1: u,
    update_info_of_node2: { ...u, fee_rate: feeAB }
  };
}

const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };

describe("edgeUsable", () => {
  it("rejects a disabled edge", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa", { enabled: false })]);
    expect(edgeUsable(m.edgesFrom("0xA")[0], probe)).toBe(false);
  });
  it("rejects when amount is below the min value", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa", { min: "0x100000" })]);
    expect(edgeUsable(m.edgesFrom("0xA")[0], probe)).toBe(false);
  });
  it("rejects when amount exceeds capacity", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa", { cap: "0x1" })]);
    expect(edgeUsable(m.edgesFrom("0xA")[0], probe)).toBe(false);
  });
});

describe("findBestPath", () => {
  it("returns the least-fee path across multiple hops", () => {
    // A->B (fee 10/k), B->C (fee 10/k): total fee = 1000*10/1000 * 2 = 20
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa"), chan("0x2", "0xB", "0xC", "0xa")]);
    const r = findBestPath(m, probe);
    expect(r).not.toBeNull();
    expect(r!.hops.map(h => h.to)).toEqual(["0xB", "0xC"]);
    expect(r!.totalFee).toBe(20n);
    expect(r!.totalExpiry).toBe(2000n);
  });
  it("prefers the cheaper of two candidate paths", () => {
    // Direct-ish expensive A->B(100)->C vs cheaper A->D(1)->C
    const m = GraphModel.fromRpc([], [
      chan("0x1", "0xA", "0xB", "0x64"), chan("0x2", "0xB", "0xC", "0x64"),
      chan("0x3", "0xA", "0xD", "0x1"),  chan("0x4", "0xD", "0xC", "0x1")
    ]);
    const r = findBestPath(m, probe);
    expect(r!.hops.map(h => h.to)).toEqual(["0xD", "0xC"]);
  });
  it("returns null when the target is unreachable", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa")]);
    expect(findBestPath(m, probe)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- find-path`
Expected: FAIL — `findBestPath` / `edgeUsable` not exported.

- [ ] **Step 3: Write `find-path.ts`**

`packages/core/src/find-path.ts`:
```ts
import type { DirectedEdge, Hex, ProbeRequest, ReportHop } from "./types.js";
import type { GraphModel } from "./graph-model.js";

export interface PathResult { hops: ReportHop[]; totalFee: bigint; totalExpiry: bigint; }

export function hopFee(amount: bigint, feeRate: bigint): bigint {
  return (amount * feeRate) / 1000n; // per-thousand, matching Fiber max_fee_rate semantics
}

export function edgeUsable(edge: DirectedEdge, probe: ProbeRequest): boolean {
  if (!edge.enabled) return false;
  if (edge.asset !== probe.asset) return false;
  if (edge.capacity < probe.amount) return false;
  if (probe.amount < edge.tlcMinimumValue) return false;
  if (edge.tlcMaximumValue !== null && probe.amount > edge.tlcMaximumValue) return false;
  return true;
}

// Dijkstra over usable edges, minimizing total fee. Deterministic tie-break by node key.
export function findBestPath(model: GraphModel, probe: ProbeRequest): PathResult | null {
  if (probe.source === probe.target) return { hops: [], totalFee: 0n, totalExpiry: 0n };

  const best = new Map<Hex, bigint>([[probe.source, 0n]]);
  const prev = new Map<Hex, DirectedEdge>();
  const visited = new Set<Hex>();

  while (true) {
    // pick unvisited node with smallest known cost (deterministic tie-break)
    let cur: Hex | null = null;
    let curCost = 0n;
    for (const [node, cost] of best) {
      if (visited.has(node)) continue;
      if (cur === null || cost < curCost || (cost === curCost && node < cur)) { cur = node; curCost = cost; }
    }
    if (cur === null) break;
    if (cur === probe.target) break;
    visited.add(cur);

    for (const edge of model.edgesFrom(cur)) {
      if (!edgeUsable(edge, probe)) continue;
      const cost = curCost + hopFee(probe.amount, edge.feeRate);
      const known = best.get(edge.to);
      if (known === undefined || cost < known) { best.set(edge.to, cost); prev.set(edge.to, edge); }
    }
  }

  if (!prev.has(probe.target)) return null;

  const edges: DirectedEdge[] = [];
  let node = probe.target;
  while (node !== probe.source) {
    const e = prev.get(node)!;
    edges.unshift(e);
    node = e.from;
  }

  let totalFee = 0n, totalExpiry = 0n;
  const hops: ReportHop[] = edges.map((e, i) => {
    const fee = hopFee(probe.amount, e.feeRate);
    totalFee += fee; totalExpiry += e.tlcExpiryDelta;
    return { index: i, from: e.from, to: e.to, channelOutpoint: e.channelOutpoint, asset: e.asset, fee, expiryDelta: e.tlcExpiryDelta };
  });
  return { hops, totalFee, totalExpiry };
}
```

- [ ] **Step 4: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./find-path.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- find-path`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): constrained least-fee path finder over the graph model"
```

---

### Task 5: Diagnosis — payable / risky verdict

**Files:**
- Create: `packages/core/src/diagnose.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/diagnose-payable.test.ts`

**Interfaces:**
- Consumes: `GraphModel` (Task 3), `findBestPath` (Task 4), `ProbeRequest`, `ProbeResult`, `RouteReport` (Task 2).
- Produces:
  - `function diagnose(model: GraphModel, probe: ProbeRequest, probeResult?: ProbeResult): RouteReport`
  - This task implements only the found-path branches: `payable` (fee within `maxFeeRate` and, if a router path was supplied, it matches) and `risky` (path found but the node's `build_router` disagreed or returned an error, or fee exceeds the ceiling). Task 6 adds the `blocked` branch.

- [ ] **Step 1: Write the failing test**

`packages/core/test/diagnose-payable.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { GraphModel, diagnose, CKB_ASSET, type ProbeRequest, type RpcChannelInfo } from "../src/index.js";

function chan(op: string, a: string, b: string, fee: string): RpcChannelInfo {
  const u = { timestamp: "0x1", enabled: true, fee_rate: fee, tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" };
  return { channel_outpoint: op, node1: a, node2: b, capacity: "0xf4240", funding_udt_type_script: null, update_info_of_node1: u, update_info_of_node2: u };
}
const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };
// fee_rate 0x1 (1/thousand) keeps a 2-hop route's total fee (2) within the default 0.5% ceiling (5) so it stays payable
const model = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0x1"), chan("0x2", "0xB", "0xC", "0x1")]);

describe("diagnose — found path", () => {
  it("returns payable with the path and totals when fee is within ceiling and router is skipped", () => {
    const r = diagnose(model, probe, { kind: "skipped" });
    expect(r.verdict).toBe("payable");
    expect(r.path.map(h => h.to)).toEqual(["0xB", "0xC"]);
    expect(r.totalFee).toBe(2n);
    expect(r.reasons).toEqual([]);
    expect(r.routerConfirmed).toBe(false);
  });
  it("marks payable + routerConfirmed when build_router returns the same channels", () => {
    const r = diagnose(model, probe, { kind: "router_path", channelOutpoints: ["0x1", "0x2"] });
    expect(r.verdict).toBe("payable");
    expect(r.routerConfirmed).toBe(true);
  });
  it("downgrades to risky when build_router errored despite a viable path", () => {
    const r = diagnose(model, probe, { kind: "router_error", message: "no path" });
    expect(r.verdict).toBe("risky");
    expect(r.reasons.map(x => x.cause)).toContain("router_declined");
  });
  it("downgrades to risky when the fee exceeds maxFeeRate", () => {
    const r = diagnose(model, { ...probe, maxFeeRate: 0n }, { kind: "skipped" });
    expect(r.verdict).toBe("risky");
    expect(r.reasons.map(x => x.cause)).toContain("fee_over_limit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- diagnose-payable`
Expected: FAIL — `diagnose` not exported.

- [ ] **Step 3: Write `diagnose.ts` (found-path branch; blocked branch stubbed to a minimal report Task 6 replaces)**

`packages/core/src/diagnose.ts`:
```ts
import { findBestPath } from "./find-path.js";
import type { GraphModel } from "./graph-model.js";
import type { ProbeRequest, ProbeResult, Reason, RouteReport } from "./types.js";

const DEFAULT_MAX_FEE_RATE = 5n; // per-thousand (0.5%)

function feeWithinCeiling(totalFee: bigint, amount: bigint, maxFeeRate: bigint): boolean {
  // ceiling amount = amount * maxFeeRate / 1000
  return totalFee <= (amount * maxFeeRate) / 1000n;
}

export function diagnose(model: GraphModel, probe: ProbeRequest, probeResult: ProbeResult = { kind: "skipped" }): RouteReport {
  const path = findBestPath(model, probe);

  if (path !== null) {
    const reasons: Reason[] = [];
    const maxFeeRate = probe.maxFeeRate ?? DEFAULT_MAX_FEE_RATE;
    let risky = false;

    if (!feeWithinCeiling(path.totalFee, probe.amount, maxFeeRate)) {
      risky = true;
      reasons.push({ cause: "fee_over_limit", detail: `total fee ${path.totalFee} exceeds ceiling for maxFeeRate ${maxFeeRate}/1000` });
    }
    if (probe.maxTotalExpiry !== undefined && path.totalExpiry > probe.maxTotalExpiry) {
      risky = true;
      reasons.push({ cause: "expiry_over_limit", detail: `total expiry ${path.totalExpiry}ms exceeds ceiling ${probe.maxTotalExpiry}ms` });
    }

    const routerConfirmed = probeResult.kind === "router_path"
      && sameChannels(probeResult.channelOutpoints, path.hops.map(h => h.channelOutpoint));
    if (probeResult.kind === "router_error") {
      risky = true;
      reasons.push({ cause: "router_declined", detail: `node build_router declined: ${probeResult.message}` });
    }

    return {
      verdict: risky ? "risky" : "payable",
      probe, path: path.hops, totalFee: path.totalFee, totalExpiry: path.totalExpiry,
      reasons, fixes: [], routerConfirmed
    };
  }

  // Blocked branch — replaced with real attribution in Task 6.
  return { verdict: "blocked", probe, path: [], totalFee: 0n, totalExpiry: 0n, reasons: [], fixes: [], routerConfirmed: false };
}

function sameChannels(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}
```

- [ ] **Step 4: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./diagnose.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- diagnose-payable`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): diagnose payable/risky verdicts for found paths"
```

---

### Task 6: Diagnosis — blocked attribution + fixes

**Files:**
- Create: `packages/core/src/attribute.ts`
- Modify: `packages/core/src/diagnose.ts` (replace the blocked branch)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/diagnose-blocked.test.ts`

**Interfaces:**
- Consumes: `GraphModel`, `DirectedEdge`, `ProbeRequest`, `Reason`, `Fix` (Tasks 2–3).
- Produces:
  - `function attributeBlock(model: GraphModel, probe: ProbeRequest): { reasons: Reason[]; fixes: Fix[] }` — explains why no path exists, ranked by dominant cause.
  - Updated `diagnose` blocked branch calls `attributeBlock`.

Attribution rules (checked in order; each produces a `Reason` + matching `Fix`):
1. Target not in graph → `target_absent`.
2. Target has no channel of the requested asset (but has channels of another asset) → `asset_mismatch`; if target has no channels at all → `no_asset_channel`.
3. Otherwise inspect the edges *into* the target for the requested asset and report the dominant failing constraint among them: `channel_disabled`, `below_min_value`, `above_max_value`, `insufficient_capacity`. Rank by count (descending), deterministic tie-break by cause name.

- [ ] **Step 1: Write the failing test**

`packages/core/test/diagnose-blocked.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { GraphModel, diagnose, CKB_ASSET, type ProbeRequest, type RpcChannelInfo } from "../src/index.js";

function chan(op: string, a: string, b: string, o: Partial<{ enabled: boolean; cap: string; min: string; udt: boolean }> = {}): RpcChannelInfo {
  const u = { timestamp: "0x1", enabled: o.enabled ?? true, fee_rate: "0xa", tlc_expiry_delta: "0x3e8", tlc_minimum_value: o.min ?? "0x1" };
  return {
    channel_outpoint: op, node1: a, node2: b, capacity: o.cap ?? "0xf4240",
    funding_udt_type_script: o.udt ? { code_hash: "0x11", hash_type: "type", args: "0x22" } : null,
    update_info_of_node1: u, update_info_of_node2: u
  };
}
const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };

describe("diagnose — blocked attribution", () => {
  it("reports target_absent when target has no presence", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB")]);
    const r = diagnose(m, probe, { kind: "skipped" });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons[0].cause).toBe("target_absent");
    expect(r.fixes.length).toBeGreaterThan(0);
  });
  it("reports asset_mismatch when target is only reachable on a different asset", () => {
    // Path A->B->C exists but only as a UDT channel into C; probe asks for CKB
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", { udt: true }), chan("0x2", "0xB", "0xC", { udt: true })]);
    const r = diagnose(m, probe, { kind: "skipped" });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons.map(x => x.cause)).toContain("asset_mismatch");
  });
  it("reports below_min_value as the dominant cause on the final hop", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB"), chan("0x2", "0xB", "0xC", { min: "0x100000" })]);
    const r = diagnose(m, probe, { kind: "skipped" });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons[0].cause).toBe("below_min_value");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- diagnose-blocked`
Expected: FAIL — blocked branch returns empty reasons.

- [ ] **Step 3: Write `attribute.ts`**

`packages/core/src/attribute.ts`:
```ts
import type { GraphModel } from "./graph-model.js";
import type { DirectedEdge, Fix, ProbeRequest, Reason, ReasonCause } from "./types.js";

function edgeFailure(edge: DirectedEdge, probe: ProbeRequest): ReasonCause | null {
  if (!edge.enabled) return "channel_disabled";
  if (probe.amount < edge.tlcMinimumValue) return "below_min_value";
  if (edge.tlcMaximumValue !== null && probe.amount > edge.tlcMaximumValue) return "above_max_value";
  if (edge.capacity < probe.amount) return "insufficient_capacity";
  return null;
}

const FIX_FOR: Record<ReasonCause, string> = {
  target_absent: "Target node is not in the gossip graph — confirm the node is online and announced, or use its direct channel.",
  no_asset_channel: "Target has no channels — it must open at least one channel to receive payments.",
  asset_mismatch: "Target is only reachable via a different asset — open a channel in the requested asset, or route the other asset (cross-asset is CCH-only in Fiber).",
  channel_disabled: "A channel on the only route is disabled — wait for it to re-enable or find an alternate peer.",
  below_min_value: "Payment is below the hop's tlc_minimum_value — increase the amount or choose a channel with a lower minimum.",
  above_max_value: "Payment exceeds the hop's maximum — split the payment (MPP) or use a higher-capacity channel.",
  insufficient_capacity: "No hop has enough directional capacity — open/rebalance a larger channel toward the target.",
  expiry_over_limit: "Total timelock exceeds the ceiling — raise maxTotalExpiry or find a shorter path.",
  fee_over_limit: "Cheapest path still exceeds the fee ceiling — raise maxFeeRate or find a cheaper path.",
  router_declined: "The node's own router declined — inspect node logs / liquidity."
};

export function attributeBlock(model: GraphModel, probe: ProbeRequest): { reasons: Reason[]; fixes: Fix[] } {
  const mk = (cause: ReasonCause, detail: string): { reasons: Reason[]; fixes: Fix[] } =>
    ({ reasons: [{ cause, detail }], fixes: [{ detail: FIX_FOR[cause] }] });

  if (!model.hasNode(probe.target) && model.edgesTo(probe.target).length === 0) {
    return mk("target_absent", `Target ${probe.target} not present in the graph.`);
  }

  const intoTarget = model.edgesTo(probe.target);
  if (intoTarget.length === 0) return mk("no_asset_channel", `Target ${probe.target} has no channels.`);

  const assetEdges = intoTarget.filter(e => e.asset === probe.asset);
  if (assetEdges.length === 0) {
    const others = [...new Set(intoTarget.map(e => e.asset))].join(", ");
    return mk("asset_mismatch", `Target reachable only via asset(s) [${others}], not ${probe.asset}.`);
  }

  // Dominant failing constraint among the requested-asset edges into the target.
  const counts = new Map<ReasonCause, number>();
  for (const e of assetEdges) {
    const f = edgeFailure(e, probe);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  if (counts.size === 0) {
    // Edges into target are individually fine → block is upstream; report insufficient_capacity as the generic upstream cause.
    return mk("insufficient_capacity", `No usable end-to-end route to ${probe.target} despite viable final hops (upstream liquidity/asset gap).`);
  }
  const ranked = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const reasons: Reason[] = ranked.map(([cause, n]) => ({ cause, detail: `${n} final-hop channel(s) failed on ${cause}.` }));
  const fixes: Fix[] = ranked.map(([cause]) => ({ detail: FIX_FOR[cause] }));
  return { reasons, fixes };
}
```

- [ ] **Step 4: Wire the blocked branch into `diagnose`**

In `packages/core/src/diagnose.ts`, add the import at the top:
```ts
import { attributeBlock } from "./attribute.js";
```
Replace the blocked-branch return (the final `return` in `diagnose`) with:
```ts
  const { reasons, fixes } = attributeBlock(model, probe);
  return { verdict: "blocked", probe, path: [], totalFee: 0n, totalExpiry: 0n, reasons, fixes, routerConfirmed: false };
```

- [ ] **Step 5: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./attribute.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- diagnose-blocked diagnose-payable`
Expected: PASS (both suites — confirms Task 5 behavior is unbroken).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): attribute blocked routes to ranked causes and fixes"
```

---

### Task 7: GraphClient (JSON-RPC transport)

**Files:**
- Create: `packages/core/src/graph-client.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/graph-client.test.ts`

**Interfaces:**
- Consumes: `RpcGraphNode`, `RpcChannelInfo` (Task 2).
- Produces:
  - `interface GraphClientOptions { url: string; biscuit?: string; fetchImpl?: typeof fetch }`
  - `class GraphClient` with `graphNodes(): Promise<RpcGraphNode[]>` and `graphChannels(): Promise<RpcChannelInfo[]>`.
- Note: uses an injected `fetchImpl` for testability; binds real `fetch` to `globalThis` by default (avoids the "Illegal invocation" brand-check trap seen in prior Fiber work).

- [ ] **Step 1: Write the failing test**

`packages/core/test/graph-client.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { GraphClient } from "../src/index.js";

function mockFetch(result: unknown) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

describe("GraphClient", () => {
  it("posts a graph_channels JSON-RPC call and returns the result array", async () => {
    const fetchImpl = mockFetch([{ channel_outpoint: "0x1", node1: "0xA", node2: "0xB", capacity: "0x64", funding_udt_type_script: null, update_info_of_node1: null, update_info_of_node2: null }]);
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    const channels = await client.graphChannels();
    expect(channels).toHaveLength(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(init!.body)).method).toBe("graph_channels");
  });
  it("adds an Authorization header when a biscuit is provided", async () => {
    const fetchImpl = mockFetch([]);
    const client = new GraphClient({ url: "http://node.local/rpc", biscuit: "tok123", fetchImpl });
    await client.graphNodes();
    const [, init] = fetchImpl.mock.calls[0];
    expect((init!.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok123");
  });
  it("throws when the RPC returns an error object", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "boom" } }), { status: 200 }));
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    await expect(client.graphNodes()).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- graph-client`
Expected: FAIL — `GraphClient` not exported.

- [ ] **Step 3: Write `graph-client.ts`**

`packages/core/src/graph-client.ts`:
```ts
import type { RpcChannelInfo, RpcGraphNode } from "./types.js";

export interface GraphClientOptions { url: string; biscuit?: string; fetchImpl?: typeof fetch; }

interface JsonRpcResponse<T> { result?: T; error?: { code: number; message: string }; }

export class GraphClient {
  private readonly url: string;
  private readonly biscuit?: string;
  private readonly fetchImpl: typeof fetch;
  private id = 0;

  constructor(opts: GraphClientOptions) {
    this.url = opts.url;
    this.biscuit = opts.biscuit;
    // bind to globalThis to avoid native-fetch brand-check "Illegal invocation"
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.biscuit) headers["Authorization"] = `Bearer ${this.biscuit}`;
    const res = await this.fetchImpl(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
    return json.result as T;
  }

  async graphNodes(): Promise<RpcGraphNode[]> {
    const r = await this.call<{ nodes: RpcGraphNode[] } | RpcGraphNode[]>("graph_nodes", [{}]);
    return Array.isArray(r) ? r : r.nodes;
  }
  async graphChannels(): Promise<RpcChannelInfo[]> {
    const r = await this.call<{ channels: RpcChannelInfo[] } | RpcChannelInfo[]>("graph_channels", [{}]);
    return Array.isArray(r) ? r : r.channels;
  }
}
```

- [ ] **Step 4: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./graph-client.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- graph-client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): JSON-RPC GraphClient for graph_nodes and graph_channels"
```

---

### Task 8: RouteProbe (optional build_router cross-check)

**Files:**
- Create: `packages/core/src/route-probe.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/route-probe.test.ts`

**Interfaces:**
- Consumes: `GraphClient` (Task 7), `ProbeRequest`, `ProbeResult` (Task 2).
- Produces:
  - `interface RouterCaller { buildRouter(params: BuildRouterParams): Promise<{ router_hops: Array<{ channel_outpoint?: string }> }> }` (subset of GraphClient / any RPC caller)
  - `interface BuildRouterParams { amount: string; udt_type_script: null; hops_info: Array<{ pubkey: string }>; max_fee_rate?: string }`
  - `function toBuildRouterParams(probe: ProbeRequest): BuildRouterParams`
  - `async function crossCheckRouter(caller: RouterCaller, probe: ProbeRequest): Promise<ProbeResult>` — calls build_router; returns `router_path` with channel outpoints, or `router_error` on throw.

Note: `build_router`'s exact request body is the least-documented part of the v0.9 RPC. This task keeps that surface tiny and behind `RouterCaller`, so the value engine (Tasks 3–6) never depends on it. Task 12's gated live smoke test captures a real request/response and adjusts `toBuildRouterParams` if the live node differs.

- [ ] **Step 1: Write the failing test**

`packages/core/test/route-probe.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { crossCheckRouter, toBuildRouterParams, CKB_ASSET, type ProbeRequest } from "../src/index.js";

const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET, maxFeeRate: 5n };

describe("toBuildRouterParams", () => {
  it("encodes amount as hex and target as the final hop", () => {
    const p = toBuildRouterParams(probe);
    expect(p.amount).toBe("0x3e8");
    expect(p.hops_info.at(-1)).toEqual({ pubkey: "0xC" });
    expect(p.max_fee_rate).toBe("0x5");
  });
});

describe("crossCheckRouter", () => {
  it("returns router_path with channel outpoints on success", async () => {
    const caller = { buildRouter: vi.fn(async () => ({ router_hops: [{ channel_outpoint: "0x1" }, { channel_outpoint: "0x2" }] })) };
    const r = await crossCheckRouter(caller, probe);
    expect(r).toEqual({ kind: "router_path", channelOutpoints: ["0x1", "0x2"] });
  });
  it("returns router_error when build_router throws", async () => {
    const caller = { buildRouter: vi.fn(async () => { throw new Error("no path found"); }) };
    const r = await crossCheckRouter(caller, probe);
    expect(r).toEqual({ kind: "router_error", message: "no path found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- route-probe`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write `route-probe.ts`**

`packages/core/src/route-probe.ts`:
```ts
import type { ProbeRequest, ProbeResult } from "./types.js";

export interface BuildRouterParams {
  amount: string;
  udt_type_script: null;
  hops_info: Array<{ pubkey: string }>;
  max_fee_rate?: string;
}
export interface RouterCaller {
  buildRouter(params: BuildRouterParams): Promise<{ router_hops: Array<{ channel_outpoint?: string }> }>;
}

export function toBuildRouterParams(probe: ProbeRequest): BuildRouterParams {
  const params: BuildRouterParams = {
    amount: `0x${probe.amount.toString(16)}`,
    udt_type_script: null, // MVP cross-check targets CKB; UDT support is a stretch goal
    hops_info: [{ pubkey: probe.target }]
  };
  if (probe.maxFeeRate !== undefined) params.max_fee_rate = `0x${probe.maxFeeRate.toString(16)}`;
  return params;
}

export async function crossCheckRouter(caller: RouterCaller, probe: ProbeRequest): Promise<ProbeResult> {
  try {
    const res = await caller.buildRouter(toBuildRouterParams(probe));
    const channelOutpoints = res.router_hops.map(h => h.channel_outpoint).filter((x): x is string => typeof x === "string");
    return { kind: "router_path", channelOutpoints };
  } catch (err) {
    return { kind: "router_error", message: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./route-probe.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- route-probe`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): optional build_router cross-check behind a small interface"
```

---

### Task 9: Orchestrator facade + text formatter

**Files:**
- Create: `packages/core/src/route-doctor.ts`
- Create: `packages/core/src/format.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/route-doctor.test.ts`
- Test: `packages/core/test/format.test.ts`

**Interfaces:**
- Consumes: `GraphClient` (7), `GraphModel` (3), `diagnose` (5/6), `crossCheckRouter` (8), `RouteReport` (2).
- Produces:
  - `interface LoadedGraph { model: GraphModel }`
  - `async function loadGraph(client: GraphClient): Promise<GraphModel>`
  - `async function runDiagnosis(model: GraphModel, probe: ProbeRequest, router?: RouterCaller): Promise<RouteReport>`
  - `function formatReportText(report: RouteReport): string` — deterministic multi-line human summary (shared by CLI/web).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/route-doctor.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { GraphClient, loadGraph, runDiagnosis, CKB_ASSET, type ProbeRequest } from "../src/index.js";

function client(nodes: unknown, channels: unknown) {
  const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const result = body.method === "graph_nodes" ? nodes : channels;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
  return new GraphClient({ url: "http://n/rpc", fetchImpl });
}
const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };
const chans = [
  { channel_outpoint: "0x1", node1: "0xA", node2: "0xB", capacity: "0xf4240", funding_udt_type_script: null, update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" }, update_info_of_node2: null },
  { channel_outpoint: "0x2", node1: "0xB", node2: "0xC", capacity: "0xf4240", funding_udt_type_script: null, update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" }, update_info_of_node2: null }
];

describe("orchestrator", () => {
  it("loads the graph and diagnoses a payable route (router skipped)", async () => {
    const model = await loadGraph(client([], chans));
    const report = await runDiagnosis(model, probe);
    expect(report.verdict).toBe("payable");
    expect(report.routerConfirmed).toBe(false);
  });
  it("uses the router cross-check when supplied", async () => {
    const model = await loadGraph(client([], chans));
    const router = { buildRouter: vi.fn(async () => ({ router_hops: [{ channel_outpoint: "0x1" }, { channel_outpoint: "0x2" }] })) };
    const report = await runDiagnosis(model, probe, router);
    expect(report.verdict).toBe("payable");
    expect(report.routerConfirmed).toBe(true);
  });
});
```

`packages/core/test/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatReportText, CKB_ASSET, type RouteReport } from "../src/index.js";

const base: RouteReport = {
  verdict: "blocked", probe: { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET },
  path: [], totalFee: 0n, totalExpiry: 0n,
  reasons: [{ cause: "below_min_value", detail: "1 final-hop channel(s) failed on below_min_value." }],
  fixes: [{ detail: "Increase the amount." }], routerConfirmed: false
};

describe("formatReportText", () => {
  it("renders the verdict, reasons, and fixes deterministically", () => {
    const text = formatReportText(base);
    expect(text).toContain("VERDICT: blocked");
    expect(text).toContain("below_min_value");
    expect(text).toContain("Increase the amount.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- route-doctor format`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write `format.ts`**

`packages/core/src/format.ts`:
```ts
import type { RouteReport } from "./types.js";

export function formatReportText(report: RouteReport): string {
  const lines: string[] = [];
  lines.push(`VERDICT: ${report.verdict}`);
  lines.push(`probe: ${report.probe.source} -> ${report.probe.target}  amount=${report.probe.amount}  asset=${report.probe.asset}`);
  if (report.path.length > 0) {
    lines.push(`path (${report.path.length} hop(s)), totalFee=${report.totalFee}, totalExpiry=${report.totalExpiry}ms, routerConfirmed=${report.routerConfirmed}`);
    for (const h of report.path) lines.push(`  ${h.index + 1}. ${h.from} -> ${h.to}  fee=${h.fee}  expiry=${h.expiryDelta}ms  chan=${h.channelOutpoint}`);
  }
  if (report.reasons.length > 0) {
    lines.push("reasons:");
    for (const r of report.reasons) lines.push(`  - [${r.cause}] ${r.detail}`);
  }
  if (report.fixes.length > 0) {
    lines.push("fixes:");
    for (const f of report.fixes) lines.push(`  - ${f.detail}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Write `route-doctor.ts`**

`packages/core/src/route-doctor.ts`:
```ts
import { GraphModel } from "./graph-model.js";
import { GraphClient } from "./graph-client.js";
import { diagnose } from "./diagnose.js";
import { crossCheckRouter, type RouterCaller } from "./route-probe.js";
import type { ProbeRequest, ProbeResult, RouteReport } from "./types.js";

export async function loadGraph(client: GraphClient): Promise<GraphModel> {
  const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
  return GraphModel.fromRpc(nodes, channels);
}

export async function runDiagnosis(model: GraphModel, probe: ProbeRequest, router?: RouterCaller): Promise<RouteReport> {
  let probeResult: ProbeResult = { kind: "skipped" };
  if (router) probeResult = await crossCheckRouter(router, probe);
  return diagnose(model, probe, probeResult);
}
```

- [ ] **Step 5: Re-export**

Append to `packages/core/src/index.ts`:
```ts
export * from "./format.js";
export * from "./route-doctor.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the entire core suite (Tasks 1–9) is green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): orchestrator facade and shared text report formatter"
```

---

### Task 10: CLI app

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/main.ts`
- Create: `apps/cli/src/args.ts`
- Test: `apps/cli/test/args.test.ts`

**Interfaces:**
- Consumes: `@fiber-route-doctor/core` (`GraphClient`, `loadGraph`, `runDiagnosis`, `formatReportText`, `CKB_ASSET`).
- Produces:
  - `interface CliArgs { url: string; source: string; target: string; amount: bigint; asset: AssetId; biscuit?: string; router: boolean }`
  - `function parseArgs(argv: string[]): CliArgs` (throws on missing required flags).

- [ ] **Step 1: Write the failing test**

`apps/cli/test/args.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses required flags and defaults asset to CKB", () => {
    const a = parseArgs(["--url", "http://n/rpc", "--source", "0xA", "--target", "0xC", "--amount", "1000"]);
    expect(a).toMatchObject({ url: "http://n/rpc", source: "0xA", target: "0xC", amount: 1000n, asset: "CKB", router: false });
  });
  it("enables router cross-check with --router and reads --biscuit", () => {
    const a = parseArgs(["--url", "u", "--source", "0xA", "--target", "0xC", "--amount", "5", "--router", "--biscuit", "tok"]);
    expect(a.router).toBe(true);
    expect(a.biscuit).toBe("tok");
  });
  it("throws when a required flag is missing", () => {
    expect(() => parseArgs(["--url", "u", "--source", "0xA"])).toThrow(/target/);
  });
});
```

- [ ] **Step 2: Create app config and run test to verify it fails**

`apps/cli/package.json`:
```json
{
  "name": "@fiber-route-doctor/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "fiber-route-doctor": "./src/main.ts" },
  "dependencies": { "@fiber-route-doctor/core": "0.1.0" },
  "scripts": { "start": "tsx src/main.ts" },
  "license": "MIT"
}
```

`apps/cli/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `npm install && npm test -- args`
Expected: FAIL — `parseArgs` not found.

- [ ] **Step 3: Write `args.ts`**

`apps/cli/src/args.ts`:
```ts
import { CKB_ASSET, type AssetId } from "@fiber-route-doctor/core";

export interface CliArgs {
  url: string; source: string; target: string; amount: bigint; asset: AssetId; biscuit?: string; router: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { bools.add(key); } else { flags.set(key, next); i++; }
  }
  const req = (k: string): string => {
    const v = flags.get(k);
    if (v === undefined) throw new Error(`missing required flag --${k}`);
    return v;
  };
  return {
    url: req("url"), source: req("source"), target: req("target"),
    amount: BigInt(req("amount")),
    asset: (flags.get("asset") as AssetId | undefined) ?? CKB_ASSET,
    biscuit: flags.get("biscuit"),
    router: bools.has("router")
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- args`
Expected: PASS.

- [ ] **Step 5: Write `main.ts` (entrypoint; not unit-tested — exercised by the live smoke in Task 12)**

`apps/cli/src/main.ts`:
```ts
#!/usr/bin/env tsx
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type ProbeRequest } from "@fiber-route-doctor/core";
import { parseArgs } from "./args.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new GraphClient({ url: args.url, biscuit: args.biscuit });
  const model = await loadGraph(client);
  const probe: ProbeRequest = { source: args.source, target: args.target, amount: args.amount, asset: args.asset };
  const router = args.router ? makeRouter(args.url, args.biscuit) : undefined;
  const report = await runDiagnosis(model, probe, router);
  console.log(formatReportText(report));
  process.exit(report.verdict === "blocked" ? 1 : 0);
}

function makeRouter(url: string, biscuit?: string) {
  return {
    async buildRouter(params: unknown) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (biscuit) headers["Authorization"] = `Bearer ${biscuit}`;
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "build_router", params: [params] }) });
      const json = await res.json() as { result?: { router_hops: Array<{ channel_outpoint?: string }> }; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      return json.result!;
    }
  };
}

main().catch((e) => { console.error(String(e)); process.exit(2); });
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): argument parser and diagnosis entrypoint"
```

---

### Task 11: Web demo (Vite + React)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/probe-form.ts`
- Test: `apps/web/test/probe-form.test.ts`

**Interfaces:**
- Consumes: `@fiber-route-doctor/core`.
- Produces:
  - `function buildProbe(input: { source: string; target: string; amount: string; asset: string }): ProbeRequest` (pure; validates + converts).
  - React `App` that runs a diagnosis against a node URL and renders `formatReportText` output + a simple hop list.

Keep the web app minimal: correctness of the probe conversion is unit-tested; the React shell is a thin consumer.

- [ ] **Step 1: Write the failing test**

`apps/web/test/probe-form.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildProbe } from "../src/probe-form.js";

describe("buildProbe", () => {
  it("converts a decimal amount string to bigint and defaults empty asset to CKB", () => {
    const p = buildProbe({ source: "0xA", target: "0xC", amount: "1000", asset: "" });
    expect(p.amount).toBe(1000n);
    expect(p.asset).toBe("CKB");
  });
  it("throws on a non-numeric amount", () => {
    expect(() => buildProbe({ source: "0xA", target: "0xC", amount: "abc", asset: "" })).toThrow(/amount/);
  });
});
```

- [ ] **Step 2: Create web config and run test to verify it fails**

`apps/web/package.json`:
```json
{
  "name": "@fiber-route-doctor/web",
  "version": "0.1.0",
  "type": "module",
  "dependencies": { "@fiber-route-doctor/core": "0.1.0", "react": "^18.3.0", "react-dom": "^18.3.0" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.0", "vite": "^5.4.0" },
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "license": "MIT"
}
```

`apps/web/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"] }, "include": ["src", "test"] }
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });
```

Run: `npm install && npm test -- probe-form`
Expected: FAIL — `buildProbe` not found.

- [ ] **Step 3: Write `probe-form.ts`**

`apps/web/src/probe-form.ts`:
```ts
import { CKB_ASSET, type AssetId, type ProbeRequest } from "@fiber-route-doctor/core";

export function buildProbe(input: { source: string; target: string; amount: string; asset: string }): ProbeRequest {
  if (!/^\d+$/.test(input.amount.trim())) throw new Error("amount must be a positive integer (shannons/UDT base units)");
  return {
    source: input.source.trim(),
    target: input.target.trim(),
    amount: BigInt(input.amount.trim()),
    asset: (input.asset.trim() || CKB_ASSET) as AssetId
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- probe-form`
Expected: PASS.

- [ ] **Step 5: Write the React shell**

`apps/web/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Fiber Route Doctor</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
createRoot(document.getElementById("root")!).render(<App />);
```

`apps/web/src/App.tsx`:
```tsx
import React, { useState } from "react";
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type RouteReport } from "@fiber-route-doctor/core";
import { buildProbe } from "./probe-form.js";

export function App() {
  const [url, setUrl] = useState("http://127.0.0.1:8227");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("1000");
  const [asset, setAsset] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const probe = buildProbe({ source, target, amount, asset });
      const model = await loadGraph(new GraphClient({ url }));
      const report: RouteReport = await runDiagnosis(model, probe);
      setOut(formatReportText(report));
    } catch (e) {
      setOut(`error: ${String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <main style={{ fontFamily: "monospace", maxWidth: 720, margin: "2rem auto" }}>
      <h1>Fiber Route Doctor</h1>
      {([["node url", url, setUrl], ["source pubkey", source, setSource], ["target pubkey", target, setTarget], ["amount", amount, setAmount], ["asset (blank=CKB)", asset, setAsset]] as const).map(([label, val, set]) => (
        <div key={label} style={{ margin: "0.4rem 0" }}>
          <label>{label}: <input value={val} onChange={(e) => set(e.target.value)} style={{ width: 420 }} /></label>
        </div>
      ))}
      <button onClick={run} disabled={busy}>{busy ? "diagnosing…" : "Diagnose"}</button>
      <pre style={{ background: "#111", color: "#0f0", padding: "1rem", marginTop: "1rem", whiteSpace: "pre-wrap" }}>{out}</pre>
    </main>
  );
}
```

- [ ] **Step 6: Verify build and commit**

Run: `npm --workspace @fiber-route-doctor/web run build`
Expected: Vite build succeeds, emits `apps/web/dist`.

```bash
git add -A
git commit -m "feat(web): hosted diagnosis demo with pure probe-form conversion"
```

---

### Task 12: Gated live smoke test + README + demo-node docs

**Files:**
- Create: `scripts/live-smoke.mjs`
- Create: `README.md`
- Create: `docs/demo-node.md`
- Modify: root `package.json` (add `smoke:live` script)

**Interfaces:**
- Consumes: `@fiber-route-doctor/core` (via a relative import of `packages/core/src/index.ts` through tsx) — the smoke script is JS run with `tsx`.
- Produces: a skip-on-missing-node live check that captures a real `graph_channels` sample and (if `--router`) a real `build_router` request/response for verifying `toBuildRouterParams`.

- [ ] **Step 1: Write `scripts/live-smoke.mjs`**

`scripts/live-smoke.mjs`:
```js
// Live smoke test. Skips unless FIBER_RPC_URL is set.
// Usage: FIBER_RPC_URL=http://127.0.0.1:8227 node --import tsx scripts/live-smoke.mjs
import { GraphClient, loadGraph } from "../packages/core/src/index.ts";

const url = process.env.FIBER_RPC_URL;
if (!url) { console.log("SKIP live-smoke: set FIBER_RPC_URL to run"); process.exit(0); }

const client = new GraphClient({ url, biscuit: process.env.FIBER_BISCUIT });
const model = await loadGraph(client);
const edges = model.allEdges();
console.log(`OK: loaded graph with ${edges.length} directed edges`);
if (edges.length > 0) {
  const e = edges[0];
  console.log(`sample edge: ${e.from} -> ${e.to} asset=${e.asset} feeRate=${e.feeRate} min=${e.tlcMinimumValue} enabled=${e.enabled}`);
}
```

- [ ] **Step 2: Add the script to root `package.json`**

Add to the root `package.json` `scripts` block:
```json
"smoke:live": "node --import tsx scripts/live-smoke.mjs"
```

- [ ] **Step 3: Run the smoke test in skip mode to verify it passes cleanly**

Run: `npm run smoke:live`
Expected: prints `SKIP live-smoke: set FIBER_RPC_URL to run` and exits 0.

- [ ] **Step 4: Write `docs/demo-node.md`**

`docs/demo-node.md`:
```markdown
# Running a Fiber v0.9 testnet node for the demo

Route Doctor reads a node's gossip graph over JSON-RPC. Any reachable Fiber
v0.9 node works; read-only `graph_nodes` / `graph_channels` also work against
public testnet nodes.

## Option A: official Docker image (v0.8.1+)
```
docker run --rm -p 8227:8227 \
  -v "$PWD/fiber-data:/data" \
  nervos/fiber:latest --config /data/config.yml
```
Point Route Doctor at `http://127.0.0.1:8227`.

## Option B: public testnet node
Set `FIBER_RPC_URL` to a public node's RPC endpoint (graph queries are
unauthenticated). `build_router` may require your own node.

## Verifying
```
FIBER_RPC_URL=http://127.0.0.1:8227 npm run smoke:live
```
```

- [ ] **Step 5: Write `README.md`**

`README.md`:
```markdown
# Fiber Route Doctor

Routing diagnostics for the Fiber Network. Answers **"would this payment
succeed, via what path, and if not exactly why"** — by reading a node's
gossip graph, self-computing a constrained best path, and attributing any
block to ranked causes and fixes. Built for the "Gone in 60ms" Fiber
Infrastructure Hackathon (Category 2).

## Packages
- `@fiber-route-doctor/core` — UI-free engine (graph model, path finder, diagnosis).
- `@fiber-route-doctor/cli` — operator command.
- `@fiber-route-doctor/web` — hosted demo.

## Quick start
```
npm install
npm test
```

## CLI
```
npm --workspace @fiber-route-doctor/cli run start -- \
  --url http://127.0.0.1:8227 --source 0x<src> --target 0x<dst> --amount 1000
```
Add `--router` to cross-check against the node's own `build_router`.

## Web demo
```
npm --workspace @fiber-route-doctor/web run dev
```

## Live smoke
See [docs/demo-node.md](docs/demo-node.md). Requires a reachable Fiber v0.9 node.

## What it fills
Fiber ships `build_router` but gives no explanation when routing fails.
Route Doctor adds the failure-attribution layer: liquidity floors,
min/max value, expiry, fee ceilings, disabled channels, absent nodes, and
asset mismatch (cross-asset transfer is CCH-only in Fiber).

MIT licensed.
```

- [ ] **Step 6: Full test run and commit**

Run: `npm test`
Expected: PASS — the whole suite (core + cli + web) is green.

```bash
git add -A
git commit -m "docs: README, demo-node guide, and gated live smoke test"
```

---

## Notes for the implementer

- **TDD discipline:** every task writes the test first, watches it fail, then implements. Do not batch.
- **bigint everywhere:** never let a hex string or `number` leak past `GraphClient`/args parsing into the model or diagnosis.
- **Determinism:** `diagnose`, `findBestPath`, and `attributeBlock` must be pure — no clocks, no randomness, no network. This is what makes the golden-file tests trustworthy.
- **The `build_router` request body is the one soft spot** — it is deliberately isolated in `route-probe.ts` + the CLI `makeRouter`, and never gates the core verdict. If the live node rejects the request shape, adjust `toBuildRouterParams` only; nothing else changes.
- **Stretch goals** (from the spec §3) are intentionally excluded from this plan: live send-failure attribution via `get_payment`, probability heuristics, trampoline awareness, "what-if channel" simulation, and alerting. Add them as follow-up plans once the MVP is green and demoed.
