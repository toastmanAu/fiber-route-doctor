# Channel Liquidity Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `liquidity` CLI subcommand (report, `--save` persisted snapshots, `--diff` against the last snapshot) and a web panel that answer: what can this node send/receive per asset, and how is liquidity distributed across channels and peers?

**Architecture:** Raw-first snapshots, compute-on-read. `HealthClient.listChannels()` (existing, zero new RPC code) → `buildLiquiditySnapshot` normalizes to a JSON-safe record (decimal-string balances) → pure `computeLiquidityReport` / `diffSnapshots` / formatters. `SnapshotStore` interface lives in core; the Node fs implementation lives in the CLI so core stays browser-safe.

**Tech Stack:** TypeScript ESM strict, Vitest, npm workspaces (`packages/core`, `apps/cli`, `apps/web`), React (web), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-channel-liquidity-snapshot-design.md`

## Global Constraints

- Node >= 22; run tests from repo root: `npx vitest run <files>` and `npm run typecheck`.
- Repo style: compact TS, semicolons, double quotes, tests in `<workspace>/test/*.test.ts`.
- Balances are u128 hex strings from RPC; persisted/reported as **decimal strings** (u128 overflows Number; JSON.stringify rejects bigint). All arithmetic in `bigint` internally.
- Analytics (outbound/inbound/max/holds/skew/peers) count only channels with `state === "ChannelReady" && enabled === true`; others are counted in `excludedChannels`.
- Skew thresholds: named exported constants `SKEW_DRAINED_PCT = 10`, `SKEW_FULL_PCT = 90`; flags fire strictly below/above (exactly 10%/90% → no flag). Channels with `local + remote === 0` get no skew entry.
- Asset identity via existing `assetIdOf(script | null)` from `packages/core/src/asset.ts` (`"CKB"` for null).
- The biscuit token must never appear in output, snapshots, or saved files.
- Exit codes: 0 success (informational tool), 2 usage/probe errors.
- Every task: run the task's tests + `npm run typecheck` before committing.

---

### Task 1: Liquidity types, RpcChannel.pubkey, buildLiquiditySnapshot

**Files:**
- Create: `packages/core/src/liquidity-types.ts`
- Create: `packages/core/src/liquidity.ts`
- Create: `packages/core/test/liquidity-fixtures.ts` (shared fixtures — NOT a `.test.ts` file, so vitest never runs it directly and other test files can import it without re-registering suites)
- Modify: `packages/core/src/health-types.ts` (add `pubkey: Hex;` to `RpcChannel`)
- Modify: `packages/core/test/health-checks.test.ts` (add `pubkey` to the `chan()` factory so typecheck holds)
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/test/liquidity-snapshot.test.ts`

**Interfaces:**
- Consumes: `RpcChannel` (health-types), `assetIdOf` (asset.ts), `AssetId`/`Hex` (types.ts).
- Produces: `ChannelLiquidity`, `LiquiditySnapshot`, `SnapshotStore`, `AssetLiquidity`, `SkewFlag`, `PeerGroup`, `LiquidityReport`, `LiquidityDiff` (liquidity-types); `buildLiquiditySnapshot(channels: RpcChannel[], nodeUrl: string, ts: string): LiquiditySnapshot`.

- [ ] **Step 1: Write the shared fixtures and the failing test**

`packages/core/test/liquidity-fixtures.ts` (fixtures shared by all liquidity test files):

```typescript
import type { ChannelLiquidity, LiquiditySnapshot, RpcChannel } from "../src/index.js";

export function rpcChan(over: Partial<RpcChannel> = {}): RpcChannel {
  return {
    channel_id: "0x" + "ab".repeat(32), pubkey: "0x02aa", state: { state_name: "ChannelReady" },
    local_balance: "0x3e8", remote_balance: "0x7d0", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
    enabled: true, is_public: true, pending_tlcs: [], created_at: "0x1",
    funding_udt_type_script: null, failure_detail: null, ...over
  };
}

export function liq(over: Partial<ChannelLiquidity> = {}): ChannelLiquidity {
  return {
    channelId: "0x01", peer: "0x02aa", asset: "CKB", state: "ChannelReady",
    enabled: true, isPublic: true, local: "1000", remote: "2000",
    offeredHold: "0", receivedHold: "0", createdAt: "1", ...over
  };
}

export function snapOf(channels: ChannelLiquidity[]): LiquiditySnapshot {
  return { ts: "2026-07-03T00:00:00.000Z", nodeUrl: "http://n:8231", channels };
}
```

`packages/core/test/liquidity-snapshot.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLiquiditySnapshot } from "../src/index.js";
import { rpcChan } from "./liquidity-fixtures.js";

describe("buildLiquiditySnapshot", () => {
  it("normalizes hex balances to decimal strings and maps null UDT to CKB", () => {
    const s = buildLiquiditySnapshot([rpcChan()], "http://n:8231", "2026-07-03T00:00:00.000Z");
    expect(s).toMatchObject({ ts: "2026-07-03T00:00:00.000Z", nodeUrl: "http://n:8231" });
    expect(s.channels[0]).toMatchObject({
      peer: "0x02aa", asset: "CKB", state: "ChannelReady", enabled: true, isPublic: true,
      local: "1000", remote: "2000", offeredHold: "0", receivedHold: "0", createdAt: "1"
    });
  });
  it("handles u128 values beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const s = buildLiquiditySnapshot([rpcChan({ local_balance: "0xffffffffffffffffff" })], "u", "t");
    expect(s.channels[0].local).toBe("4722366482869645213695");
  });
  it("derives a stable UDT asset id from the funding type script", () => {
    const udt = { code_hash: "0xcc", hash_type: "type", args: "0x01" };
    const s = buildLiquiditySnapshot([rpcChan({ funding_udt_type_script: udt })], "u", "t");
    expect(s.channels[0].asset).toBe("udt:0xcc:type:0x01");
  });
  it("produces plain-JSON-safe output (no bigints, survives stringify round-trip)", () => {
    const s = buildLiquiditySnapshot([rpcChan()], "u", "t");
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/liquidity-snapshot.test.ts`
Expected: FAIL — `buildLiquiditySnapshot` not exported (and `pubkey` missing from `RpcChannel`).

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/health-types.ts` — add one field to `RpcChannel` (after `channel_id`):

```typescript
  /** The counterparty's identity public key. */
  pubkey: Hex;
```

`packages/core/test/health-checks.test.ts` — add `pubkey: "0x02aa",` to the `chan()` factory object (next to `channel_id`).

`packages/core/src/liquidity-types.ts`:

```typescript
import type { AssetId, Hex } from "./types.js";

/** One channel's liquidity as observed at snapshot time. Balances are decimal strings. */
export interface ChannelLiquidity {
  channelId: Hex;
  peer: Hex;
  asset: AssetId;
  state: string;
  enabled: boolean;
  isPublic: boolean;
  local: string;
  remote: string;
  offeredHold: string;
  receivedHold: string;
  createdAt: string; // ms since epoch, decimal string
}

/** Raw-first persisted artifact: plain JSON-safe, analytics computed at read time. */
export interface LiquiditySnapshot { ts: string; nodeUrl: string; channels: ChannelLiquidity[]; }

export interface SnapshotStore {
  list(): string[];
  get(name: string): LiquiditySnapshot | undefined;
  put(s: LiquiditySnapshot): string;
  latest(): LiquiditySnapshot | undefined;
}

