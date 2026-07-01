# Fiber Node Health Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `health` CLI subcommand (one-shot, `--watch` with webhook alerting) and a web traffic-light panel that answer: is this Fiber node up, authenticated, connected, and able to move money?

**Architecture:** Snapshot-then-rules, mirroring Route Doctor: `HealthClient` (extends `GraphClient`) collects a `HealthSnapshot` with per-call outcomes (never throws for call failures), a registry of pure check functions maps the snapshot to `CheckResult`s, verdict = worst status. CLI and web share the identical core engine.

**Tech Stack:** TypeScript ESM strict, Vitest, npm workspaces (`packages/core`, `apps/cli`, `apps/web`), React (web), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-node-health-probe-design.md`

## Global Constraints

- Node >= 22, npm >= 11; run tests from repo root: `npm test` (vitest) and `npm run typecheck`.
- Repo style: compact TS, semicolons, double quotes, small focused files, tests in `<workspace>/test/*.test.ts`.
- u128/u64/u32 RPC values arrive as **hex strings** (`"0x1f4"`); convert with `BigInt(...)`/`Number(...)` at use sites.
- fnn auth rejection is JSON-RPC error **code -32999, message "Unauthorized"** over HTTP 200 (verified in fiber `rpc/middleware.rs`).
- The biscuit token must NEVER appear in logs, formatted output, JSON reports, or webhook payloads.
- Exit codes (one-shot): 0 = all pass, 1 = degraded (any warn), 2 = unhealthy (any fail) or usage error.
- Every task: run the task's tests + `npm run typecheck` before committing.

---

### Task 1: RPC result types, typed RPC error, HealthClient methods

**Files:**
- Create: `packages/core/src/health-types.ts`
- Create: `packages/core/src/health-client.ts`
- Modify: `packages/core/src/graph-client.ts` (make `call` protected; throw typed `RpcMethodError`)
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/test/health-client.test.ts`

**Interfaces:**
- Consumes: `GraphClient` from `./graph-client.js`, `Hex`/`UdtScript` from `./types.js`.
- Produces: `RpcNodeInfo`, `RpcPeerInfo`, `RpcChannel`, `RpcChannelState` (health-types); `RpcMethodError` (graph-client, has `.method: string`, `.code: number`); `class HealthClient extends GraphClient` with `nodeInfo(): Promise<RpcNodeInfo>`, `listPeers(): Promise<RpcPeerInfo[]>`, `listChannels(): Promise<RpcChannel[]>`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/health-client.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HealthClient, RpcMethodError } from "../src/index.js";

function mockFetch(result: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

const NODE_INFO = {
  version: "0.9.0-rc5", commit_hash: "abcdef1234567890", pubkey: "0x03aa", node_name: "dt",
  addresses: ["/ip4/1.2.3.4/tcp/8228"], chain_hash: "0x11", channel_count: "0x2", pending_channel_count: "0x0", peers_count: "0x3"
};

describe("HealthClient", () => {
  it("calls node_info and returns the result", async () => {
    const fetchImpl = mockFetch(NODE_INFO);
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const info = await c.nodeInfo();
    expect(info.version).toBe("0.9.0-rc5");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body)).method).toBe("node_info");
  });
  it("calls list_peers and unwraps the peers array", async () => {
    const fetchImpl = mockFetch({ peers: [{ pubkey: "0x02bb", address: "/ip4/1.2.3.4/tcp/8228" }] });
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const peers = await c.listPeers();
    expect(peers).toHaveLength(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body)).method).toBe("list_peers");
  });
  it("calls list_channels with empty params and unwraps channels", async () => {
    const fetchImpl = mockFetch({ channels: [] });
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const channels = await c.listChannels();
    expect(channels).toEqual([]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]!.body));
    expect(body.method).toBe("list_channels");
    expect(body.params).toEqual([{}]);
  });
  it("throws RpcMethodError carrying the JSON-RPC error code", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32999, message: "Unauthorized" } }), { status: 200 }));
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const err = await c.nodeInfo().catch((e) => e);
    expect(err).toBeInstanceOf(RpcMethodError);
    expect((err as RpcMethodError).code).toBe(-32999);
    expect(String(err)).toMatch(/Unauthorized/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-client.test.ts`
Expected: FAIL — `HealthClient`/`RpcMethodError` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/health-types.ts`:

```typescript
import type { Hex, UdtScript } from "./types.js";

// ---- Raw RPC shapes (Fiber v0.9, snake_case; uN values are hex strings) ----
export interface RpcNodeInfo {
  version: string;
  commit_hash: string;
  pubkey: Hex;
  node_name?: string | null;
  addresses: string[];
  chain_hash: Hex;
  channel_count: Hex;         // u32 hex
  pending_channel_count: Hex; // u32 hex
  peers_count: Hex;           // u32 hex
}
export interface RpcPeerInfo { pubkey: Hex; address: string; }
/** serde adjacently-tagged: { state_name: "ChannelReady" | "NegotiatingFunding" | ..., state_flags?: string } */
export interface RpcChannelState { state_name: string; state_flags?: unknown; }
export interface RpcChannel {
  channel_id: Hex;
  state: RpcChannelState;
  local_balance: Hex;         // u128 hex
  remote_balance: Hex;        // u128 hex
  offered_tlc_balance: Hex;   // u128 hex
  received_tlc_balance: Hex;  // u128 hex
  enabled: boolean;
  is_public: boolean;
  pending_tlcs: unknown[];
  created_at: Hex;            // u64 hex ms
  funding_udt_type_script?: UdtScript | null;
  failure_detail?: string | null;
}

// ---- Snapshot & report ----
export type RpcOutcomeKind = "auth-denied" | "transport-error";
export type RpcOutcome = { ok: true } | { ok: false; kind: RpcOutcomeKind; detail: string };
export interface HealthSnapshot {
  nodeInfo?: RpcNodeInfo;
  peers?: RpcPeerInfo[];
  channels?: RpcChannel[];
  outcomes: { nodeInfo: RpcOutcome; listPeers: RpcOutcome; listChannels: RpcOutcome };
}
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export interface CheckResult { id: string; title: string; status: CheckStatus; reason: string; fix?: string; }
export interface NodeSummary {
  version: string; pubkey: Hex; nodeName: string | null; addresses: readonly string[];
  chainHash: Hex; channelCount: number; pendingChannelCount: number; peersCount: number;
}
export interface HealthReport { checks: readonly CheckResult[]; verdict: CheckStatus; node?: NodeSummary; }
```

`packages/core/src/graph-client.ts` — two edits:

Replace the error throw inside `call` (`if (json.error) throw new Error(...)`) and the access modifier. Full updated file:

```typescript
import type { RpcChannelInfo, RpcGraphNode } from "./types.js";

export interface GraphClientOptions { url: string; biscuit?: string; fetchImpl?: typeof fetch; }

interface JsonRpcResponse<T> { result?: T; error?: { code: number; message: string }; }

/** JSON-RPC method-level error (the node responded, the method failed). */
export class RpcMethodError extends Error {
  constructor(readonly method: string, readonly code: number, message: string) {
    super(`RPC ${method} error ${code}: ${message}`);
    this.name = "RpcMethodError";
  }
}

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

  protected async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.biscuit) headers["Authorization"] = `Bearer ${this.biscuit}`;
    const res = await this.fetchImpl(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) throw new RpcMethodError(method, json.error.code, json.error.message);
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

`packages/core/src/health-client.ts`:

```typescript
import { GraphClient } from "./graph-client.js";
import type { RpcChannel, RpcNodeInfo, RpcPeerInfo } from "./health-types.js";

export class HealthClient extends GraphClient {
  async nodeInfo(): Promise<RpcNodeInfo> {
    return this.call<RpcNodeInfo>("node_info", []);
  }
  async listPeers(): Promise<RpcPeerInfo[]> {
    return (await this.call<{ peers: RpcPeerInfo[] }>("list_peers", [])).peers;
  }
  async listChannels(): Promise<RpcChannel[]> {
    return (await this.call<{ channels: RpcChannel[] }>("list_channels", [{}])).channels;
  }
}
```