export interface AssetLiquidity {
  asset: AssetId;
  channelCount: number;
  readyCount: number;
  outbound: string;
  inbound: string;
  maxSend: string;    // largest single ready+enabled channel's local balance
  maxReceive: string; // largest single ready+enabled channel's remote balance
  inFlightOut: string;
  inFlightIn: string;
}
export interface SkewFlag { channelId: Hex; asset: AssetId; localRatioPct: number; flag: "drained" | "full"; }
export interface PeerGroup { peer: Hex; channelCount: number; outbound: string; inbound: string; }
export interface LiquidityReport {
  ts: string;
  assets: AssetLiquidity[];
  skews: SkewFlag[];
  peers: PeerGroup[];
  totalChannels: number;
  excludedChannels: number;
}

export interface LiquidityDiff {
  fromTs: string;
  toTs: string;
  opened: ChannelLiquidity[];
  closed: ChannelLiquidity[];
  balanceDeltas: Array<{ channelId: Hex; asset: AssetId; localDelta: string; remoteDelta: string }>;
  assetDeltas: Array<{ asset: AssetId; outboundDelta: string; inboundDelta: string }>;
}
```

`packages/core/src/liquidity.ts`:

```typescript
import { assetIdOf } from "./asset.js";
import type { RpcChannel } from "./health-types.js";
import type { ChannelLiquidity, LiquiditySnapshot } from "./liquidity-types.js";

const dec = (hex: string): string => BigInt(hex).toString();

export function buildLiquiditySnapshot(channels: RpcChannel[], nodeUrl: string, ts: string): LiquiditySnapshot {
  const normalized: ChannelLiquidity[] = channels.map((c) => ({
    channelId: c.channel_id,
    peer: c.pubkey,
    asset: assetIdOf(c.funding_udt_type_script ?? null),
    state: c.state.state_name,
    enabled: c.enabled,
    isPublic: c.is_public,
    local: dec(c.local_balance),
    remote: dec(c.remote_balance),
    offeredHold: dec(c.offered_tlc_balance),
    receivedHold: dec(c.received_tlc_balance),
    createdAt: dec(c.created_at)
  }));
  return { ts, nodeUrl, channels: normalized };
}
```

`packages/core/src/index.ts` — add after the health exports:

```typescript
export * from "./liquidity-types.js";
export * from "./liquidity.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/liquidity-snapshot.test.ts packages/core/test/health-checks.test.ts && npm run typecheck`
Expected: PASS (health-checks tests unaffected beyond the factory field).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liquidity-types.ts packages/core/src/liquidity.ts packages/core/src/health-types.ts packages/core/src/index.ts packages/core/test/liquidity-fixtures.ts packages/core/test/liquidity-snapshot.test.ts packages/core/test/health-checks.test.ts
git commit -m "feat(core): liquidity snapshot types and RpcChannel normalization"
```

---

### Task 2: computeLiquidityReport — per-asset totals

**Files:**
- Modify: `packages/core/src/liquidity.ts`
- Test: `packages/core/test/liquidity-report.test.ts`

**Interfaces:**
- Consumes: `LiquiditySnapshot`, `AssetLiquidity`, `LiquidityReport` (Task 1).
- Produces: `computeLiquidityReport(snapshot: LiquiditySnapshot): LiquidityReport` (skews/peers arrays exist but are filled in Task 3 — this task returns them empty); internal helper `activeChannels(snapshot)`. Asset ordering: `"CKB"` first, then remaining asset ids lexicographically.

- [ ] **Step 1: Write the failing test**

`packages/core/test/liquidity-report.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeLiquidityReport } from "../src/index.js";
import { liq, snapOf } from "./liquidity-fixtures.js";