`packages/core/src/index.ts` — add after the `graph-client.js` line:

```typescript
export * from "./health-types.js";
export * from "./health-client.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-client.test.ts packages/core/test/graph-client.test.ts && npm run typecheck`
Expected: all PASS (graph-client's existing "throws when the RPC returns an error object" test still passes — `RpcMethodError` keeps the same message shape).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-types.ts packages/core/src/health-client.ts packages/core/src/graph-client.ts packages/core/src/index.ts packages/core/test/health-client.test.ts
git commit -m "feat(core): HealthClient with node_info/list_peers/list_channels + typed RpcMethodError"
```

---

### Task 2: collectHealthSnapshot with per-call outcome classification

**Files:**
- Modify: `packages/core/src/health-client.ts`
- Test: `packages/core/test/health-snapshot.test.ts`

**Interfaces:**
- Consumes: `HealthClient` (Task 1), `RpcMethodError` (Task 1), `HealthSnapshot`/`RpcOutcome` (Task 1).
- Produces: `collectHealthSnapshot(client: HealthClient): Promise<HealthSnapshot>` — never rejects for RPC/transport failures; classifies JSON-RPC error code -32999 as `auth-denied`, everything else as `transport-error`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/health-snapshot.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HealthClient, collectHealthSnapshot } from "../src/index.js";

const NODE_INFO = {
  version: "0.9.0-rc5", commit_hash: "abcdef12", pubkey: "0x03aa", node_name: null,
  addresses: [], chain_hash: "0x11", channel_count: "0x1", pending_channel_count: "0x0", peers_count: "0x1"
};

/** Route each JSON-RPC method to a per-method responder. */
function routedFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return routes[body.method]();
  });
}
const ok = (id: number, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 });
const unauthorized = (id: number) => new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32999, message: "Unauthorized" } }), { status: 200 });

describe("collectHealthSnapshot", () => {
  it("captures data and ok outcomes when all calls succeed", async () => {
    const fetchImpl = routedFetch({
      node_info: () => ok(1, NODE_INFO),
      list_peers: () => ok(2, { peers: [{ pubkey: "0x02bb", address: "/ip4/1.1.1.1/tcp/1" }] }),
      list_channels: () => ok(3, { channels: [] })
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.nodeInfo?.version).toBe("0.9.0-rc5");
    expect(s.peers).toHaveLength(1);
    expect(s.channels).toEqual([]);
    expect(s.outcomes).toEqual({ nodeInfo: { ok: true }, listPeers: { ok: true }, listChannels: { ok: true } });
  });
  it("classifies -32999 Unauthorized as auth-denied, leaves data undefined", async () => {
    const fetchImpl = routedFetch({
      node_info: () => ok(1, NODE_INFO),
      list_peers: () => unauthorized(2),
      list_channels: () => unauthorized(3)
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.peers).toBeUndefined();
    expect(s.outcomes.listPeers).toMatchObject({ ok: false, kind: "auth-denied" });
    expect(s.outcomes.nodeInfo).toEqual({ ok: true });
  });
  it("classifies network throws and HTTP errors as transport-error", async () => {
    const fetchImpl = routedFetch({
      node_info: () => { throw new Error("ECONNREFUSED"); },
      list_peers: () => new Response("bad gateway", { status: 502 }),
      list_channels: () => { throw new Error("ECONNREFUSED"); }
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.outcomes.nodeInfo).toMatchObject({ ok: false, kind: "transport-error", detail: expect.stringContaining("ECONNREFUSED") });
    expect(s.outcomes.listPeers).toMatchObject({ ok: false, kind: "transport-error", detail: expect.stringContaining("502") });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-snapshot.test.ts`
Expected: FAIL — `collectHealthSnapshot` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/health-client.ts`:

```typescript
import { RpcMethodError } from "./graph-client.js";
import type { HealthSnapshot, RpcOutcome } from "./health-types.js";

const UNAUTHORIZED_CODE = -32999; // fnn BiscuitAuthMiddleware auth_reject_error()

function classifyFailure(e: unknown): RpcOutcome {
  if (e instanceof RpcMethodError && e.code === UNAUTHORIZED_CODE) {
    return { ok: false, kind: "auth-denied", detail: e.message };
  }
  return { ok: false, kind: "transport-error", detail: e instanceof Error ? e.message : String(e) };
}

/** Runs all three health RPCs, capturing each failure independently — never rejects for call failures. */
export async function collectHealthSnapshot(client: HealthClient): Promise<HealthSnapshot> {
  const [ni, pe, ch] = await Promise.allSettled([client.nodeInfo(), client.listPeers(), client.listChannels()]);
  return {
    nodeInfo: ni.status === "fulfilled" ? ni.value : undefined,
    peers: pe.status === "fulfilled" ? pe.value : undefined,
    channels: ch.status === "fulfilled" ? ch.value : undefined,
    outcomes: {
      nodeInfo: ni.status === "fulfilled" ? { ok: true } : classifyFailure(ni.reason),
      listPeers: pe.status === "fulfilled" ? { ok: true } : classifyFailure(pe.reason),
      listChannels: ch.status === "fulfilled" ? { ok: true } : classifyFailure(ch.reason)
    }
  };
}
```

(Keep the existing imports at the top of the file; merge the `graph-client.js` imports into one line: `import { GraphClient, RpcMethodError } from "./graph-client.js";`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-snapshot.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-client.ts packages/core/test/health-snapshot.test.ts
git commit -m "feat(core): collectHealthSnapshot with auth-denied/transport-error classification"
```

---

### Task 3: Reachability and auth checks

**Files:**
- Create: `packages/core/src/health-checks.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./health-checks.js";`)
- Test: `packages/core/test/health-checks.test.ts`

**Interfaces:**
- Consumes: `HealthSnapshot`, `RpcOutcome`, `CheckResult` (Task 1).
- Produces: `checkReachability(s: HealthSnapshot): CheckResult` (id `"reachability"`), `checkAuth(s: HealthSnapshot): CheckResult` (id `"auth"`); helper `skipReason(o: RpcOutcome): string` (module-internal).

- [ ] **Step 1: Write the failing test**

`packages/core/test/health-checks.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { checkReachability, checkAuth, type HealthSnapshot, type RpcOutcome } from "../src/index.js";

const OK: RpcOutcome = { ok: true };
const DENIED: RpcOutcome = { ok: false, kind: "auth-denied", detail: "RPC list_peers error -32999: Unauthorized" };
const DOWN: RpcOutcome = { ok: false, kind: "transport-error", detail: "fetch failed: ECONNREFUSED" };

function snap(outcomes: HealthSnapshot["outcomes"], data: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return { outcomes, ...data };
}

describe("checkReachability", () => {
  it("fails when every call transport-errored", () => {
    const r = checkReachability(snap({ nodeInfo: DOWN, listPeers: DOWN, listChannels: DOWN }));
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("ECONNREFUSED");
    expect(r.fix).toBeTruthy();
  });
  it("passes when any call reached the node — even if only to be denied", () => {
    expect(checkReachability(snap({ nodeInfo: DENIED, listPeers: DENIED, listChannels: DENIED })).status).toBe("pass");
    expect(checkReachability(snap({ nodeInfo: OK, listPeers: DOWN, listChannels: DOWN })).status).toBe("pass");
  });
});

describe("checkAuth", () => {
  it("fails when all calls are denied", () => {
    const r = checkAuth(snap({ nodeInfo: DENIED, listPeers: DENIED, listChannels: DENIED }));
    expect(r.status).toBe("fail");
    expect(r.fix).toContain("token generate");
  });
  it("warns naming missing scopes when only some calls are denied", () => {
    const r = checkAuth(snap({ nodeInfo: OK, listPeers: DENIED, listChannels: OK }));
    expect(r.status).toBe("warn");
    expect(r.reason).toContain('read("peers")');
  });
  it("passes when all calls authorized and skips when nothing reached the node", () => {
    expect(checkAuth(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK })).status).toBe("pass");
    expect(checkAuth(snap({ nodeInfo: DOWN, listPeers: DOWN, listChannels: DOWN })).status).toBe("skip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-checks.test.ts`
Expected: FAIL — `checkReachability` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/health-checks.ts`:

```typescript
import type { CheckResult, HealthSnapshot, RpcOutcome } from "./health-types.js";

const TOKEN_FIX = "mint a readonly token: fiber-route-doctor token generate --scope readonly --profile <name> --url <node-url>";
const SCOPE_BY_CALL = { nodeInfo: 'read("node")', listPeers: 'read("peers")', listChannels: 'read("channels")' } as const;
type CallName = keyof typeof SCOPE_BY_CALL;

export function skipReason(o: RpcOutcome): string {
  return o.ok ? "unavailable" : o.detail;
}

function outcomeEntries(s: HealthSnapshot): Array<[CallName, RpcOutcome]> {
  return Object.entries(s.outcomes) as Array<[CallName, RpcOutcome]>;
}

export function checkReachability(s: HealthSnapshot): CheckResult {
  const id = "reachability", title = "Node reachability";
  const outcomes = outcomeEntries(s).map(([, o]) => o);
  const allTransport = outcomes.every((o) => !o.ok && o.kind === "transport-error");
  if (allTransport) {
    const first = outcomes.find((o) => !o.ok);
    const detail = first && !first.ok ? first.detail : "unknown";
    return { id, title, status: "fail", reason: `no RPC call reached the node: ${detail}`, fix: "check the node is running and the URL/port are correct" };
  }
  return { id, title, status: "pass", reason: "node responded to RPC" };
}

export function checkAuth(s: HealthSnapshot): CheckResult {
  const id = "auth", title = "Authentication";
  const entries = outcomeEntries(s);
  const denied = entries.filter(([, o]) => !o.ok && o.kind === "auth-denied");
  const transport = entries.filter(([, o]) => !o.ok && o.kind === "transport-error");
  if (transport.length === entries.length) return { id, title, status: "skip", reason: "no call reached the node" };
  if (denied.length === entries.length) return { id, title, status: "fail", reason: "token rejected (Unauthorized) for all calls", fix: TOKEN_FIX };
  if (denied.length > 0) {
    const scopes = denied.map(([name]) => SCOPE_BY_CALL[name]).join(", ");
    return { id, title, status: "warn", reason: `token valid but missing scopes: ${scopes}`, fix: TOKEN_FIX };
  }
  return { id, title, status: "pass", reason: "all calls authorized" };
}
```

Add to `packages/core/src/index.ts`: `export * from "./health-checks.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-checks.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-checks.ts packages/core/src/index.ts packages/core/test/health-checks.test.ts
git commit -m "feat(core): reachability and auth health checks"
```

---

### Task 4: Node-info and peers checks

**Files:**
- Modify: `packages/core/src/health-checks.ts`
- Test: `packages/core/test/health-checks.test.ts` (append)

**Interfaces:**
- Consumes: `HealthSnapshot`, `skipReason` (Task 3), `RpcNodeInfo` counts are u32 hex strings — use `Number(...)`.
- Produces: `checkNodeInfo(s: HealthSnapshot): CheckResult` (id `"node-info"`), `checkPeers(s: HealthSnapshot): CheckResult` (id `"peers"`).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/health-checks.test.ts`:

```typescript
import { checkNodeInfo, checkPeers, type RpcNodeInfo } from "../src/index.js";

const NODE_INFO: RpcNodeInfo = {
  version: "0.9.0-rc5", commit_hash: "abcdef1234567890", pubkey: "0x03aa", node_name: "dt",
  addresses: ["/ip4/1.2.3.4/tcp/8228"], chain_hash: "0x11",
  channel_count: "0x1f4", pending_channel_count: "0x0", peers_count: "0x8"
};

describe("checkNodeInfo", () => {
  it("passes with a version/counts summary when node_info succeeded", () => {
    const r = checkNodeInfo(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK }, { nodeInfo: NODE_INFO }));
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("0.9.0-rc5");
    expect(r.reason).toContain("500 channel(s)");
    expect(r.reason).toContain("8 peer(s)");
  });
  it("skips with the outcome detail when node_info failed", () => {
    const r = checkNodeInfo(snap({ nodeInfo: DOWN, listPeers: OK, listChannels: OK }));
    expect(r.status).toBe("skip");
    expect(r.reason).toContain("ECONNREFUSED");
  });
});

describe("checkPeers", () => {
  it("fails as isolated with 0 peers", () => {
    const r = checkPeers(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK }, { peers: [] }));
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("isolated");
    expect(r.fix).toContain("connect_peer");
  });
  it("passes with a count when peers exist", () => {
    const r = checkPeers(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK }, { peers: [{ pubkey: "0x02bb", address: "/ip4/1.1.1.1/tcp/1" }] }));
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("1 peer(s)");
  });
  it("skips when list_peers failed", () => {
    expect(checkPeers(snap({ nodeInfo: OK, listPeers: DENIED, listChannels: OK })).status).toBe("skip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-checks.test.ts`
Expected: FAIL — `checkNodeInfo` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/health-checks.ts`:

```typescript
export function checkNodeInfo(s: HealthSnapshot): CheckResult {
  const id = "node-info", title = "Node info";
  if (!s.nodeInfo) return { id, title, status: "skip", reason: skipReason(s.outcomes.nodeInfo) };
  const n = s.nodeInfo;
  const reason = `fnn v${n.version} (${n.commit_hash.slice(0, 8)}), ${Number(n.channel_count)} channel(s) (${Number(n.pending_channel_count)} pending), ${Number(n.peers_count)} peer(s)`;
  return { id, title, status: "pass", reason };
}