describe("computeLiquidityReport — per-asset totals", () => {
  it("sums outbound/inbound and takes max single send/receive over ready+enabled channels", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "1000", remote: "500" }),
      liq({ channelId: "0x02", local: "3000", remote: "4000", offeredHold: "77", receivedHold: "11" })
    ]));
    expect(r.assets).toEqual([{
      asset: "CKB", channelCount: 2, readyCount: 2,
      outbound: "4000", inbound: "4500", maxSend: "3000", maxReceive: "4000",
      inFlightOut: "77", inFlightIn: "11"
    }]);
    expect(r.totalChannels).toBe(2);
    expect(r.excludedChannels).toBe(0);
  });
  it("excludes non-ready and disabled channels from totals but counts them", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "1000" }),
      liq({ channelId: "0x02", local: "9999", state: "AwaitingChannelReady" }),
      liq({ channelId: "0x03", local: "5555", enabled: false })
    ]));
    expect(r.assets[0]).toMatchObject({ channelCount: 3, readyCount: 1, outbound: "1000", maxSend: "1000" });
    expect(r.excludedChannels).toBe(2);
  });
  it("groups per asset with CKB first then lexicographic", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", asset: "udt:0xff:type:0x", local: "10" }),
      liq({ channelId: "0x02", asset: "CKB", local: "20" }),
      liq({ channelId: "0x03", asset: "udt:0xaa:type:0x", local: "30" })
    ]));
    expect(r.assets.map((a) => a.asset)).toEqual(["CKB", "udt:0xaa:type:0x", "udt:0xff:type:0x"]);
  });
  it("returns an empty assets list for an empty snapshot", () => {
    const r = computeLiquidityReport(snapOf([]));
    expect(r.assets).toEqual([]);
    expect(r.totalChannels).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/liquidity-report.test.ts`
Expected: FAIL — `computeLiquidityReport` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/liquidity.ts` (extend the type import with the report types):

```typescript
import type { AssetLiquidity, LiquidityReport } from "./liquidity-types.js";

const READY_STATE = "ChannelReady";

function isActive(c: ChannelLiquidity): boolean {
  return c.state === READY_STATE && c.enabled;
}

const maxBig = (values: bigint[]): bigint => values.reduce((m, v) => (v > m ? v : m), 0n);
const sumBig = (values: bigint[]): bigint => values.reduce((s, v) => s + v, 0n);

function sortAssetKeys(keys: string[]): string[] {
  return keys.sort((a, b) => (a === "CKB" ? -1 : b === "CKB" ? 1 : a < b ? -1 : 1));
}

export function computeLiquidityReport(snapshot: LiquiditySnapshot): LiquidityReport {
  const byAsset = new Map<string, ChannelLiquidity[]>();
  for (const c of snapshot.channels) {
    const group = byAsset.get(c.asset) ?? [];
    group.push(c);
    byAsset.set(c.asset, group);
  }
  const assets: AssetLiquidity[] = sortAssetKeys([...byAsset.keys()]).map((asset) => {
    const all = byAsset.get(asset)!;
    const active = all.filter(isActive);
    return {
      asset,
      channelCount: all.length,
      readyCount: active.length,
      outbound: sumBig(active.map((c) => BigInt(c.local))).toString(),
      inbound: sumBig(active.map((c) => BigInt(c.remote))).toString(),
      maxSend: maxBig(active.map((c) => BigInt(c.local))).toString(),
      maxReceive: maxBig(active.map((c) => BigInt(c.remote))).toString(),
      inFlightOut: sumBig(active.map((c) => BigInt(c.offeredHold))).toString(),
      inFlightIn: sumBig(active.map((c) => BigInt(c.receivedHold))).toString()
    };
  });
  const activeCount = snapshot.channels.filter(isActive).length;
  return {
    ts: snapshot.ts,
    assets,
    skews: [],
    peers: [],
    totalChannels: snapshot.channels.length,
    excludedChannels: snapshot.channels.length - activeCount
  };
}
```

(Merge the added type import into the existing `./liquidity-types.js` import line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/liquidity-report.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liquidity.ts packages/core/test/liquidity-report.test.ts
git commit -m "feat(core): per-asset liquidity totals with ready+enabled filtering"
```

---

### Task 3: computeLiquidityReport — skew flags and peer groups

**Files:**
- Modify: `packages/core/src/liquidity.ts`
- Test: `packages/core/test/liquidity-report.test.ts` (append)

**Interfaces:**
- Consumes: `liq()`/`snapOf()` fixtures (exported from the Task 2 test file), `SkewFlag`/`PeerGroup` types.
- Produces: `SKEW_DRAINED_PCT = 10` and `SKEW_FULL_PCT = 90` (exported constants); `computeLiquidityReport` now fills `skews` (active channels only, strict inequality, zero-capacity skipped, `localRatioPct` = integer percent via bigint math) and `peers` (active channels grouped by peer, sorted by outbound descending, ties by peer ascending).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/liquidity-report.test.ts`:

```typescript
import { SKEW_DRAINED_PCT, SKEW_FULL_PCT } from "../src/index.js";

describe("computeLiquidityReport — skew flags", () => {
  it("flags drained (<10% local) and full (>90% local) channels", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "50", remote: "950" }),   // 5% -> drained
      liq({ channelId: "0x02", local: "950", remote: "50" }),   // 95% -> full
      liq({ channelId: "0x03", local: "500", remote: "500" })   // 50% -> no flag
    ]));
    expect(r.skews).toEqual([
      { channelId: "0x01", asset: "CKB", localRatioPct: 5, flag: "drained" },
      { channelId: "0x02", asset: "CKB", localRatioPct: 95, flag: "full" }
    ]);
  });
  it("does not flag exactly at the thresholds (strict inequality)", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "100", remote: "900" }),  // exactly 10%
      liq({ channelId: "0x02", local: "900", remote: "100" })   // exactly 90%
    ]));
    expect(r.skews).toEqual([]);
    expect(SKEW_DRAINED_PCT).toBe(10);
    expect(SKEW_FULL_PCT).toBe(90);
  });
  it("skips zero-capacity channels and inactive channels", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "0", remote: "0" }),
      liq({ channelId: "0x02", local: "1", remote: "999", enabled: false })
    ]));
    expect(r.skews).toEqual([]);
  });
});

describe("computeLiquidityReport — peer groups", () => {
  it("groups active channels by counterparty, sorted by outbound descending", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", peer: "0x02aa", local: "100", remote: "1" }),
      liq({ channelId: "0x02", peer: "0x02bb", local: "900", remote: "2" }),
      liq({ channelId: "0x03", peer: "0x02aa", local: "50", remote: "3" }),
      liq({ channelId: "0x04", peer: "0x02cc", local: "5", state: "AwaitingChannelReady" })
    ]));
    expect(r.peers).toEqual([
      { peer: "0x02bb", channelCount: 1, outbound: "900", inbound: "2" },
      { peer: "0x02aa", channelCount: 2, outbound: "150", inbound: "4" }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/liquidity-report.test.ts`
Expected: FAIL — `SKEW_DRAINED_PCT` not exported; `skews`/`peers` empty.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/liquidity.ts`, add the constants and two builders, and replace the `skews: []`/`peers: []` lines in `computeLiquidityReport` with calls:

```typescript
import type { PeerGroup, SkewFlag } from "./liquidity-types.js"; // merge into existing import

export const SKEW_DRAINED_PCT = 10;
export const SKEW_FULL_PCT = 90;

function buildSkews(channels: ChannelLiquidity[]): SkewFlag[] {
  const out: SkewFlag[] = [];
  for (const c of channels.filter(isActive)) {
    const local = BigInt(c.local), total = BigInt(c.local) + BigInt(c.remote);
    if (total === 0n) continue;
    const pct = Number((local * 100n) / total);
    if (pct < SKEW_DRAINED_PCT) out.push({ channelId: c.channelId, asset: c.asset, localRatioPct: pct, flag: "drained" });
    else if (pct > SKEW_FULL_PCT) out.push({ channelId: c.channelId, asset: c.asset, localRatioPct: pct, flag: "full" });
  }
  return out;
}

function buildPeerGroups(channels: ChannelLiquidity[]): PeerGroup[] {
  const byPeer = new Map<string, ChannelLiquidity[]>();
  for (const c of channels.filter(isActive)) {
    const group = byPeer.get(c.peer) ?? [];
    group.push(c);
    byPeer.set(c.peer, group);
  }
  return [...byPeer.entries()]
    .map(([peer, group]) => ({
      peer,
      channelCount: group.length,
      outbound: sumBig(group.map((c) => BigInt(c.local))).toString(),
      inbound: sumBig(group.map((c) => BigInt(c.remote))).toString()
    }))
    .sort((a, b) => {
      const d = BigInt(b.outbound) - BigInt(a.outbound);
      return d > 0n ? 1 : d < 0n ? -1 : a.peer < b.peer ? -1 : 1;
    });
}
```

In `computeLiquidityReport`'s return: `skews: buildSkews(snapshot.channels)`, `peers: buildPeerGroups(snapshot.channels)`.

Note on the 90%-boundary test: `900/1000` = exactly 90 → not flagged; `950/1000` = 95 → flagged. Integer bigint division floors, which only ever rounds pct DOWN — safe for both strict comparisons.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/liquidity-report.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liquidity.ts packages/core/test/liquidity-report.test.ts
git commit -m "feat(core): liquidity skew flags and per-peer grouping"
```

---

### Task 4: diffSnapshots

**Files:**
- Create: `packages/core/src/liquidity-diff.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./liquidity-diff.js";`)
- Test: `packages/core/test/liquidity-diff.test.ts`

**Interfaces:**
- Consumes: `LiquiditySnapshot`, `LiquidityDiff` (Task 1), `computeLiquidityReport` (Tasks 2–3, reused for asset deltas).
- Produces: `diffSnapshots(prev: LiquiditySnapshot, next: LiquiditySnapshot): LiquidityDiff` — channels matched by `channelId`; zero-delta channels omitted from `balanceDeltas`; `assetDeltas` from the two reports' per-asset outbound/inbound (assets present in either side; zero-delta assets omitted); deltas are signed decimal strings.

- [ ] **Step 1: Write the failing test**

`packages/core/test/liquidity-diff.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { diffSnapshots } from "../src/index.js";
import { liq, snapOf } from "./liquidity-fixtures.js";

describe("diffSnapshots", () => {
  it("reports opened, closed, and signed balance deltas; omits unchanged channels", () => {
    const prev = { ...snapOf([
      liq({ channelId: "0x01", local: "1000", remote: "500" }),
      liq({ channelId: "0x02", local: "700", remote: "700" }),
      liq({ channelId: "0x03", local: "10", remote: "10" })
    ]), ts: "T0" };
    const next = { ...snapOf([
      liq({ channelId: "0x01", local: "800", remote: "700" }),   // moved 200 across
      liq({ channelId: "0x02", local: "700", remote: "700" }),   // unchanged
      liq({ channelId: "0x04", local: "5000", remote: "0" })     // opened
    ]), ts: "T1" };
    const d = diffSnapshots(prev, next);
    expect(d.fromTs).toBe("T0");
    expect(d.toTs).toBe("T1");
    expect(d.opened.map((c) => c.channelId)).toEqual(["0x04"]);
    expect(d.closed.map((c) => c.channelId)).toEqual(["0x03"]);
    expect(d.balanceDeltas).toEqual([
      { channelId: "0x01", asset: "CKB", localDelta: "-200", remoteDelta: "200" }
    ]);
  });
  it("emits asset deltas including assets that appear or disappear entirely", () => {
    const prev = { ...snapOf([liq({ channelId: "0x01", asset: "udt:0xcc:type:0x", local: "100", remote: "0" })]), ts: "T0" };
    const next = { ...snapOf([liq({ channelId: "0x02", asset: "CKB", local: "300", remote: "40" })]), ts: "T1" };
    const d = diffSnapshots(prev, next);
    expect(d.assetDeltas).toEqual([
      { asset: "CKB", outboundDelta: "300", inboundDelta: "40" },
      { asset: "udt:0xcc:type:0x", outboundDelta: "-100", inboundDelta: "0" }
    ]);
  });
  it("returns all-empty collections for identical snapshots", () => {
    const s = snapOf([liq({ channelId: "0x01" })]);
    const d = diffSnapshots({ ...s, ts: "T0" }, { ...s, ts: "T1" });
    expect(d.opened).toEqual([]);
    expect(d.closed).toEqual([]);
    expect(d.balanceDeltas).toEqual([]);
    expect(d.assetDeltas).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/liquidity-diff.test.ts`
Expected: FAIL — `diffSnapshots` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/liquidity-diff.ts`:

```typescript
import { computeLiquidityReport } from "./liquidity.js";
import type { LiquidityDiff, LiquiditySnapshot } from "./liquidity-types.js";

export function diffSnapshots(prev: LiquiditySnapshot, next: LiquiditySnapshot): LiquidityDiff {
  const prevById = new Map(prev.channels.map((c) => [c.channelId, c]));
  const nextById = new Map(next.channels.map((c) => [c.channelId, c]));

  const opened = next.channels.filter((c) => !prevById.has(c.channelId));
  const closed = prev.channels.filter((c) => !nextById.has(c.channelId));

  const balanceDeltas = next.channels
    .filter((c) => prevById.has(c.channelId))
    .map((c) => {
      const p = prevById.get(c.channelId)!;
      return {
        channelId: c.channelId,
        asset: c.asset,
        localDelta: (BigInt(c.local) - BigInt(p.local)).toString(),
        remoteDelta: (BigInt(c.remote) - BigInt(p.remote)).toString()
      };
    })
    .filter((d) => d.localDelta !== "0" || d.remoteDelta !== "0");

  const prevAssets = new Map(computeLiquidityReport(prev).assets.map((a) => [a.asset, a]));
  const nextAssets = new Map(computeLiquidityReport(next).assets.map((a) => [a.asset, a]));
  const assetKeys = [...new Set([...prevAssets.keys(), ...nextAssets.keys()])]
    .sort((a, b) => (a === "CKB" ? -1 : b === "CKB" ? 1 : a < b ? -1 : 1));
  const assetDeltas = assetKeys
    .map((asset) => {
      const p = prevAssets.get(asset);
      const n = nextAssets.get(asset);
      return {
        asset,
        outboundDelta: (BigInt(n?.outbound ?? "0") - BigInt(p?.outbound ?? "0")).toString(),
        inboundDelta: (BigInt(n?.inbound ?? "0") - BigInt(p?.inbound ?? "0")).toString()
      };
    })
    .filter((d) => d.outboundDelta !== "0" || d.inboundDelta !== "0");

  return { fromTs: prev.ts, toTs: next.ts, opened, closed, balanceDeltas, assetDeltas };
}
```

Add to `packages/core/src/index.ts`: `export * from "./liquidity-diff.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/liquidity-diff.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liquidity-diff.ts packages/core/src/index.ts packages/core/test/liquidity-diff.test.ts
git commit -m "feat(core): snapshot diffing (opened/closed/balance/asset deltas)"
```

---

### Task 5: formatLiquidityText

**Files:**
- Create: `packages/core/src/liquidity-format.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./liquidity-format.js";`)
- Test: `packages/core/test/liquidity-format.test.ts`

**Interfaces:**
- Consumes: `LiquidityReport`, `LiquiditySnapshot`, `SkewFlag` types.
- Produces: `formatLiquidityText(report: LiquidityReport, snapshot: LiquiditySnapshot): string` (needs the snapshot for per-channel rows); helper `bar(pct: number): string` (module-internal, `BAR_CELLS = 10`, filled = `Math.round(pct / 10)`).

- [ ] **Step 1: Write the failing test**

`packages/core/test/liquidity-format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeLiquidityReport, formatLiquidityText } from "../src/index.js";
import { liq, snapOf } from "./liquidity-fixtures.js";

describe("formatLiquidityText", () => {
  it("renders per-asset headline, channel bars, skew and excluded annotations, and peers", () => {
    const snapshot = snapOf([
      liq({ channelId: "0xaabbccddee01", peer: "0x02aa", local: "300", remote: "700" }),          // 30%
      liq({ channelId: "0xaabbccddee02", peer: "0x02bb", local: "50", remote: "950" }),           // 5% drained
      liq({ channelId: "0xaabbccddee03", peer: "0x02cc", local: "10", state: "AwaitingChannelReady" })
    ]);
    const out = formatLiquidityText(computeLiquidityReport(snapshot), snapshot);
    expect(out).toContain("3 channels (1 excluded)");
    expect(out).toContain("CKB: out 350 | in 1650 | max send 300 | max receive 950");
    expect(out).toContain("[███░░░░░░░] 30%");
    expect(out).toContain("[█░░░░░░░░░] 5%");   // Math.round(5/10) = 1 filled cell
    expect(out).toContain("drained");
    expect(out).toContain("excluded: AwaitingChannelReady");
    expect(out).toContain("peer 0x02bb");
  });
  it("renders in-flight holds only when non-zero", () => {
    const withHold = snapOf([liq({ offeredHold: "42" })]);
    const noHold = snapOf([liq()]);
    expect(formatLiquidityText(computeLiquidityReport(withHold), withHold)).toContain("in-flight out 42");
    expect(formatLiquidityText(computeLiquidityReport(noHold), noHold)).not.toContain("in-flight");
  });
  it("renders the explicit empty-node message", () => {
    const empty = snapOf([]);
    expect(formatLiquidityText(computeLiquidityReport(empty), empty)).toContain("no channels — nothing to snapshot");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/liquidity-format.test.ts`
Expected: FAIL — `formatLiquidityText` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/liquidity-format.ts`:

```typescript
import type { ChannelLiquidity, LiquidityReport, LiquiditySnapshot, SkewFlag } from "./liquidity-types.js";

const BAR_CELLS = 10;
const shortId = (h: string): string => (h.length > 12 ? `${h.slice(0, 12)}…` : h);

function bar(pct: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(pct / BAR_CELLS)));
  return `[${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}]`;
}

function ratioPct(c: ChannelLiquidity): number | null {
  const total = BigInt(c.local) + BigInt(c.remote);
  if (total === 0n) return null;
  return Number((BigInt(c.local) * 100n) / total);
}

export function formatLiquidityText(report: LiquidityReport, snapshot: LiquiditySnapshot): string {
  if (snapshot.channels.length === 0) return "no channels — nothing to snapshot";
  const skewById = new Map<string, SkewFlag>(report.skews.map((s) => [s.channelId, s]));
  const lines: string[] = [`Channel liquidity — ${report.ts} — ${report.totalChannels} channels (${report.excludedChannels} excluded)`];
  for (const a of report.assets) {
    let head = `${a.asset}: out ${a.outbound} | in ${a.inbound} | max send ${a.maxSend} | max receive ${a.maxReceive}`;
    if (a.inFlightOut !== "0" || a.inFlightIn !== "0") head += ` | in-flight out ${a.inFlightOut} / in ${a.inFlightIn}`;
    lines.push(head);
    for (const c of snapshot.channels.filter((ch) => ch.asset === a.asset)) {
      const active = c.state === "ChannelReady" && c.enabled;
      if (!active) {
        lines.push(` ${shortId(c.channelId)} excluded: ${!c.enabled && c.state === "ChannelReady" ? "disabled" : c.state}`);
        continue;
      }
      const pct = ratioPct(c);
      const skew = skewById.get(c.channelId);
      const pctPart = pct === null ? "(zero capacity)" : `${bar(pct)} ${pct}% local`;
      lines.push(` ${shortId(c.channelId)} ${pctPart}  local ${c.local} / remote ${c.remote}  peer ${shortId(c.peer)}${skew ? `  ⚠ ${skew.flag}` : ""}`);
    }
  }
  if (report.peers.length) {
    lines.push("peers:");
    for (const p of report.peers) lines.push(` peer ${shortId(p.peer)} — ${p.channelCount} channel(s), out ${p.outbound}, in ${p.inbound}`);
  }
  return lines.join("\n");
}
```

Add to `packages/core/src/index.ts`: `export * from "./liquidity-format.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/liquidity-format.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liquidity-format.ts packages/core/src/index.ts packages/core/test/liquidity-format.test.ts
git commit -m "feat(core): liquidity report text formatter with channel bars"
```

---

### Task 6: formatLiquidityDiff

**Files:**
- Modify: `packages/core/src/liquidity-format.ts`
- Test: `packages/core/test/liquidity-format.test.ts` (append)

**Interfaces:**
- Consumes: `LiquidityDiff` (Task 1), `shortId` helper (Task 5).
- Produces: `formatLiquidityDiff(diff: LiquidityDiff): string` — signed deltas rendered with explicit `+`/`-`; `"no changes"` when all collections empty.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/liquidity-format.test.ts`:

```typescript
import { diffSnapshots, formatLiquidityDiff } from "../src/index.js";

describe("formatLiquidityDiff", () => {
  it("renders opened/closed channels and signed deltas", () => {
    // ids stay <= 12 chars so shortId passes them through unshortened and each stays distinct
    const prev = { ...snapOf([liq({ channelId: "0x01", local: "1000", remote: "0" }), liq({ channelId: "0x03", local: "7", remote: "7" })]), ts: "T0" };
    const next = { ...snapOf([liq({ channelId: "0x01", local: "800", remote: "200" }), liq({ channelId: "0x02", local: "50", remote: "0" })]), ts: "T1" };
    const out = formatLiquidityDiff(diffSnapshots(prev, next));
    expect(out).toContain("T0 → T1");
    expect(out).toContain("+ opened 0x02 (CKB, local 50)");
    expect(out).toContain("- closed 0x03 (CKB)");
    expect(out).toContain("Δ 0x01 local -200, remote +200");
    expect(out).toContain("Δ CKB out -157, in +193");
  });
  it("says no changes for identical snapshots", () => {
    const s = snapOf([liq()]);
    const out = formatLiquidityDiff(diffSnapshots({ ...s, ts: "T0" }, { ...s, ts: "T1" }));
    expect(out).toContain("no changes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/liquidity-format.test.ts`
Expected: FAIL — `formatLiquidityDiff` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/liquidity-format.ts` (extend the type import with `LiquidityDiff`):

```typescript
const signed = (v: string): string => (v.startsWith("-") ? v : `+${v}`);

export function formatLiquidityDiff(diff: LiquidityDiff): string {
  const lines: string[] = [`Liquidity diff ${diff.fromTs} → ${diff.toTs}`];
  for (const c of diff.opened) lines.push(` + opened ${shortId(c.channelId)} (${c.asset}, local ${c.local})`);
  for (const c of diff.closed) lines.push(` - closed ${shortId(c.channelId)} (${c.asset})`);
  for (const d of diff.balanceDeltas) lines.push(` Δ ${shortId(d.channelId)} local ${signed(d.localDelta)}, remote ${signed(d.remoteDelta)}`);
  for (const a of diff.assetDeltas) lines.push(` Δ ${a.asset} out ${signed(a.outboundDelta)}, in ${signed(a.inboundDelta)}`);
  if (lines.length === 1) lines.push(" no changes");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/liquidity-format.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/liquidity-format.ts packages/core/test/liquidity-format.test.ts
git commit -m "feat(core): liquidity diff text formatter"
```

---

### Task 7: NodeFsSnapshotStore (CLI)

**Files:**
- Create: `apps/cli/src/snapshot-store.ts`
- Test: `apps/cli/test/snapshot-store.test.ts`

**Interfaces:**
- Consumes: `LiquiditySnapshot`, `SnapshotStore` from `@fiber-route-doctor/core`.
- Produces: `class NodeFsSnapshotStore implements SnapshotStore` with `constructor(dir: string)` — files named `<ts with ":" replaced by "-">.json`, written 0600 via atomic temp+rename (mirrors `NodeFsTokenStore`); `latest()` = lexicographically greatest `.json` filename (ISO timestamps sort chronologically).

- [ ] **Step 1: Write the failing test**

`apps/cli/test/snapshot-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFsSnapshotStore } from "../src/snapshot-store.js";
import type { LiquiditySnapshot } from "@fiber-route-doctor/core";

const snap = (ts: string): LiquiditySnapshot => ({ ts, nodeUrl: "http://n:8231", channels: [] });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "frd-snap-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("NodeFsSnapshotStore", () => {
  it("round-trips a snapshot with a filesystem-safe name and 0600 mode", () => {
    const store = new NodeFsSnapshotStore(dir);
    const name = store.put(snap("2026-07-03T10:00:00.000Z"));
    expect(name).toBe("2026-07-03T10-00-00.000Z.json");
    expect(store.get(name)).toEqual(snap("2026-07-03T10:00:00.000Z"));
    expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false); // atomic: no temp left behind
  });
  it("list() sorts and latest() returns the newest snapshot", () => {
    const store = new NodeFsSnapshotStore(dir);
    store.put(snap("2026-07-03T10:00:00.000Z"));
    store.put(snap("2026-07-01T10:00:00.000Z"));
    store.put(snap("2026-07-02T10:00:00.000Z"));
    expect(store.list()).toHaveLength(3);
    expect(store.latest()?.ts).toBe("2026-07-03T10:00:00.000Z");
  });
  it("returns empty/undefined when the directory does not exist yet", () => {
    const store = new NodeFsSnapshotStore(join(dir, "never-created"));
    expect(store.list()).toEqual([]);
    expect(store.latest()).toBeUndefined();
    expect(store.get("nope.json")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/test/snapshot-store.test.ts`
Expected: FAIL — no `snapshot-store.js`.

- [ ] **Step 3: Write minimal implementation**

`apps/cli/src/snapshot-store.ts`:

```typescript
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LiquiditySnapshot, SnapshotStore } from "@fiber-route-doctor/core";

export class NodeFsSnapshotStore implements SnapshotStore {
  constructor(private readonly dir: string) {}

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).sort();
  }

  get(name: string): LiquiditySnapshot | undefined {
    const path = join(this.dir, name);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as LiquiditySnapshot;
  }

  put(s: LiquiditySnapshot): string {
    mkdirSync(this.dir, { recursive: true });
    const name = `${s.ts.replaceAll(":", "-")}.json`;
    const path = join(this.dir, name);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return name;
  }

  latest(): LiquiditySnapshot | undefined {
    const names = this.list();
    return names.length ? this.get(names[names.length - 1]) : undefined;
  }
}
```

Note: `get(name)` is only ever called with names produced by `list()`/`put()` in this CLI; it is not exposed to user input (no path-traversal surface).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/snapshot-store.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/snapshot-store.ts apps/cli/test/snapshot-store.test.ts
git commit -m "feat(cli): atomic 0600 filesystem snapshot store"
```