export function checkPeers(s: HealthSnapshot): CheckResult {
  const id = "peers", title = "Peer connectivity";
  if (!s.peers) return { id, title, status: "skip", reason: skipReason(s.outcomes.listPeers) };
  if (s.peers.length === 0) {
    return { id, title, status: "fail", reason: "0 peers — node is isolated (no gossip, no routing)", fix: "connect to a peer: fiber-cli connect_peer --address <multiaddr>" };
  }
  return { id, title, status: "pass", reason: `${s.peers.length} peer(s) connected` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-checks.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-checks.ts packages/core/test/health-checks.test.ts
git commit -m "feat(core): node-info and peer-connectivity health checks"
```

---

### Task 5: Channel health check

**Files:**
- Modify: `packages/core/src/health-checks.ts`
- Test: `packages/core/test/health-checks.test.ts` (append)

**Interfaces:**
- Consumes: `RpcChannel` (Task 1), `skipReason` (Task 3). `list_channels` default already excludes closed channels (verified in fnn `rpc/channel.rs`), so every non-`ChannelReady` state here is genuinely in-flight or failing.
- Produces: `checkChannels(s: HealthSnapshot): CheckResult` (id `"channels"`).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/health-checks.test.ts`:

```typescript
import { checkChannels, type RpcChannel } from "../src/index.js";

function chan(over: Partial<RpcChannel> = {}): RpcChannel {
  return {
    channel_id: "0x" + "ab".repeat(32), state: { state_name: "ChannelReady" },
    local_balance: "0x3e8", remote_balance: "0x3e8", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
    enabled: true, is_public: true, pending_tlcs: [], created_at: "0x1",
    funding_udt_type_script: null, failure_detail: null, ...over
  };
}
const ALL_OK = { nodeInfo: OK, listPeers: OK, listChannels: OK };

describe("checkChannels", () => {
  it("passes with count and local balance when all channels are healthy", () => {
    const r = checkChannels(snap(ALL_OK, { channels: [chan(), chan()] }));
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("2 channel(s) ready");
    expect(r.reason).toContain("2000");
  });
  it("warns when there are no channels at all", () => {
    const r = checkChannels(snap(ALL_OK, { channels: [] }));
    expect(r.status).toBe("warn");
    expect(r.reason).toContain("no channels");
  });
  it("warns on non-ready channels including failure_detail", () => {
    const r = checkChannels(snap(ALL_OK, { channels: [chan({ state: { state_name: "AwaitingChannelReady" }, failure_detail: "funding tx unconfirmed" })] }));
    expect(r.status).toBe("warn");
    expect(r.reason).toContain("AwaitingChannelReady");
    expect(r.reason).toContain("funding tx unconfirmed");
  });
  it("warns on disabled channels and pending TLCs", () => {
    const r = checkChannels(snap(ALL_OK, { channels: [chan({ enabled: false }), chan({ pending_tlcs: [{}, {}] })] }));
    expect(r.status).toBe("warn");
    expect(r.reason).toContain("disabled");
    expect(r.reason).toContain("2 pending TLC(s)");
  });
  it("warns on zero outbound liquidity across ready channels", () => {
    const r = checkChannels(snap(ALL_OK, { channels: [chan({ local_balance: "0x0" })] }));
    expect(r.status).toBe("warn");
    expect(r.reason).toContain("zero outbound liquidity");
  });
  it("skips when list_channels failed", () => {
    expect(checkChannels(snap({ nodeInfo: OK, listPeers: OK, listChannels: DENIED })).status).toBe("skip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-checks.test.ts`
Expected: FAIL — `checkChannels` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/health-checks.ts`:

```typescript
const shortId = (h: string): string => `${h.slice(0, 10)}…`;

export function checkChannels(s: HealthSnapshot): CheckResult {
  const id = "channels", title = "Channel health";
  if (!s.channels) return { id, title, status: "skip", reason: skipReason(s.outcomes.listChannels) };
  if (s.channels.length === 0) {
    return { id, title, status: "warn", reason: "no channels — node has no liquidity", fix: "open a channel to a well-connected peer" };
  }
  const issues: string[] = [];
  const fixes: string[] = [];
  const notReady = s.channels.filter((c) => c.state.state_name !== "ChannelReady");
  for (const c of notReady) issues.push(`${shortId(c.channel_id)} in ${c.state.state_name}${c.failure_detail ? ` (${c.failure_detail})` : ""}`);
  if (notReady.length) fixes.push("wait for funding confirmation or investigate failure_detail");
  const disabled = s.channels.filter((c) => c.state.state_name === "ChannelReady" && !c.enabled);
  for (const c of disabled) issues.push(`${shortId(c.channel_id)} disabled`);
  if (disabled.length) fixes.push("re-enable via update_channel");
  const stuck = s.channels.filter((c) => c.pending_tlcs.length > 0);
  for (const c of stuck) issues.push(`${shortId(c.channel_id)} has ${c.pending_tlcs.length} pending TLC(s)`);
  if (stuck.length) fixes.push("pending TLCs may be in-flight payments; investigate if persistent");
  const ready = s.channels.filter((c) => c.state.state_name === "ChannelReady");
  const localTotal = ready.reduce((acc, c) => acc + BigInt(c.local_balance), 0n);
  if (ready.length > 0 && localTotal === 0n) {
    issues.push("zero outbound liquidity — cannot send");
    fixes.push("rebalance or fund a channel from this side");
  }
  if (issues.length) return { id, title, status: "warn", reason: issues.join("; "), fix: fixes.join("; ") };
  return { id, title, status: "pass", reason: `${ready.length} channel(s) ready, local balance ${localTotal} (smallest unit)` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-checks.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-checks.ts packages/core/test/health-checks.test.ts
git commit -m "feat(core): channel health check (ready/disabled/pending-TLC/liquidity rules)"
```

---

### Task 6: Orchestrator, verdict, node summary

**Files:**
- Create: `packages/core/src/health.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./health.js";`)
- Test: `packages/core/test/health.test.ts`

**Interfaces:**
- Consumes: `collectHealthSnapshot` (Task 2), the five checks (Tasks 3–5), `HealthReport`/`NodeSummary`/`CheckStatus` (Task 1).
- Produces: `runHealthChecks(s: HealthSnapshot): CheckResult[]` (order: reachability, auth, node-info, peers, channels); `worstStatus(checks: readonly CheckResult[]): CheckStatus`; `summarizeNode(n?: RpcNodeInfo): NodeSummary | undefined`; `runHealthProbe(client: HealthClient): Promise<HealthReport>`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/health.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HealthClient, runHealthProbe, runHealthChecks, worstStatus, summarizeNode, type CheckResult, type HealthSnapshot } from "../src/index.js";

const check = (status: CheckResult["status"]): CheckResult => ({ id: "x", title: "x", status, reason: "" });

describe("worstStatus", () => {
  it("ranks fail > warn > pass and ignores skip", () => {
    expect(worstStatus([check("pass"), check("warn"), check("fail"), check("skip")])).toBe("fail");
    expect(worstStatus([check("pass"), check("warn"), check("skip")])).toBe("warn");
    expect(worstStatus([check("pass"), check("skip")])).toBe("pass");
  });
});

describe("summarizeNode", () => {
  it("converts hex counts to numbers", () => {
    const s = summarizeNode({
      version: "0.9.0-rc5", commit_hash: "abc", pubkey: "0x03aa", node_name: null, addresses: ["/a"],
      chain_hash: "0x11", channel_count: "0x1f4", pending_channel_count: "0x2", peers_count: "0x8"
    });
    expect(s).toMatchObject({ channelCount: 500, pendingChannelCount: 2, peersCount: 8, nodeName: null });
  });
  it("returns undefined without node info", () => { expect(summarizeNode(undefined)).toBeUndefined(); });
});

describe("runHealthProbe", () => {
  it("produces a full-fail report against an unreachable node", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const report = await runHealthProbe(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(report.verdict).toBe("fail");
    expect(report.checks.map((c) => c.id)).toEqual(["reachability", "auth", "node-info", "peers", "channels"]);
    expect(report.checks[0].status).toBe("fail");
    expect(report.checks.slice(1).every((c) => c.status === "skip")).toBe(true);
    expect(report.node).toBeUndefined();
  });
});

describe("runHealthChecks", () => {
  it("runs all five checks over a snapshot", () => {
    const s: HealthSnapshot = { outcomes: { nodeInfo: { ok: false, kind: "transport-error", detail: "x" }, listPeers: { ok: false, kind: "transport-error", detail: "x" }, listChannels: { ok: false, kind: "transport-error", detail: "x" } } };
    expect(runHealthChecks(s)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health.test.ts`
Expected: FAIL — `runHealthProbe` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/health.ts`:

```typescript
import { collectHealthSnapshot, type HealthClient } from "./health-client.js";
import { checkAuth, checkChannels, checkNodeInfo, checkPeers, checkReachability } from "./health-checks.js";
import type { CheckResult, CheckStatus, HealthReport, HealthSnapshot, NodeSummary, RpcNodeInfo } from "./health-types.js";

const CHECKS: Array<(s: HealthSnapshot) => CheckResult> = [checkReachability, checkAuth, checkNodeInfo, checkPeers, checkChannels];

export function runHealthChecks(s: HealthSnapshot): CheckResult[] {
  return CHECKS.map((c) => c(s));
}

const RANK: Record<CheckStatus, number> = { fail: 3, warn: 2, pass: 1, skip: 0 };

export function worstStatus(checks: readonly CheckResult[]): CheckStatus {
  const ranked = checks.filter((c) => c.status !== "skip");
  if (ranked.length === 0) return "fail";
  return ranked.reduce((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), "pass" as CheckStatus);
}

export function summarizeNode(n?: RpcNodeInfo): NodeSummary | undefined {
  if (!n) return undefined;
  return {
    version: n.version, pubkey: n.pubkey, nodeName: n.node_name ?? null, addresses: n.addresses,
    chainHash: n.chain_hash, channelCount: Number(n.channel_count),
    pendingChannelCount: Number(n.pending_channel_count), peersCount: Number(n.peers_count)
  };
}

export async function runHealthProbe(client: HealthClient): Promise<HealthReport> {
  const snapshot = await collectHealthSnapshot(client);
  const checks = runHealthChecks(snapshot);
  return { checks, verdict: worstStatus(checks), node: summarizeNode(snapshot.nodeInfo) };
}
```

Add to `packages/core/src/index.ts`: `export * from "./health.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health.ts packages/core/src/index.ts packages/core/test/health.test.ts
git commit -m "feat(core): runHealthProbe orchestrator with worst-status verdict"
```

---

### Task 7: Text formatter

**Files:**
- Create: `packages/core/src/health-format.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./health-format.js";`)
- Test: `packages/core/test/health-format.test.ts`

**Interfaces:**
- Consumes: `HealthReport`, `CheckStatus`, `NodeSummary` (Task 1).
- Produces: `formatHealthText(report: HealthReport): string`. `HealthReport` contains no bigints (balances appear only inside reason strings), so `--json` output is plain `JSON.stringify(report, null, 2)` — no serializer function needed.

- [ ] **Step 1: Write the failing test**

`packages/core/test/health-format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatHealthText, type HealthReport } from "../src/index.js";

const REPORT: HealthReport = {
  verdict: "warn",
  node: { version: "0.9.0-rc5", pubkey: "0x03aabbccdd", nodeName: "dt", addresses: ["/ip4/1.2.3.4/tcp/8228"], chainHash: "0x1122334455", channelCount: 500, pendingChannelCount: 0, peersCount: 8 },
  checks: [
    { id: "reachability", title: "Node reachability", status: "pass", reason: "node responded to RPC" },
    { id: "auth", title: "Authentication", status: "pass", reason: "all calls authorized" },
    { id: "channels", title: "Channel health", status: "warn", reason: "0xabcdef1234… disabled", fix: "re-enable via update_channel" },
    { id: "peers", title: "Peer connectivity", status: "skip", reason: "unavailable" }
  ]
};

describe("formatHealthText", () => {
  it("renders verdict header, node summary, and one line per check with icons", () => {
    const out = formatHealthText(REPORT);
    expect(out).toContain("verdict: WARN");
    expect(out).toContain("fnn v0.9.0-rc5");
    expect(out).toContain("500 channels");
    expect(out).toContain("✓ Node reachability");
    expect(out).toContain("⚠ Channel health");
    expect(out).toContain("− Peer connectivity");
    expect(out).toContain("fix: re-enable via update_channel");
  });
  it("omits the node summary line when node info is absent", () => {
    const out = formatHealthText({ ...REPORT, node: undefined });
    expect(out).not.toContain("fnn v");
  });
  it("report JSON-serializes cleanly", () => {
    expect(() => JSON.stringify(REPORT)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-format.test.ts`
Expected: FAIL — `formatHealthText` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/health-format.ts`:

```typescript
import type { CheckStatus, HealthReport } from "./health-types.js";

const ICON: Record<CheckStatus, string> = { pass: "✓", warn: "⚠", fail: "✗", skip: "−" };

export function formatHealthText(report: HealthReport): string {
  const lines: string[] = [`Fiber node health — verdict: ${report.verdict.toUpperCase()}`];
  if (report.node) {
    const n = report.node;
    lines.push(`node: fnn v${n.version}${n.nodeName ? ` "${n.nodeName}"` : ""} pubkey ${n.pubkey.slice(0, 12)}… chain ${n.chainHash.slice(0, 12)}… | ${n.channelCount} channels (${n.pendingChannelCount} pending) | ${n.peersCount} peers`);
  }
  for (const c of report.checks) {
    lines.push(` ${ICON[c.status]} ${c.title.padEnd(18)} ${c.reason}`);
    if (c.fix && c.status !== "pass") lines.push(`    fix: ${c.fix}`);
  }
  return lines.join("\n");
}
```

Add to `packages/core/src/index.ts`: `export * from "./health-format.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-format.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-format.ts packages/core/src/index.ts packages/core/test/health-format.test.ts
git commit -m "feat(core): health report text formatter"
```

---

### Task 8: Transition detection and webhook alerting

**Files:**
- Create: `packages/core/src/health-alert.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./health-alert.js";`)
- Test: `packages/core/test/health-alert.test.ts`

**Interfaces:**
- Consumes: `HealthReport`, `CheckStatus` (Task 1).
- Produces:
  - `interface Transition { check: string; from: CheckStatus; to: CheckStatus; reason: string; }`
  - `detectTransitions(prev: HealthReport, next: HealthReport): Transition[]` (matches checks by `id`)
  - `type WebhookFormat = "generic" | "slack" | "discord"` and `const WEBHOOK_FORMATS: WebhookFormat[]`
  - `interface HealthAlert { ts: string; nodeUrl: string; verdict: CheckStatus; previousVerdict: CheckStatus; transitions: Transition[]; report: HealthReport; }`
  - `buildAlertBody(format: WebhookFormat, alert: HealthAlert): string`
  - `postAlert(url: string, format: WebhookFormat, alert: HealthAlert, fetchImpl?: typeof fetch): Promise<boolean>` — one retry, never throws.

- [ ] **Step 1: Write the failing test**

`packages/core/test/health-alert.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { detectTransitions, buildAlertBody, postAlert, type HealthAlert, type HealthReport } from "../src/index.js";

const report = (statuses: Record<string, "pass" | "warn" | "fail" | "skip">): HealthReport => ({
  verdict: Object.values(statuses).includes("fail") ? "fail" : "pass",
  checks: Object.entries(statuses).map(([id, status]) => ({ id, title: id, status, reason: `${id} is ${status}` }))
});

const ALERT: HealthAlert = {
  ts: "2026-07-02T00:00:00.000Z", nodeUrl: "http://127.0.0.1:8231", verdict: "fail", previousVerdict: "pass",
  transitions: [{ check: "peers", from: "pass", to: "fail", reason: "0 peers — node is isolated (no gossip, no routing)" }],
  report: report({ peers: "fail" })
};

describe("detectTransitions", () => {
  it("reports only checks whose status changed", () => {
    const t = detectTransitions(report({ peers: "pass", auth: "pass" }), report({ peers: "fail", auth: "pass" }));
    expect(t).toEqual([{ check: "peers", from: "pass", to: "fail", reason: "peers is fail" }]);
  });
  it("returns empty when nothing changed", () => {
    expect(detectTransitions(report({ peers: "fail" }), report({ peers: "fail" }))).toEqual([]);
  });
});

describe("buildAlertBody", () => {
  it("generic format carries the machine payload", () => {
    const body = JSON.parse(buildAlertBody("generic", ALERT));
    expect(body).toMatchObject({ nodeUrl: "http://127.0.0.1:8231", verdict: "fail", previousVerdict: "pass" });
    expect(body.transitions).toHaveLength(1);
  });
  it("slack and discord formats wrap a human summary", () => {
    expect(JSON.parse(buildAlertBody("slack", ALERT)).text).toContain("peers: pass → fail");
    expect(JSON.parse(buildAlertBody("discord", ALERT)).content).toContain("FAIL");
  });
  it("never includes anything token-like", () => {
    for (const f of ["generic", "slack", "discord"] as const) {
      expect(buildAlertBody(f, ALERT)).not.toMatch(/[Bb]earer|biscuit|token/);
    }
  });
});

describe("postAlert", () => {
  it("POSTs the body and returns true on 2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await postAlert("https://hooks.example/x", "generic", ALERT, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
  });
  it("retries once on failure then returns false without throwing", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    expect(await postAlert("https://hooks.example/x", "generic", ALERT, fetchImpl)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("retry succeeds after a transient failure", async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(async () => new Response("bad", { status: 500 }))
      .mockImplementationOnce(async () => new Response("ok", { status: 200 }));
    expect(await postAlert("https://hooks.example/x", "generic", ALERT, fetchImpl)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/health-alert.test.ts`
Expected: FAIL — `detectTransitions` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/health-alert.ts`:

```typescript
import type { CheckStatus, HealthReport } from "./health-types.js";

export interface Transition { check: string; from: CheckStatus; to: CheckStatus; reason: string; }

export function detectTransitions(prev: HealthReport, next: HealthReport): Transition[] {
  const prevById = new Map(prev.checks.map((c) => [c.id, c]));
  const out: Transition[] = [];
  for (const c of next.checks) {
    const p = prevById.get(c.id);
    if (p && p.status !== c.status) out.push({ check: c.id, from: p.status, to: c.status, reason: c.reason });
  }
  return out;
}

export type WebhookFormat = "generic" | "slack" | "discord";
export const WEBHOOK_FORMATS: WebhookFormat[] = ["generic", "slack", "discord"];

export interface HealthAlert {
  ts: string;
  nodeUrl: string;
  verdict: CheckStatus;
  previousVerdict: CheckStatus;
  transitions: Transition[];
  report: HealthReport;
}

function summaryLine(alert: HealthAlert): string {
  const changes = alert.transitions.map((t) => `${t.check}: ${t.from} → ${t.to} (${t.reason})`).join("; ");
  return `Fiber node ${alert.nodeUrl}: ${alert.verdict.toUpperCase()} — ${changes}`;
}

export function buildAlertBody(format: WebhookFormat, alert: HealthAlert): string {
  if (format === "slack") return JSON.stringify({ text: summaryLine(alert) });
  if (format === "discord") return JSON.stringify({ content: summaryLine(alert) });
  return JSON.stringify(alert);
}

/** Fire-and-forget webhook delivery: one retry, never throws. */
export async function postAlert(url: string, format: WebhookFormat, alert: HealthAlert, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
  const body = buildAlertBody(format, alert);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) return true;
    } catch { /* retry once, then give up */ }
  }
  return false;
}
```

Add to `packages/core/src/index.ts`: `export * from "./health-alert.js";`

Note: the "never includes anything token-like" test works because `HealthAlert` is built purely from `HealthReport` data — there is no code path that could add the biscuit. The test guards against future regressions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/health-alert.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/health-alert.ts packages/core/src/index.ts packages/core/test/health-alert.test.ts
git commit -m "feat(core): transition detection and webhook alerting (generic/slack/discord)"
```

---

### Task 9: CLI health args parsing and dispatch

**Files:**
- Create: `apps/cli/src/commands/health.ts` (args parsing only in this task)
- Modify: `apps/cli/src/dispatch.ts`
- Test: `apps/cli/test/health-args.test.ts`, `apps/cli/test/dispatch.test.ts` (append one case)

**Interfaces:**
- Consumes: `WebhookFormat`, `WEBHOOK_FORMATS` from `@fiber-route-doctor/core`.
- Produces: `interface HealthArgs { url: string; biscuit?: string; profile?: string; authTokenFile?: string; json: boolean; watch: boolean; intervalSeconds: number; webhook?: string; webhookFormat: WebhookFormat; }`; `parseHealthArgs(rest: string[]): HealthArgs` (throws `Error` with a usage message on invalid input); dispatch accepts `"health"`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/health-args.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseHealthArgs } from "../src/commands/health.js";

describe("parseHealthArgs", () => {
  it("parses url, token flags, json, watch, interval, webhook", () => {
    const a = parseHealthArgs(["--url", "http://n:8231", "--profile", "dt", "--watch", "--interval", "5", "--webhook", "https://hooks.example/x", "--webhook-format", "discord", "--json"]);
    expect(a).toMatchObject({ url: "http://n:8231", profile: "dt", watch: true, intervalSeconds: 5, webhook: "https://hooks.example/x", webhookFormat: "discord", json: true });
  });
  it("defaults: interval 10, format generic, no watch/json", () => {
    const a = parseHealthArgs(["--url", "http://n:8231"]);
    expect(a).toMatchObject({ intervalSeconds: 10, webhookFormat: "generic", watch: false, json: false });
  });
  it("requires --url", () => {
    expect(() => parseHealthArgs([])).toThrow(/--url/);
  });
  it("rejects bad intervals", () => {
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--interval", "0"])).toThrow(/interval/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--interval", "1.5"])).toThrow(/interval/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--interval", "9999"])).toThrow(/interval/);
  });
  it("rejects --webhook without --watch, non-http(s) webhook URLs, unknown formats", () => {
    expect(() => parseHealthArgs(["--url", "u", "--webhook", "https://h/x"])).toThrow(/--watch/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "ftp://h/x"])).toThrow(/http/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "not a url"])).toThrow();
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "https://h/x", "--webhook-format", "teams"])).toThrow(/webhook-format/);
  });
});
```

Append to `apps/cli/test/dispatch.test.ts` (inside the existing describe):

```typescript
  it("routes the health command", () => {
    expect(parseCommand(["health", "--url", "u"])).toEqual({ command: "health", rest: ["--url", "u"] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/cli/test/health-args.test.ts apps/cli/test/dispatch.test.ts`
Expected: FAIL — no `commands/health.js`; dispatch rejects `health`.

- [ ] **Step 3: Write minimal implementation**

`apps/cli/src/dispatch.ts` — extend the union and list:

```typescript
export type Command = "diagnose" | "keys" | "token" | "health";
const COMMANDS: Command[] = ["diagnose", "keys", "token", "health"];

export function parseCommand(argv: string[]): { command: Command; rest: string[] } {
  const first = argv[0];
  if (first === undefined || first.startsWith("--")) return { command: "diagnose", rest: argv };
  if ((COMMANDS as string[]).includes(first)) return { command: first as Command, rest: argv.slice(1) };
  throw new Error(`unknown command '${first}' (expected: ${COMMANDS.join(", ")})`);
}
```

`apps/cli/src/commands/health.ts`:

```typescript
import { WEBHOOK_FORMATS, type WebhookFormat } from "@fiber-route-doctor/core";

export interface HealthArgs {
  url: string; biscuit?: string; profile?: string; authTokenFile?: string;
  json: boolean; watch: boolean; intervalSeconds: number;
  webhook?: string; webhookFormat: WebhookFormat;
}

export function parseHealthArgs(rest: string[]): HealthArgs {
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
  const watch = bools.has("watch");
  const intervalSeconds = Number(flags.get("interval") ?? "10");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 3600) {
    throw new Error("--interval must be an integer between 1 and 3600 seconds");
  }
  const webhook = flags.get("webhook");
  if (webhook !== undefined) {
    if (!watch) throw new Error("--webhook requires --watch");
    const u = new URL(webhook); // throws on malformed URLs
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("--webhook must be an http(s) URL");
  }
  const webhookFormat = flags.get("webhook-format") ?? "generic";
  if (!(WEBHOOK_FORMATS as string[]).includes(webhookFormat)) {
    throw new Error(`--webhook-format must be one of: ${WEBHOOK_FORMATS.join(", ")}`);
  }
  return {
    url, biscuit: flags.get("biscuit"), profile: flags.get("profile"), authTokenFile: flags.get("auth-token-file"),
    json: bools.has("json"), watch, intervalSeconds, webhook, webhookFormat: webhookFormat as WebhookFormat
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/health-args.test.ts apps/cli/test/dispatch.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/health.ts apps/cli/src/dispatch.ts apps/cli/test/health-args.test.ts apps/cli/test/dispatch.test.ts
git commit -m "feat(cli): health command args parsing and dispatch"
```

---

### Task 10: One-shot health run with exit codes, wired into main

**Files:**
- Modify: `apps/cli/src/commands/health.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/health-run.test.ts`

**Interfaces:**
- Consumes: `parseHealthArgs` (Task 9); `HealthClient`, `runHealthProbe`, `formatHealthText` from core; `resolveToken`, `NodeFsTokenStore` from `@fiber-route-doctor/biscuit` (same wiring as `main.ts` uses for diagnose).
- Produces: `healthExitCode(verdict: CheckStatus): number` (pass→0, warn→1, fail→2); `runHealth(rest: string[], deps?: { probe?: (args: HealthArgs) => Promise<HealthReport>; print?: (s: string) => void }): Promise<number>` — deps injectable for tests, defaulting to the real probe/console. Watch branch lands in Task 11 (until then `--watch` runs one shot).

- [ ] **Step 1: Write the failing test**

`apps/cli/test/health-run.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runHealth, healthExitCode } from "../src/commands/health.js";
import type { HealthReport } from "@fiber-route-doctor/core";

const report = (verdict: HealthReport["verdict"]): HealthReport => ({
  verdict, checks: [{ id: "reachability", title: "Node reachability", status: verdict, reason: "r" }]
});

describe("healthExitCode", () => {
  it("maps pass/warn/fail to 0/1/2", () => {
    expect(healthExitCode("pass")).toBe(0);
    expect(healthExitCode("warn")).toBe(1);
    expect(healthExitCode("fail")).toBe(2);
  });
});

describe("runHealth (one-shot)", () => {
  it("prints the text report and returns the verdict exit code", async () => {
    const print = vi.fn();
    const code = await runHealth(["--url", "http://n/"], { probe: async () => report("warn"), print });
    expect(code).toBe(1);
    expect(String(print.mock.calls[0][0])).toContain("verdict: WARN");
  });
  it("prints JSON with --json", async () => {
    const print = vi.fn();
    await runHealth(["--url", "http://n/", "--json"], { probe: async () => report("pass"), print });
    expect(() => JSON.parse(String(print.mock.calls[0][0]))).not.toThrow();
  });
  it("returns 2 and prints the usage error for bad args", async () => {
    const print = vi.fn();
    const code = await runHealth([], { print });
    expect(code).toBe(2);
    expect(String(print.mock.calls[0][0])).toContain("--url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/test/health-run.test.ts`
Expected: FAIL — `runHealth`/`healthExitCode` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/cli/src/commands/health.ts`:

```typescript
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HealthClient, formatHealthText, runHealthProbe, type CheckStatus, type HealthReport } from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";

const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");

export function healthExitCode(verdict: CheckStatus): number {
  return verdict === "pass" ? 0 : verdict === "warn" ? 1 : 2;
}

function defaultProbe(args: HealthArgs): Promise<HealthReport> {
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  return runHealthProbe(new HealthClient({ url: args.url, biscuit: token }));
}

export interface HealthDeps {
  probe?: (args: HealthArgs) => Promise<HealthReport>;
  print?: (s: string) => void;
}

export async function runHealth(rest: string[], deps: HealthDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  let args: HealthArgs;
  try {
    args = parseHealthArgs(rest);
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const probe = deps.probe ?? defaultProbe;
  const report = await probe(args);
  print(args.json ? JSON.stringify(report, null, 2) : formatHealthText(report));
  return healthExitCode(report.verdict);
}
```

(Import placement: merge these imports with the existing `WEBHOOK_FORMATS` import at the top of the file.)

`apps/cli/src/main.ts` — add after the `token` line:

```typescript
import { runHealth } from "./commands/health.js";
// ... inside main(), after the keys/token lines:
  if (command === "health") process.exit(await runHealth(rest));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/health-run.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/health.ts apps/cli/src/main.ts apps/cli/test/health-run.test.ts
git commit -m "feat(cli): one-shot health command with verdict exit codes"
```

---

### Task 11: Watch loop with transitions and webhook delivery

**Files:**
- Modify: `apps/cli/src/commands/health.ts`
- Test: `apps/cli/test/health-watch.test.ts`

**Interfaces:**
- Consumes: `detectTransitions`, `postAlert`, `formatHealthText`, `HealthAlert`, `Transition` from core; `runHealth`/`HealthDeps` (Task 10).
- Produces: `watchHealth(opts: { nodeUrl: string; intervalMs: number; webhook?: string; webhookFormat: WebhookFormat; maxTicks?: number }, deps: { probe: () => Promise<HealthReport>; print: (s: string) => void; sleep: (ms: number) => Promise<void>; now: () => Date; post?: typeof postAlert }): Promise<void>`. `runHealth` gains the watch branch: with `--watch` it runs `watchHealth` forever (`maxTicks` undefined) and, on webhook failure, prints a warning line without stopping.

- [ ] **Step 1: Write the failing test**

`apps/cli/test/health-watch.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { watchHealth } from "../src/commands/health.js";
import type { HealthReport } from "@fiber-route-doctor/core";

const report = (peersStatus: "pass" | "fail"): HealthReport => ({
  verdict: peersStatus,
  checks: [{ id: "peers", title: "Peer connectivity", status: peersStatus, reason: `peers ${peersStatus}` }]
});

function deps(reports: HealthReport[]) {
  let i = 0;
  return {
    probe: vi.fn(async () => reports[Math.min(i++, reports.length - 1)]),
    print: vi.fn(),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-07-02T00:00:00.000Z")
  };
}

describe("watchHealth", () => {
  it("renders each tick and prints a transition line when a check changes", async () => {
    const d = deps([report("pass"), report("fail")]);
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhookFormat: "generic", maxTicks: 2 }, d);
    expect(d.probe).toHaveBeenCalledTimes(2);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("peers: pass → fail");
  });
  it("sends a webhook only on transition ticks", async () => {
    const post = vi.fn(async () => true);
    const d = deps([report("pass"), report("pass"), report("fail")]);
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhook: "https://h/x", webhookFormat: "slack", maxTicks: 3 }, { ...d, post });
    expect(post).toHaveBeenCalledTimes(1);
    const alert = post.mock.calls[0][2];
    expect(alert.previousVerdict).toBe("pass");
    expect(alert.verdict).toBe("fail");
  });
  it("prints a warning when webhook delivery fails, and keeps looping", async () => {
    const post = vi.fn(async () => false);
    const d = deps([report("pass"), report("fail"), report("fail")]);
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhook: "https://h/x", webhookFormat: "generic", maxTicks: 3 }, { ...d, post });
    expect(d.probe).toHaveBeenCalledTimes(3);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("webhook delivery failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/cli/test/health-watch.test.ts`
Expected: FAIL — `watchHealth` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/cli/src/commands/health.ts` (extend imports from core with `detectTransitions, postAlert, type HealthAlert`):

```typescript
export interface WatchOpts {
  nodeUrl: string; intervalMs: number; webhook?: string; webhookFormat: WebhookFormat; maxTicks?: number;
}
export interface WatchDeps {
  probe: () => Promise<HealthReport>;
  print: (s: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  post?: typeof postAlert;
}

export async function watchHealth(opts: WatchOpts, deps: WatchDeps): Promise<void> {
  const post = deps.post ?? postAlert;
  let prev: HealthReport | undefined;
  for (let tick = 0; opts.maxTicks === undefined || tick < opts.maxTicks; tick++) {
    if (tick > 0) await deps.sleep(opts.intervalMs);
    const next = await deps.probe();
    deps.print(formatHealthText(next));
    if (prev) {
      const transitions = detectTransitions(prev, next);
      for (const t of transitions) deps.print(`[${deps.now().toISOString()}] ${t.check}: ${t.from} → ${t.to} (${t.reason})`);
      if (transitions.length > 0 && opts.webhook) {
        const alert: HealthAlert = {
          ts: deps.now().toISOString(), nodeUrl: opts.nodeUrl,
          verdict: next.verdict, previousVerdict: prev.verdict, transitions, report: next
        };
        const delivered = await post(opts.webhook, opts.webhookFormat, alert);
        if (!delivered) deps.print("warning: webhook delivery failed");
      }
    }
    prev = next;
  }
}
```

And extend `runHealth` — replace the one-shot tail (`const report = await probe(args); ...`) with:

```typescript
  const probe = deps.probe ?? defaultProbe;
  if (args.watch) {
    await watchHealth(
      { nodeUrl: args.url, intervalMs: args.intervalSeconds * 1000, webhook: args.webhook, webhookFormat: args.webhookFormat },
      { probe: () => probe(args), print, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => new Date() }
    );
    return 0;
  }
  const report = await probe(args);
  print(args.json ? JSON.stringify(report, null, 2) : formatHealthText(report));
  return healthExitCode(report.verdict);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/cli/test/health-watch.test.ts apps/cli/test/health-run.test.ts && npm run typecheck`
Expected: PASS (one-shot tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/health.ts apps/cli/test/health-watch.test.ts
git commit -m "feat(cli): health --watch with transition lines and webhook alerts"
```

---

### Task 12: Web health panel

**Files:**
- Create: `apps/web/src/health-view.ts`
- Create: `apps/web/src/HealthPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/test/health-view.test.ts`

**Interfaces:**
- Consumes: `HealthReport`, `CheckStatus`, `HealthClient`, `runHealthProbe`, `buildHealthView` (this task) from `@fiber-route-doctor/core` / local module.
- Produces: `interface HealthRow { id: string; icon: string; color: string; title: string; reason: string; fix?: string; }`; `interface HealthView { verdict: CheckStatus; verdictColor: string; rows: HealthRow[]; summary?: string; }`; `buildHealthView(report: HealthReport): HealthView`; `<HealthPanel />` React component rendered by `App`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/health-view.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildHealthView } from "../src/health-view.js";
import type { HealthReport } from "@fiber-route-doctor/core";

const REPORT: HealthReport = {
  verdict: "warn",
  node: { version: "0.9.0-rc5", pubkey: "0x03aabbccdd", nodeName: null, addresses: [], chainHash: "0x11", channelCount: 500, pendingChannelCount: 0, peersCount: 8 },
  checks: [
    { id: "reachability", title: "Node reachability", status: "pass", reason: "node responded to RPC" },
    { id: "channels", title: "Channel health", status: "warn", reason: "0xab… disabled", fix: "re-enable via update_channel" },
    { id: "peers", title: "Peer connectivity", status: "skip", reason: "unavailable" }
  ]
};

describe("buildHealthView", () => {
  it("maps statuses to icons and colors", () => {
    const v = buildHealthView(REPORT);
    expect(v.verdict).toBe("warn");
    expect(v.verdictColor).toBe("#f1c40f");
    expect(v.rows).toHaveLength(3);
    expect(v.rows[0]).toMatchObject({ icon: "✓", color: "#2ecc71" });
    expect(v.rows[1]).toMatchObject({ icon: "⚠", color: "#f1c40f", fix: "re-enable via update_channel" });
    expect(v.rows[2]).toMatchObject({ icon: "−", color: "#7f8c8d" });
  });
  it("builds a node summary line when node info is present, omits it otherwise", () => {
    expect(buildHealthView(REPORT).summary).toContain("fnn v0.9.0-rc5");
    expect(buildHealthView({ ...REPORT, node: undefined }).summary).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/test/health-view.test.ts`
Expected: FAIL — no `health-view.js`.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/health-view.ts`:

```typescript
import type { CheckStatus, HealthReport } from "@fiber-route-doctor/core";

const ICON: Record<CheckStatus, string> = { pass: "✓", warn: "⚠", fail: "✗", skip: "−" };
const COLOR: Record<CheckStatus, string> = { pass: "#2ecc71", warn: "#f1c40f", fail: "#e74c3c", skip: "#7f8c8d" };

export interface HealthRow { id: string; icon: string; color: string; title: string; reason: string; fix?: string; }
export interface HealthView { verdict: CheckStatus; verdictColor: string; rows: HealthRow[]; summary?: string; }

export function buildHealthView(report: HealthReport): HealthView {
  const rows = report.checks.map((c) => ({ id: c.id, icon: ICON[c.status], color: COLOR[c.status], title: c.title, reason: c.reason, fix: c.fix }));
  const n = report.node;
  const summary = n ? `fnn v${n.version} | ${n.channelCount} channels (${n.pendingChannelCount} pending) | ${n.peersCount} peers` : undefined;
  return { verdict: report.verdict, verdictColor: COLOR[report.verdict], rows, summary };
}
```

`apps/web/src/HealthPanel.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { HealthClient, runHealthProbe } from "@fiber-route-doctor/core";
import { buildHealthView, type HealthView } from "./health-view.js";

export function HealthPanel() {
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");
  const [view, setView] = useState<HealthView | null>(null);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const report = await runHealthProbe(new HealthClient({ url, biscuit: token || undefined }));
      setView(buildHealthView(report));
    } catch (e) {
      setView(null);
      setError(String(e));
    } finally { setBusy(false); }
  }, [url, token]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(run, 10_000);
    return () => clearInterval(id);
  }, [auto, run]);

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Node Health</h2>
      <div style={{ margin: "0.4rem 0" }}>
        <label>node url: <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <div style={{ margin: "0.4rem 0" }}>
        <label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <button onClick={run} disabled={busy}>{busy ? "probing…" : "Probe"}</button>
      <label style={{ marginLeft: "1rem" }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-refresh (10s)
      </label>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {view && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ color: view.verdictColor, fontWeight: "bold" }}>verdict: {view.verdict.toUpperCase()}</div>
          {view.summary && <div style={{ color: "#888" }}>{view.summary}</div>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {view.rows.map((r) => (
              <li key={r.id} style={{ margin: "0.3rem 0" }}>
                <span style={{ color: r.color }}>{r.icon}</span> <strong>{r.title}</strong> — {r.reason}
                {r.fix && <div style={{ color: "#888", marginLeft: "1.4rem" }}>fix: {r.fix}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

`apps/web/src/App.tsx` — add the import and render `<HealthPanel />` after the existing `<pre>`:

```tsx
import { HealthPanel } from "./HealthPanel.js";
// ... inside <main>, after the closing </pre>:
      <HealthPanel />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/test/health-view.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/health-view.ts apps/web/src/HealthPanel.tsx apps/web/src/App.tsx apps/web/test/health-view.test.ts
git commit -m "feat(web): node health panel with traffic-light checks and auto-refresh"
```

---

### Task 13: Gated live smoke and README

**Files:**
- Create: `scripts/health-live-smoke.mjs`
- Modify: `package.json` (add `smoke:health` script)
- Modify: `README.md` (add health section)

**Interfaces:**
- Consumes: `importPrivateKeyString`, `mintToken`, `scopeFacts` from biscuit package; `HealthClient`, `runHealthProbe`, `formatHealthText` from core. Mirrors `scripts/biscuit-live-smoke.mjs` exactly (env-gated skip).
- Produces: `npm run smoke:health` — exits 0 with SKIP when env unset; against a live node prints the report and asserts node_info version is non-empty.

- [ ] **Step 1: Write the smoke script**

`scripts/health-live-smoke.mjs`:

```javascript
// Probe a live Fiber node's health with a freshly minted readonly token.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/health-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient, runHealthProbe, formatHealthText } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP health-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const report = await runHealthProbe(new HealthClient({ url, biscuit: token }));
console.log(formatHealthText(report));
if (!report.node?.version) { console.error("FAIL: node_info did not return a version"); process.exit(1); }
console.log(`OK: verdict ${report.verdict}, fnn v${report.node.version}, ${report.node.peersCount} peers, ${report.node.channelCount} channels`);
```

`package.json` — add to scripts:

```json
    "smoke:health": "node --import tsx scripts/health-live-smoke.mjs"
```

- [ ] **Step 2: Verify the gated skip path**

Run: `npm run smoke:health`
Expected: `SKIP health-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL`, exit 0.

- [ ] **Step 3: Update README**

Add a `## Node Health Probe` section to `README.md` after the existing tool sections, containing:

```markdown
## Node Health Probe

Is your node up, authenticated, connected, and able to move money?

```bash
# one-shot (exit code: 0 healthy, 1 degraded, 2 unhealthy)
fiber-route-doctor health --profile driveThree --url http://127.0.0.1:8231

# live ops view, re-probing every 10s
fiber-route-doctor health --profile driveThree --url http://127.0.0.1:8231 --watch

# alert a Discord channel when any check changes status
fiber-route-doctor health --profile driveThree --url http://127.0.0.1:8231 --watch \
  --webhook https://discord.com/api/webhooks/… --webhook-format discord
```

Checks: reachability, biscuit auth (names missing scopes), node info, peer connectivity,
channel health (non-ready/disabled channels, pending TLCs, outbound liquidity).
Auth uses the same token resolution as `diagnose`: `--biscuit`, `--auth-token-file`,
`--profile`, or `FNN_AUTH_TOKEN`. Webhook payloads never contain the token.

Live validation: `FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:health`
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all tests pass (73 existing + new), typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/health-live-smoke.mjs package.json README.md
git commit -m "feat: gated health live-smoke and README docs"
```

---

## Verification checklist (post-plan)

- `npm test` green, `npm run typecheck` exit 0.
- `npm run smoke:health` SKIPs cleanly without env; full run against driveThree (`FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231`) prints a report with verdict and node summary — this is the real-loop proof (manual, run by Phill or with approval).
- Manual web check: `npm run dev` in `apps/web`, health panel probes the local node.