---

### Task 8: CLI liquidity args and dispatch

**Files:**
- Create: `apps/cli/src/commands/liquidity.ts` (args parsing only in this task)
- Modify: `apps/cli/src/dispatch.ts`
- Test: `apps/cli/test/liquidity-args.test.ts`, `apps/cli/test/dispatch.test.ts` (append one case)

**Interfaces:**
- Consumes: flag-parsing loop pattern from `apps/cli/src/commands/health.ts`.
- Produces: `interface LiquidityArgs { url: string; biscuit?: string; profile?: string; authTokenFile?: string; json: boolean; save: boolean; diff: boolean; }`; `parseLiquidityArgs(rest: string[]): LiquidityArgs` (throws on missing `--url`); dispatch accepts `"liquidity"`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/liquidity-args.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseLiquidityArgs } from "../src/commands/liquidity.js";

describe("parseLiquidityArgs", () => {
  it("parses url, token flags, and booleans", () => {
    const a = parseLiquidityArgs(["--url", "http://n:8231", "--profile", "dt", "--json", "--save", "--diff"]);
    expect(a).toEqual({ url: "http://n:8231", biscuit: undefined, profile: "dt", authTokenFile: undefined, json: true, save: true, diff: true });
  });
  it("defaults booleans to false", () => {
    expect(parseLiquidityArgs(["--url", "u"])).toMatchObject({ json: false, save: false, diff: false });
  });
  it("requires --url", () => {
    expect(() => parseLiquidityArgs([])).toThrow(/--url/);
  });
});
```

Append to `apps/cli/test/dispatch.test.ts` (inside the existing describe):

```typescript
  it("routes the liquidity command", () => {
    expect(parseCommand(["liquidity", "--url", "u"])).toEqual({ command: "liquidity", rest: ["--url", "u"] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/cli/test/liquidity-args.test.ts apps/cli/test/dispatch.test.ts`
Expected: FAIL — no `commands/liquidity.js`; dispatch rejects `liquidity`.

- [ ] **Step 3: Write minimal implementation**

`apps/cli/src/dispatch.ts` — extend the union and list:

```typescript
export type Command = "diagnose" | "keys" | "token" | "health" | "liquidity";
const COMMANDS: Command[] = ["diagnose", "keys", "token", "health", "liquidity"];
```

(The `parseCommand` body is unchanged.)

`apps/cli/src/commands/liquidity.ts`:

```typescript
export interface LiquidityArgs {
  url: string; biscuit?: string; profile?: string; authTokenFile?: string;
  json: boolean; save: boolean; diff: boolean;
}

export function parseLiquidityArgs(rest: string[]): LiquidityArgs {
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
    json: bools.has("json"), save: bools.has("save"), diff: bools.has("diff")
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/liquidity-args.test.ts apps/cli/test/dispatch.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/liquidity.ts apps/cli/src/dispatch.ts apps/cli/test/liquidity-args.test.ts apps/cli/test/dispatch.test.ts
git commit -m "feat(cli): liquidity command args parsing and dispatch"
```

---

### Task 9: runLiquidity with save/diff, wired into main

**Files:**
- Modify: `apps/cli/src/commands/liquidity.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/liquidity-run.test.ts`

**Interfaces:**
- Consumes: `parseLiquidityArgs` (Task 8); `HealthClient`, `buildLiquiditySnapshot`, `computeLiquidityReport`, `diffSnapshots`, `formatLiquidityText`, `formatLiquidityDiff`, `RpcChannel`, `SnapshotStore` from core; `NodeFsSnapshotStore` (Task 7); `resolveToken`/`NodeFsTokenStore` from `@fiber-route-doctor/biscuit` (same wiring as the health command).
- Produces: `runLiquidity(rest: string[], deps?: LiquidityDeps): Promise<number>` where `LiquidityDeps = { fetchChannels?: (args: LiquidityArgs) => Promise<RpcChannel[]>; store?: SnapshotStore; print?: (s: string) => void; now?: () => Date }`. Behavior: parse errors print + return 2; probe → snapshot → report; `--diff` with no saved snapshot prints `no saved snapshot to diff against — run with --save first` and returns 2; `--diff` renders report then diff (vs latest saved, BEFORE saving); `--save` persists after rendering and prints `saved <name>` (non-JSON mode); `--json` prints `{ report, snapshot, diff? }`. Returns 0 on success. main.ts wires `if (command === "liquidity") process.exit(await runLiquidity(rest));`.

- [ ] **Step 1: Write the failing test**

`apps/cli/test/liquidity-run.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runLiquidity } from "../src/commands/liquidity.js";
import type { LiquiditySnapshot, RpcChannel, SnapshotStore } from "@fiber-route-doctor/core";

const CHAN: RpcChannel = {
  channel_id: "0x01", pubkey: "0x02aa", state: { state_name: "ChannelReady" },
  local_balance: "0x3e8", remote_balance: "0x7d0", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
  enabled: true, is_public: true, pending_tlcs: [], created_at: "0x1", funding_udt_type_script: null, failure_detail: null
};

function memStore(initial?: LiquiditySnapshot): SnapshotStore & { saved: LiquiditySnapshot[] } {
  const saved: LiquiditySnapshot[] = initial ? [initial] : [];
  return {
    saved,
    list: () => saved.map((s) => `${s.ts}.json`),
    get: (name) => saved.find((s) => `${s.ts}.json` === name),
    put: (s) => { saved.push(s); return `${s.ts}.json`; },
    latest: () => saved[saved.length - 1]
  };
}
function deps(store = memStore()) {
  return {
    fetchChannels: vi.fn(async () => [CHAN]),
    store,
    print: vi.fn(),
    now: () => new Date("2026-07-03T12:00:00.000Z")
  };
}

describe("runLiquidity", () => {
  it("prints the report and returns 0", async () => {
    const d = deps();
    expect(await runLiquidity(["--url", "http://n/"], d)).toBe(0);
    expect(String(d.print.mock.calls[0][0])).toContain("Channel liquidity");
  });
  it("--save persists the snapshot and announces the filename", async () => {
    const d = deps();
    await runLiquidity(["--url", "http://n/", "--save"], d);
    expect(d.store.saved).toHaveLength(1);
    expect(d.store.saved[0].ts).toBe("2026-07-03T12:00:00.000Z");
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("saved 2026-07-03T12:00:00.000Z.json");
  });
  it("--diff renders a diff against the latest saved snapshot", async () => {
    const prev: LiquiditySnapshot = {
      ts: "2026-07-01T00:00:00.000Z", nodeUrl: "http://n/",
      channels: [{ channelId: "0x01", peer: "0x02aa", asset: "CKB", state: "ChannelReady", enabled: true, isPublic: true, local: "500", remote: "2500", offeredHold: "0", receivedHold: "0", createdAt: "1" }]
    };
    const d = deps(memStore(prev));
    expect(await runLiquidity(["--url", "http://n/", "--diff"], d)).toBe(0);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Liquidity diff");
    expect(printed).toContain("local +500");
  });
  it("--diff with no saved snapshot errors with guidance and exit 2", async () => {
    const d = deps();
    expect(await runLiquidity(["--url", "http://n/", "--diff"], d)).toBe(2);
    expect(String(d.print.mock.calls[0][0])).toContain("run with --save first");
  });
  it("--diff --save diffs against the PREVIOUS latest, then saves the new one", async () => {
    const prev: LiquiditySnapshot = { ts: "2026-07-01T00:00:00.000Z", nodeUrl: "http://n/", channels: [] };
    const d = deps(memStore(prev));
    await runLiquidity(["--url", "http://n/", "--diff", "--save"], d);
    expect(d.store.saved).toHaveLength(2);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("+ opened");
  });
  it("--json emits parseable {report, snapshot} and includes diff when requested", async () => {
    const d = deps(memStore({ ts: "T0", nodeUrl: "u", channels: [] }));
    await runLiquidity(["--url", "http://n/", "--json", "--diff"], d);
    const body = JSON.parse(String(d.print.mock.calls[0][0]));
    expect(body.report.assets[0].asset).toBe("CKB");
    expect(body.snapshot.channels).toHaveLength(1);
    expect(body.diff.opened).toHaveLength(1);
  });
  it("returns 2 and prints the usage error for bad args", async () => {
    const d = deps();
    expect(await runLiquidity([], d)).toBe(2);
    expect(String(d.print.mock.calls[0][0])).toContain("--url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/test/liquidity-run.test.ts`
Expected: FAIL — `runLiquidity` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/cli/src/commands/liquidity.ts`:

```typescript
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HealthClient, buildLiquiditySnapshot, computeLiquidityReport, diffSnapshots,
  formatLiquidityDiff, formatLiquidityText, type RpcChannel, type SnapshotStore
} from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";
import { NodeFsSnapshotStore } from "../snapshot-store.js";

const CFG = join(homedir(), ".config", "fiber-route-doctor");
const PROFILES = join(CFG, "profiles.json");
const SNAPSHOTS_DIR = join(CFG, "snapshots");

function defaultFetchChannels(args: LiquidityArgs): Promise<RpcChannel[]> {
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  return new HealthClient({ url: args.url, biscuit: token }).listChannels();
}

export interface LiquidityDeps {
  fetchChannels?: (args: LiquidityArgs) => Promise<RpcChannel[]>;
  store?: SnapshotStore;
  print?: (s: string) => void;
  now?: () => Date;
}

export async function runLiquidity(rest: string[], deps: LiquidityDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  let args: LiquidityArgs;
  try {
    args = parseLiquidityArgs(rest);
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const store = deps.store ?? new NodeFsSnapshotStore(SNAPSHOTS_DIR);
  const fetchChannels = deps.fetchChannels ?? defaultFetchChannels;
  const now = deps.now ?? (() => new Date());

  const prev = args.diff ? store.latest() : undefined;
  if (args.diff && !prev) {
    print("no saved snapshot to diff against — run with --save first");
    return 2;
  }

  const channels = await fetchChannels(args);
  const snapshot = buildLiquiditySnapshot(channels, args.url, now().toISOString());
  const report = computeLiquidityReport(snapshot);
  const diff = prev ? diffSnapshots(prev, snapshot) : undefined;

  if (args.json) {
    print(JSON.stringify({ report, snapshot, ...(diff ? { diff } : {}) }, null, 2));
  } else {
    print(formatLiquidityText(report, snapshot));
    if (diff) print(formatLiquidityDiff(diff));
  }
  if (args.save) {
    const name = store.put(snapshot);
    if (!args.json) print(`saved ${name}`);
  }
  return 0;
}
```

`apps/cli/src/main.ts` — add the import and the dispatch line next to the health one:

```typescript
import { runLiquidity } from "./commands/liquidity.js";
// ... inside main(), after the health line:
  if (command === "liquidity") process.exit(await runLiquidity(rest));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/liquidity-run.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/liquidity.ts apps/cli/src/main.ts apps/cli/test/liquidity-run.test.ts
git commit -m "feat(cli): liquidity command with --save/--diff snapshot workflow"
```

---

### Task 10: Web liquidity panel

**Files:**
- Create: `apps/web/src/liquidity-view.ts`
- Create: `apps/web/src/LiquidityPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/test/liquidity-view.test.ts`

**Interfaces:**
- Consumes: `LiquidityReport`, `LiquiditySnapshot`, `computeLiquidityReport`, `buildLiquiditySnapshot`, `HealthClient` from core.
- Produces: `interface LiquidityCard { asset: string; outbound: string; inbound: string; maxSend: string; maxReceive: string; }`; `interface LiquidityRow { channelId: string; peer: string; asset: string; pct: number | null; barColor: string; flag?: "drained" | "full"; excluded: boolean; local: string; remote: string; }`; `interface LiquidityView { cards: LiquidityCard[]; rows: LiquidityRow[]; empty: boolean; }`; `buildLiquidityView(report: LiquidityReport, snapshot: LiquiditySnapshot): LiquidityView`; `<LiquidityPanel />` React component (manual Probe only, busy-disabled button, token input `type="password"`).

- [ ] **Step 1: Write the failing test**

`apps/web/test/liquidity-view.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLiquidityView } from "../src/liquidity-view.js";
import { computeLiquidityReport, type ChannelLiquidity, type LiquiditySnapshot } from "@fiber-route-doctor/core";

function liq(over: Partial<ChannelLiquidity> = {}): ChannelLiquidity {
  return {
    channelId: "0x01", peer: "0x02aa", asset: "CKB", state: "ChannelReady",
    enabled: true, isPublic: true, local: "300", remote: "700",
    offeredHold: "0", receivedHold: "0", createdAt: "1", ...over
  };
}
const snapOf = (channels: ChannelLiquidity[]): LiquiditySnapshot => ({ ts: "T", nodeUrl: "u", channels });

describe("buildLiquidityView", () => {
  it("builds cards per asset and bar rows with percent and colors", () => {
    const s = snapOf([liq(), liq({ channelId: "0x02", local: "20", remote: "980" })]);
    const v = buildLiquidityView(computeLiquidityReport(s), s);
    expect(v.empty).toBe(false);
    expect(v.cards).toEqual([{ asset: "CKB", outbound: "320", inbound: "1680", maxSend: "300", maxReceive: "980" }]);
    expect(v.rows[0]).toMatchObject({ pct: 30, barColor: "#2ecc71", excluded: false });
    expect(v.rows[1]).toMatchObject({ pct: 2, flag: "drained", barColor: "#e74c3c" });
  });
  it("marks excluded channels grey with null-safe pct and flags full channels amber", () => {
    const s = snapOf([
      liq({ channelId: "0x03", state: "AwaitingChannelReady" }),
      liq({ channelId: "0x04", local: "990", remote: "10" })
    ]);
    const v = buildLiquidityView(computeLiquidityReport(s), s);
    expect(v.rows[0]).toMatchObject({ excluded: true, barColor: "#7f8c8d" });
    expect(v.rows[1]).toMatchObject({ flag: "full", barColor: "#f1c40f" });
  });
  it("flags empty snapshots", () => {
    const s = snapOf([]);
    expect(buildLiquidityView(computeLiquidityReport(s), s).empty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/test/liquidity-view.test.ts`
Expected: FAIL — no `liquidity-view.js`.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/liquidity-view.ts`:

```typescript
import type { ChannelLiquidity, LiquidityReport, LiquiditySnapshot } from "@fiber-route-doctor/core";

const COLOR = { ok: "#2ecc71", drained: "#e74c3c", full: "#f1c40f", excluded: "#7f8c8d" } as const;

export interface LiquidityCard { asset: string; outbound: string; inbound: string; maxSend: string; maxReceive: string; }
export interface LiquidityRow {
  channelId: string; peer: string; asset: string; pct: number | null;
  barColor: string; flag?: "drained" | "full"; excluded: boolean; local: string; remote: string;
}
export interface LiquidityView { cards: LiquidityCard[]; rows: LiquidityRow[]; empty: boolean; }

function pctOf(c: ChannelLiquidity): number | null {
  const total = BigInt(c.local) + BigInt(c.remote);
  return total === 0n ? null : Number((BigInt(c.local) * 100n) / total);
}

export function buildLiquidityView(report: LiquidityReport, snapshot: LiquiditySnapshot): LiquidityView {
  const flagById = new Map(report.skews.map((s) => [s.channelId, s.flag]));
  const rows: LiquidityRow[] = snapshot.channels.map((c) => {
    const excluded = !(c.state === "ChannelReady" && c.enabled);
    const flag = flagById.get(c.channelId);
    const barColor = excluded ? COLOR.excluded : flag ? COLOR[flag] : COLOR.ok;
    return { channelId: c.channelId, peer: c.peer, asset: c.asset, pct: pctOf(c), barColor, flag, excluded, local: c.local, remote: c.remote };
  });
  const cards: LiquidityCard[] = report.assets.map((a) => ({
    asset: a.asset, outbound: a.outbound, inbound: a.inbound, maxSend: a.maxSend, maxReceive: a.maxReceive
  }));
  return { cards, rows, empty: snapshot.channels.length === 0 };
}
```

`apps/web/src/LiquidityPanel.tsx`:

```tsx
import React, { useState } from "react";
import { HealthClient, buildLiquiditySnapshot, computeLiquidityReport } from "@fiber-route-doctor/core";
import { buildLiquidityView, type LiquidityView } from "./liquidity-view.js";

export function LiquidityPanel() {
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");
  const [view, setView] = useState<LiquidityView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const channels = await new HealthClient({ url, biscuit: token || undefined }).listChannels();
      const snapshot = buildLiquiditySnapshot(channels, url, new Date().toISOString());
      setView(buildLiquidityView(computeLiquidityReport(snapshot), snapshot));
    } catch (e) {
      setView(null);
      setError(String(e));
    } finally { setBusy(false); }
  }

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Channel Liquidity</h2>
      <div style={{ margin: "0.4rem 0" }}>
        <label>node url: <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <div style={{ margin: "0.4rem 0" }}>
        <label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <button onClick={run} disabled={busy}>{busy ? "probing…" : "Probe"}</button>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {view?.empty && <p style={{ color: "#888" }}>no channels — nothing to snapshot</p>}
      {view && !view.empty && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {view.cards.map((c) => (
              <div key={c.asset} style={{ border: "1px solid #444", padding: "0.6rem" }}>
                <strong>{c.asset}</strong>
                <div>out {c.outbound} / in {c.inbound}</div>
                <div style={{ color: "#888" }}>max send {c.maxSend} · max receive {c.maxReceive}</div>
              </div>
            ))}
          </div>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.8rem" }}>
            {view.rows.map((r) => (
              <li key={r.channelId} style={{ margin: "0.4rem 0" }}>
                <code>{r.channelId.slice(0, 12)}…</code>{" "}
                <span style={{ display: "inline-block", width: 120, background: "#333", verticalAlign: "middle" }}>
                  <span style={{ display: "block", width: `${r.pct ?? 0}%`, background: r.barColor, height: 10 }} />
                </span>{" "}
                {r.pct === null ? "zero capacity" : `${r.pct}% local`} · local {r.local} / remote {r.remote}
                {r.flag && <span style={{ color: r.barColor }}> ⚠ {r.flag}</span>}
                {r.excluded && <span style={{ color: "#7f8c8d" }}> (excluded)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

`apps/web/src/App.tsx` — add the import and render `<LiquidityPanel />` directly after `<HealthPanel />`:

```tsx
import { LiquidityPanel } from "./LiquidityPanel.js";
// ... inside <main>, after <HealthPanel />:
      <LiquidityPanel />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/test/liquidity-view.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/liquidity-view.ts apps/web/src/LiquidityPanel.tsx apps/web/src/App.tsx apps/web/test/liquidity-view.test.ts
git commit -m "feat(web): channel liquidity panel with per-channel bars"
```

---

### Task 11: Gated live smoke and README

**Files:**
- Create: `scripts/liquidity-live-smoke.mjs`
- Modify: `package.json` (add `smoke:liquidity` script)
- Modify: `README.md` (add liquidity section after the Node Health Probe section)

**Interfaces:**
- Consumes: same env-gated pattern as `scripts/health-live-smoke.mjs`; `buildLiquiditySnapshot`/`computeLiquidityReport`/`formatLiquidityText` from core.
- Produces: `npm run smoke:liquidity` — SKIP exit 0 without env; against a live node prints the report (the currently-empty driveThree node exercises the empty-node path honestly).

- [ ] **Step 1: Write the smoke script**

`scripts/liquidity-live-smoke.mjs`:

```javascript
// Snapshot a live Fiber node's channel liquidity with a freshly minted readonly token.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/liquidity-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient, buildLiquiditySnapshot, computeLiquidityReport, formatLiquidityText } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP liquidity-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const channels = await new HealthClient({ url, biscuit: token }).listChannels();
const snapshot = buildLiquiditySnapshot(channels, url, new Date().toISOString());
const report = computeLiquidityReport(snapshot);
console.log(formatLiquidityText(report, snapshot));
console.log(`OK: snapshot built — ${snapshot.channels.length} channel(s), ${report.assets.length} asset(s), ${report.excludedChannels} excluded`);
```

`package.json` — add to scripts:

```json
    "smoke:liquidity": "node --import tsx scripts/liquidity-live-smoke.mjs"
```

- [ ] **Step 2: Verify the gated skip path**

Run: `npm run smoke:liquidity`
Expected: `SKIP liquidity-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL`, exit 0.

- [ ] **Step 3: Update README**

Add after the `## Node Health Probe` section:

```markdown
## Channel Liquidity Snapshot

What can this node send and receive right now, per asset — and how has it changed?

```bash
# report: per-asset totals, per-channel balance bars, skew flags, per-peer summary
fiber-route-doctor liquidity --profile driveThree --url http://127.0.0.1:8231

# save a timestamped snapshot (~/.config/fiber-route-doctor/snapshots/)
fiber-route-doctor liquidity --profile driveThree --url http://127.0.0.1:8231 --save

# what changed since the last saved snapshot? (then save the new baseline)
fiber-route-doctor liquidity --profile driveThree --url http://127.0.0.1:8231 --diff --save
```

Totals count only ready+enabled channels; excluded channels are listed with the reason.
Skew flags: `drained` (<10% local — can't send) and `full` (>90% local — can't receive).
Snapshots persist raw observations (decimal-string balances, JSON-safe), so diffs stay
valid as analytics evolve. `--json` emits `{ report, snapshot, diff? }`.

Live validation: `FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:liquidity`
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all tests pass (133 existing + new), typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/liquidity-live-smoke.mjs package.json README.md
git commit -m "feat: gated liquidity live-smoke and README docs"
```

---

## Verification checklist (post-plan)

- `npm test` green, `npm run typecheck` exit 0.
- `npm run smoke:liquidity` SKIPs cleanly without env; full run against driveThree prints the empty-node path (0 channels) honestly — manual run by Phill or with approval.
- Manual web check: `npm run dev` in `apps/web`, liquidity panel probes the local node.
- CLI snapshot workflow round-trip: `liquidity --save` twice then `--diff` shows "no changes" against an unchanged node.
