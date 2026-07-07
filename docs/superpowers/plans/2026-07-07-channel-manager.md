# Fiber Channel Manager Implementation Plan (Sub-project B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Channel lifecycle management (connect / open / watch / list / fee-tune / close) from CLI and web against fnn v0.9.0-rc7, authorized by a new least-privilege `operator` biscuit scope, with an in-browser simulated channel state machine for the hosted demo.

**Architecture:** Fourth engine in `packages/core` (`ChannelClient extends HealthClient` + pure `watchChannelState`), scope templates extended in `packages/biscuit`, a `channel` command group in `apps/cli`, and a `ChannelPanel` in `apps/web` whose demo mode is driven by a stateful `makeChannelSimFetch` that advances channel states on each poll and delegates non-channel methods to the existing `demoFetch`.

**Tech Stack:** TypeScript ESM monorepo (npm workspaces), Vitest, existing GraphClient JSON-RPC plumbing, @biscuit-auth/biscuit-wasm 0.6.0, React 18 + Vite 5.

## Global Constraints

- fnn v0.9 wire format: ALL u64/u128 values are 0x-hex strings (`U64Hex`/`U128Hex` serde). Field names verbatim from `crates/fiber-json-types/src/{channel,peer}.rs` @ v0.9.0-rc7.
- Node datalog rules (rpc/biscuit.rs): `connect_peer` ⇒ `write("peers")`; `open_channel`/`update_channel`/`shutdown_channel` ⇒ `write("channels")`; `list_channels` ⇒ `read("channels")`.
- `operator` scope = READONLY facts + `write("channels")` + `write("peers")`. `full` additionally gains `write("peers")` + `write("payments")`.
- OUT of scope: payments/invoices, UDT channels, `addr_type`, retry/backoff, `open_channel_with_external_funding`.
- Tokens NEVER logged, echoed, or written to fixtures/files.
- Force-close requires `--force --yes-force` (CLI) / typing `force` (web).
- `npm test` and `npm run typecheck` (4 tsconfigs) green after every task. Baseline: 244 tests.
- Work on branch `feat/channel-manager`.

---

### Task 1: Biscuit `operator` scope + `full` fix (all scope surfaces)

**Files:**
- Modify: `packages/biscuit/src/scopes.ts`
- Modify: `apps/cli/src/commands/token.ts` (SCOPES list)
- Modify: `packages/biscuit/src/browser/vault.ts` (MintRequest.scope, MINT_SCOPES)
- Modify: `apps/web/src/WalletPanel.tsx` (scope select + useState type)
- Test: `packages/biscuit/test/scopes.test.ts`

**Interfaces:**
- Consumes: existing `scopeFacts(scope, extra)`, `mintToken`, `authorizeLocally(tokenB64, publicKeyString, policyCode, now?)`, `deriveFromMnemonic`.
- Produces: `ScopeTemplate = "readonly" | "invoicing" | "operator" | "full"`; `scopeFacts("operator")` → readonly facts + `write("channels")` + `write("peers")`. Tasks 4/6/7 mint with `"operator"`.

- [ ] **Step 1: Write the failing tests** — append to `packages/biscuit/test/scopes.test.ts`:

```typescript
import { mintToken, authorizeLocally, deriveFromMnemonic, newMnemonic } from "../src/index.js";

describe("operator scope", () => {
  it("grants exactly readonly + write(channels) + write(peers)", () => {
    const f = scopeFacts("operator");
    for (const s of ["node","peers","channels","payments","graph","cch"]) expect(f).toContain(`read("${s}")`);
    expect(f).toContain('write("channels")');
    expect(f).toContain('write("peers")');
    expect(f.filter(x => x.startsWith("write(")).length).toBe(2);
  });
  it("full now includes peers and payments writes", () => {
    const f = scopeFacts("full");
    for (const s of ["channels","cch","invoices","peers","payments"]) expect(f).toContain(`write("${s}")`);
  });
  it("GROUND TRUTH: operator passes the node's connect_peer rule; the OLD full fact-set fails", () => {
    // Node rule for connect_peer (rpc/biscuit.rs:127): allow if write("peers");
    const RULE = 'allow if write("peers");';
    const key = deriveFromMnemonic(newMnemonic());
    const expiry = new Date(Date.now() + 3600e3);
    const operatorToken = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("operator"), expiry });
    expect(authorizeLocally(operatorToken, key.publicKeyString, RULE)).toBe(true);
    // The pre-B "full" facts (no write("peers")) — pinned literally so this test
    // keeps proving WHY operator exists even after full was widened:
    const OLD_FULL = [
      'read("node")','read("peers")','read("channels")','read("payments")','read("graph")','read("cch")',
      'write("channels")','write("cch")','write("invoices")'
    ];
    const oldFullToken = mintToken({ privateKeyString: key.privateKeyString, facts: OLD_FULL, expiry });
    expect(authorizeLocally(oldFullToken, key.publicKeyString, RULE)).toBe(false);
  });
});
```

(Keep the existing imports line `import { scopeFacts } from "../src/index.js";` — merge imports.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/biscuit/test/scopes.test.ts`
Expected: FAIL — TS/type error `"operator"` not assignable to `ScopeTemplate`.

- [ ] **Step 3: Implement** — `packages/biscuit/src/scopes.ts` becomes:

```typescript
export type ScopeTemplate = "readonly" | "invoicing" | "operator" | "full";

const READONLY = [
  'read("node")', 'read("peers")', 'read("channels")',
  'read("payments")', 'read("graph")', 'read("cch")'
];

export function scopeFacts(scope: ScopeTemplate, extra: string[] = []): string[] {
  switch (scope) {
    case "readonly": return [...READONLY, ...extra];
    case "invoicing": return [...READONLY, 'write("invoices")', ...extra];
    // channel lifecycle management: open/update/close (channels) + connect (peers)
    case "operator": return [...READONLY, 'write("channels")', 'write("peers")', ...extra];
    case "full": return [...READONLY, 'write("channels")', 'write("cch")', 'write("invoices")', 'write("peers")', 'write("payments")', ...extra];
  }
}
```

Then update the other three surfaces:
- `apps/cli/src/commands/token.ts`: the `SCOPES` array gains `"operator"` (find `const SCOPES` near the `--scope must be one of` error).
- `packages/biscuit/src/browser/vault.ts`: `MintRequest.scope` union gains `"operator"`; `MINT_SCOPES` array gains `"operator"`.
- `apps/web/src/WalletPanel.tsx`: `useState<"readonly" | "invoicing" | "full">` → add `"operator"`; the `<select>` gains `<option value="operator">operator</option>` (between invoicing and full); the `e.target.value as` cast unchanged (uses `typeof scope`).

- [ ] **Step 4: Verify green**

Run: `npx vitest run packages/biscuit/test/scopes.test.ts && npm run typecheck`
Expected: all scope tests PASS; 4 tsconfigs clean.

- [ ] **Step 5: Commit**

```bash
git add packages/biscuit/src/scopes.ts packages/biscuit/test/scopes.test.ts apps/cli/src/commands/token.ts packages/biscuit/src/browser/vault.ts apps/web/src/WalletPanel.tsx
git commit -m "feat(biscuit): operator scope for channel management; full gains peers+payments"
```

---

### Task 2: Core channel types + ChannelClient

**Files:**
- Create: `packages/core/src/channel-types.ts`
- Create: `packages/core/src/channel-client.ts`
- Modify: `packages/core/src/index.ts` (two export lines)
- Test: `packages/core/test/channel-client.test.ts`

**Interfaces:**
- Consumes: `HealthClient` (`packages/core/src/health-client.ts`, extends GraphClient; protected `call<T>(method, params)`), `Hex`/`UdtScript` from `./types.js`, `RpcChannel` from `./health-types.js`.
- Produces: `ChannelClient extends HealthClient` with `connectPeer(p: RpcConnectPeerParams): Promise<void>`, `openChannel(p: RpcOpenChannelParams): Promise<RpcOpenChannelResult>`, `updateChannel(p: RpcUpdateChannelParams): Promise<void>`, `shutdownChannel(p: RpcShutdownChannelParams): Promise<void>`. Types as below. Tasks 3/4/6 consume.

- [ ] **Step 1: Write the failing test** — `packages/core/test/channel-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ChannelClient, RpcMethodError } from "../src/index.js";

function capture(result: unknown = null) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body));
const header = (c: { init: RequestInit }, k: string) => (c.init.headers as Record<string, string>)[k];

describe("ChannelClient", () => {
  it("connect_peer sends params and the Authorization header", async () => {
    const { calls, fetchImpl } = capture();
    const c = new ChannelClient({ url: "http://n", biscuit: "tok", fetchImpl });
    await c.connectPeer({ address: "/ip4/1.2.3.4/tcp/8228/p2p/Qm..", save: true });
    expect(body(calls[0]).method).toBe("connect_peer");
    expect(body(calls[0]).params).toEqual([{ address: "/ip4/1.2.3.4/tcp/8228/p2p/Qm..", save: true }]);
    expect(header(calls[0], "Authorization")).toBe("Bearer tok");
  });
  it("open_channel returns the temporary_channel_id", async () => {
    const { fetchImpl } = capture({ temporary_channel_id: "0xabc" });
    const c = new ChannelClient({ url: "http://n", fetchImpl });
    const r = await c.openChannel({ pubkey: "0x02aa", funding_amount: "0x174876e800" });
    expect(r.temporary_channel_id).toBe("0xabc");
  });
  it("update_channel and shutdown_channel send their params", async () => {
    const { calls, fetchImpl } = capture();
    const c = new ChannelClient({ url: "http://n", fetchImpl });
    await c.updateChannel({ channel_id: "0xc1", enabled: false, tlc_fee_proportional_millionths: "0x3e8" });
    await c.shutdownChannel({ channel_id: "0xc1", force: true });
    expect(body(calls[0]).method).toBe("update_channel");
    expect(body(calls[0]).params[0].enabled).toBe(false);
    expect(body(calls[1]).method).toBe("shutdown_channel");
    expect(body(calls[1]).params[0].force).toBe(true);
  });
  it("surfaces node method errors via the existing RpcMethodError taxonomy", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32999, message: "Unauthorized" } }), { status: 200 })) as unknown as typeof fetch;
    const c = new ChannelClient({ url: "http://n", fetchImpl });
    await expect(c.connectPeer({ pubkey: "0x02aa" })).rejects.toBeInstanceOf(RpcMethodError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/channel-client.test.ts`
Expected: FAIL — `ChannelClient` not exported.

- [ ] **Step 3: Implement** — `packages/core/src/channel-types.ts`:

```typescript
import type { Hex, UdtScript } from "./types.js";

// ---- fnn v0.9 channel-management wire shapes (crates/fiber-json-types/src/{peer,channel}.rs) ----
/** connect_peer — at least one of address/pubkey must be set (node contract). */
export interface RpcConnectPeerParams { address?: string; pubkey?: Hex; save?: boolean; }
export interface RpcOpenChannelParams {
  pubkey: Hex;
  funding_amount: Hex;                    // u128 hex, shannons
  public?: boolean;                       // node default: true
  funding_fee_rate?: Hex;                 // u64 hex
  commitment_fee_rate?: Hex;              // u64 hex
  tlc_fee_proportional_millionths?: Hex;  // u128 hex
}
export interface RpcOpenChannelResult { temporary_channel_id: Hex; }
export interface RpcUpdateChannelParams {
  channel_id: Hex;
  enabled?: boolean;
  tlc_expiry_delta?: Hex;                 // u64 hex, ms
  tlc_minimum_value?: Hex;                // u128 hex
  tlc_fee_proportional_millionths?: Hex;  // u128 hex
}
export interface RpcShutdownChannelParams {
  channel_id: Hex;
  close_script?: UdtScript;
  fee_rate?: Hex;                         // u64 hex, shannons/KB
  force?: boolean;
}
```

`packages/core/src/channel-client.ts`:

```typescript
import { HealthClient } from "./health-client.js";
import type {
  RpcConnectPeerParams, RpcOpenChannelParams, RpcOpenChannelResult,
  RpcUpdateChannelParams, RpcShutdownChannelParams
} from "./channel-types.js";

/** Channel lifecycle RPCs. Inherits auth, error taxonomy, and listChannels() from HealthClient. */
export class ChannelClient extends HealthClient {
  async connectPeer(p: RpcConnectPeerParams): Promise<void> {
    await this.call("connect_peer", [p]);
  }
  async openChannel(p: RpcOpenChannelParams): Promise<RpcOpenChannelResult> {
    return this.call<RpcOpenChannelResult>("open_channel", [p]);
  }
  async updateChannel(p: RpcUpdateChannelParams): Promise<void> {
    await this.call("update_channel", [p]);
  }
  async shutdownChannel(p: RpcShutdownChannelParams): Promise<void> {
    await this.call("shutdown_channel", [p]);
  }
}
```

`packages/core/src/index.ts` — add after the health exports:

```typescript
export * from "./channel-types.js";
export * from "./channel-client.js";
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run packages/core/test/channel-client.test.ts && npm run typecheck:core`
Expected: 4 tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-types.ts packages/core/src/channel-client.ts packages/core/src/index.ts packages/core/test/channel-client.test.ts
git commit -m "feat(core): ChannelClient + fnn v0.9 channel-management wire types"
```

---

### Task 3: watchChannelState

**Files:**
- Create: `packages/core/src/channel-watch.ts`
- Modify: `packages/core/src/index.ts` (one export line)
- Test: `packages/core/test/channel-watch.test.ts`

**Interfaces:**
- Consumes: `RpcChannel` from `./health-types.js` (fields: `channel_id`, `pubkey`, `state.state_name`, `created_at`, `failure_detail?`).
- Produces: `watchChannelState(source, channelId, opts?)` where `source = { listChannels(): Promise<RpcChannel[]> }` (structural — ChannelClient satisfies it); `WatchOptions { maxPolls?: number; delayMs?: number; counterpartyPubkey?: Hex; onTick?: (polls: number, state?: string) => void; delayFn?: (ms: number) => Promise<void> }`; returns `WatchResult { outcome: "ready" | "failed" | "timeout"; channel?: RpcChannel; polls: number; failureDetail?: string }`. Task 4 (`channel watch`/`open --watch`) and Task 6 consume.

- [ ] **Step 1: Write the failing test** — `packages/core/test/channel-watch.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { watchChannelState, type RpcChannel } from "../src/index.js";

const ch = (over: Partial<RpcChannel>): RpcChannel => ({
  channel_id: "0xc1", pubkey: "0x02aa", state: { state_name: "NegotiatingFunding" },
  local_balance: "0x0", remote_balance: "0x0", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
  enabled: false, is_public: true, pending_tlcs: [], created_at: "0x1", ...over
});
const seq = (...pages: RpcChannel[][]) => {
  let i = 0;
  return { listChannels: async () => pages[Math.min(i++, pages.length - 1)] };
};
const opts = { delayFn: async () => {}, delayMs: 0 };

describe("watchChannelState", () => {
  it("resolves ready when the channel reaches ChannelReady", async () => {
    const src = seq([ch({})], [ch({ state: { state_name: "AwaitingChannelReady" } })], [ch({ state: { state_name: "ChannelReady" }, enabled: true })]);
    const r = await watchChannelState(src, "0xc1", opts);
    expect(r.outcome).toBe("ready");
    expect(r.channel?.state.state_name).toBe("ChannelReady");
    expect(r.polls).toBe(3);
  });
  it("reports failure_detail as a terminal failure", async () => {
    const src = seq([ch({ failure_detail: "funding tx rejected" })]);
    const r = await watchChannelState(src, "0xc1", opts);
    expect(r.outcome).toBe("failed");
    expect(r.failureDetail).toBe("funding tx rejected");
  });
  it("treats a previously-seen channel disappearing as failure", async () => {
    const src = seq([ch({})], []);
    const r = await watchChannelState(src, "0xc1", opts);
    expect(r.outcome).toBe("failed");
    expect(r.failureDetail).toMatch(/disappeared/);
  });
  it("times out when the poll budget is exhausted", async () => {
    const src = seq([ch({})]);
    const r = await watchChannelState(src, "0xc1", { ...opts, maxPolls: 2 });
    expect(r.outcome).toBe("timeout");
    expect(r.polls).toBe(2);
  });
  it("resolves a temporary id to the newest channel with the counterparty pubkey", async () => {
    const real = ch({ channel_id: "0xREAL", created_at: "0x9", state: { state_name: "ChannelReady" } });
    const older = ch({ channel_id: "0xOLD", created_at: "0x2", state: { state_name: "ChannelReady" } });
    const source = { listChannels: async () => [older, real] };
    const r = await watchChannelState(source, "0xTEMP", { ...opts, counterpartyPubkey: "0x02aa" });
    expect(r.outcome).toBe("ready");
    expect(r.channel?.channel_id).toBe("0xREAL");
  });
  it("does NOT fall back to pubkey matching without counterpartyPubkey (unknown temp id times out)", async () => {
    const source = { listChannels: async () => [ch({ channel_id: "0xOTHER" })] };
    const r = await watchChannelState(source, "0xTEMP", { ...opts, maxPolls: 2 });
    expect(r.outcome).toBe("timeout");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/channel-watch.test.ts`
Expected: FAIL — `watchChannelState` not exported.

- [ ] **Step 3: Implement** — `packages/core/src/channel-watch.ts`:

```typescript
import type { Hex } from "./types.js";
import type { RpcChannel } from "./health-types.js";

export interface ChannelListSource { listChannels(): Promise<RpcChannel[]>; }
export interface WatchOptions {
  maxPolls?: number;                 // default 60
  delayMs?: number;                  // default 5000
  counterpartyPubkey?: Hex;          // enables temporary-id resolution
  onTick?: (polls: number, stateName?: string) => void;
  delayFn?: (ms: number) => Promise<void>;
}
export interface WatchResult {
  outcome: "ready" | "failed" | "timeout";
  channel?: RpcChannel;
  polls: number;
  failureDetail?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls list_channels until the channel is ChannelReady, terminally failed, or the budget runs out.
 * open_channel returns a TEMPORARY id; when `counterpartyPubkey` is given and the id is not found,
 * the newest (highest created_at) channel with that counterparty is watched instead.
 * Limitation (documented in the spec): concurrent opens to the same peer can ambiguate — open serially.
 */
export async function watchChannelState(source: ChannelListSource, channelId: Hex, opts: WatchOptions = {}): Promise<WatchResult> {
  const { maxPolls = 60, delayMs = 5000, counterpartyPubkey, onTick, delayFn = sleep } = opts;
  let resolvedId: Hex | undefined;
  let seen = false;
  for (let polls = 1; polls <= maxPolls; polls++) {
    const channels = await source.listChannels();
    let target = channels.find((c) => c.channel_id === (resolvedId ?? channelId));
    if (!target && !resolvedId && counterpartyPubkey) {
      const candidates = channels.filter((c) => c.pubkey === counterpartyPubkey);
      if (candidates.length > 0) {
        target = candidates.reduce((a, b) => (BigInt(a.created_at) >= BigInt(b.created_at) ? a : b));
        resolvedId = target.channel_id;
      }
    }
    onTick?.(polls, target?.state.state_name);
    if (target) {
      seen = true;
      if (target.failure_detail) return { outcome: "failed", channel: target, polls, failureDetail: target.failure_detail };
      if (target.state.state_name === "ChannelReady") return { outcome: "ready", channel: target, polls };
    } else if (seen) {
      return { outcome: "failed", polls, failureDetail: "channel disappeared from list_channels before becoming ready" };
    }
    if (polls < maxPolls) await delayFn(delayMs);
  }
  return { outcome: "timeout", polls: maxPolls };
}
```

`packages/core/src/index.ts` — add `export * from "./channel-watch.js";` after the channel-client export.

- [ ] **Step 4: Verify green**

Run: `npx vitest run packages/core/test/channel-watch.test.ts && npm run typecheck:core`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-watch.ts packages/core/src/index.ts packages/core/test/channel-watch.test.ts
git commit -m "feat(core): watchChannelState poll-until-ready with temp-id resolution"
```

---

### Task 4: CLI `channel` command group

**Files:**
- Create: `apps/cli/src/commands/channel.ts`
- Modify: `apps/cli/src/dispatch.ts` (add `"channel"`)
- Modify: `apps/cli/src/main.ts` (import + route)
- Test: `apps/cli/test/channel-args.test.ts`

**Interfaces:**
- Consumes: `ChannelClient`, `watchChannelState`, `RpcMethodError` from `@fiber-route-doctor/core`; `resolveToken`, `NodeFsTokenStore` from `@fiber-route-doctor/biscuit` (same wiring as `commands/health.ts`).
- Produces: `runChannel(rest: string[], deps?: ChannelDeps): Promise<number>`; `parseChannelArgs(rest: string[]): ChannelArgs`; `ckbToShannonHex(s: string): string` (exported for tests and reused by Task 6's web helper as the reference implementation).

- [ ] **Step 1: Write the failing tests** — `apps/cli/test/channel-args.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseChannelArgs, ckbToShannonHex } from "../src/commands/channel.js";

describe("ckbToShannonHex", () => {
  it("converts whole and fractional CKB to shannon hex", () => {
    expect(ckbToShannonHex("1")).toBe("0x5f5e100");          // 1e8
    expect(ckbToShannonHex("100")).toBe("0x2540be400");      // 1e10
    expect(ckbToShannonHex("0.00000001")).toBe("0x1");       // 1 shannon
    expect(ckbToShannonHex("62.5")).toBe("0x174876e80");     // 62.5e8
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["", "abc", "-5", "1.123456789", "0"]) {
      expect(() => ckbToShannonHex(bad)).toThrow();
    }
  });
});

describe("parseChannelArgs", () => {
  it("parses open with amount conversion", () => {
    const a = parseChannelArgs(["open", "--url", "http://n", "--pubkey", "0x02aa", "--amount", "500"]);
    expect(a.sub).toBe("open");
    expect(a.pubkey).toBe("0x02aa");
    expect(a.fundingAmountHex).toBe("0xba43b7400"); // 500e8
  });
  it("requires --address or --pubkey for connect", () => {
    expect(() => parseChannelArgs(["connect", "--url", "http://n"])).toThrow(/--address or --pubkey/);
  });
  it("close --force requires --yes-force", () => {
    expect(() => parseChannelArgs(["close", "--url", "http://n", "--channel-id", "0xc1", "--force"]))
      .toThrow(/--yes-force/);
    const ok = parseChannelArgs(["close", "--url", "http://n", "--channel-id", "0xc1", "--force", "--yes-force"]);
    expect(ok.force).toBe(true);
  });
  it("update requires at least one change flag", () => {
    expect(() => parseChannelArgs(["update", "--url", "http://n", "--channel-id", "0xc1"]))
      .toThrow(/at least one of/);
    const a = parseChannelArgs(["update", "--url", "http://n", "--channel-id", "0xc1", "--fee-rate", "1500"]);
    expect(a.feeRatePpmHex).toBe("0x5dc");
  });
  it("rejects unknown subcommands", () => {
    expect(() => parseChannelArgs(["explode", "--url", "http://n"])).toThrow(/unknown channel subcommand/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/cli/test/channel-args.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/cli/src/commands/channel.ts`:

```typescript
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ChannelClient, watchChannelState, type RpcChannel } from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";

export type ChannelSub = "connect" | "open" | "list" | "update" | "close" | "watch";
const SUBS: ChannelSub[] = ["connect", "open", "list", "update", "close", "watch"];

export interface ChannelArgs {
  sub: ChannelSub;
  url: string; biscuit?: string; profile?: string; authTokenFile?: string; json: boolean;
  address?: string; pubkey?: string; save: boolean;
  fundingAmountHex?: string; isPrivate: boolean; feeRatePpmHex?: string;
  channelId?: string; enable?: boolean; force: boolean;
  maxPolls: number; intervalSeconds: number;
}

/** Decimal CKB string -> shannon (1e8) 0x-hex. Exact string math; max 8 fraction digits; must be > 0. */
export function ckbToShannonHex(s: string): string {
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new Error(`invalid CKB amount '${s}' (max 8 decimal places)`);
  const [whole, frac = ""] = s.split(".");
  const shannons = BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
  if (shannons <= 0n) throw new Error("amount must be greater than 0");
  return `0x${shannons.toString(16)}`;
}

export function parseChannelArgs(rest: string[]): ChannelArgs {
  const sub = rest[0];
  if (!sub || !(SUBS as string[]).includes(sub)) throw new Error(`unknown channel subcommand '${sub ?? ""}' (expected: ${SUBS.join(", ")})`);
  const flags = new Map<string, string>(); const bools = new Set<string>();
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2); const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) bools.add(key); else { flags.set(key, next); i++; }
  }
  const url = flags.get("url");
  if (!url) throw new Error("missing required flag --url");
  const args: ChannelArgs = {
    sub: sub as ChannelSub, url,
    biscuit: flags.get("biscuit"), profile: flags.get("profile"), authTokenFile: flags.get("auth-token-file"),
    json: bools.has("json"),
    address: flags.get("address"), pubkey: flags.get("pubkey"), save: bools.has("save"),
    isPrivate: bools.has("private"), channelId: flags.get("channel-id"),
    force: bools.has("force"),
    maxPolls: Number(flags.get("max-polls") ?? "60"), intervalSeconds: Number(flags.get("interval") ?? "5")
  };
  if (!Number.isInteger(args.maxPolls) || args.maxPolls < 1) throw new Error("--max-polls must be a positive integer");
  if (!Number.isInteger(args.intervalSeconds) || args.intervalSeconds < 1) throw new Error("--interval must be a positive integer (seconds)");
  const feeRate = flags.get("fee-rate");
  if (feeRate !== undefined) {
    if (!/^\d+$/.test(feeRate)) throw new Error("--fee-rate must be a non-negative integer (ppm)");
    args.feeRatePpmHex = `0x${BigInt(feeRate).toString(16)}`;
  }
  if (bools.has("enable") && bools.has("disable")) throw new Error("--enable and --disable are mutually exclusive");
  if (bools.has("enable")) args.enable = true;
  if (bools.has("disable")) args.enable = false;
  switch (args.sub) {
    case "connect":
      if (!args.address && !args.pubkey) throw new Error("connect requires --address or --pubkey");
      break;
    case "open": {
      if (!args.pubkey) throw new Error("open requires --pubkey");
      const amount = flags.get("amount");
      if (!amount) throw new Error("open requires --amount <CKB>");
      args.fundingAmountHex = ckbToShannonHex(amount);
      break;
    }
    case "update":
      if (!args.channelId) throw new Error("update requires --channel-id");
      if (args.enable === undefined && args.feeRatePpmHex === undefined) throw new Error("update requires at least one of --enable/--disable/--fee-rate");
      break;
    case "close":
      if (!args.channelId) throw new Error("close requires --channel-id");
      if (args.force && !bools.has("yes-force")) throw new Error("force-close burns the commitment transaction — repeat with --force --yes-force to confirm");
      break;
    case "watch":
      if (!args.channelId) throw new Error("watch requires --channel-id");
      break;
    case "list": break;
  }
  return args;
}

const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");

export interface ChannelDeps { makeClient?: (args: ChannelArgs) => ChannelClient; }

function defaultClient(args: ChannelArgs): ChannelClient {
  const token = resolveToken({
    authToken: args.biscuit, authTokenFile: args.authTokenFile, profile: args.profile, env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  return new ChannelClient({ url: args.url, biscuit: token });
}

function renderChannel(c: RpcChannel): string {
  return `${c.channel_id}  ${c.state.state_name}${c.enabled ? "" : " (disabled)"}  local=${BigInt(c.local_balance)}  remote=${BigInt(c.remote_balance)}  peer=${c.pubkey.slice(0, 12)}…${c.failure_detail ? `  FAILURE: ${c.failure_detail}` : ""}`;
}

export async function runChannel(rest: string[], deps: ChannelDeps = {}): Promise<number> {
  let args: ChannelArgs;
  try { args = parseChannelArgs(rest); } catch (e) { console.error(String(e)); return 2; }
  const client = (deps.makeClient ?? defaultClient)(args);
  try {
    switch (args.sub) {
      case "connect":
        await client.connectPeer({ address: args.address, pubkey: args.pubkey, save: args.save || undefined });
        console.log(args.json ? JSON.stringify({ ok: true }) : "OK: connect_peer accepted");
        return 0;
      case "open": {
        const r = await client.openChannel({
          pubkey: args.pubkey!, funding_amount: args.fundingAmountHex!,
          public: args.isPrivate ? false : undefined,
          tlc_fee_proportional_millionths: args.feeRatePpmHex
        });
        console.log(args.json ? JSON.stringify(r) : `OK: negotiation started — temporary_channel_id ${r.temporary_channel_id}\n(watch it: channel watch --url ${args.url} --channel-id ${r.temporary_channel_id} --pubkey ${args.pubkey})`);
        return 0;
      }
      case "list": {
        const channels = await client.listChannels();
        console.log(args.json ? JSON.stringify(channels, null, 2) : channels.length === 0 ? "no channels" : channels.map(renderChannel).join("\n"));
        return 0;
      }
      case "update":
        await client.updateChannel({ channel_id: args.channelId!, enabled: args.enable, tlc_fee_proportional_millionths: args.feeRatePpmHex });
        console.log(args.json ? JSON.stringify({ ok: true }) : "OK: update_channel accepted");
        return 0;
      case "close":
        await client.shutdownChannel({ channel_id: args.channelId!, fee_rate: args.feeRatePpmHex, force: args.force || undefined });
        console.log(args.json ? JSON.stringify({ ok: true }) : `OK: shutdown_channel accepted${args.force ? " (FORCE)" : ""}`);
        return 0;
      case "watch": {
        const r = await watchChannelState(client, args.channelId!, {
          maxPolls: args.maxPolls, delayMs: args.intervalSeconds * 1000,
          counterpartyPubkey: args.pubkey,
          onTick: args.json ? undefined : (polls, state) => console.log(`poll ${polls}/${args.maxPolls}: ${state ?? "not visible yet"}`)
        });
        console.log(args.json ? JSON.stringify(r) : `outcome: ${r.outcome}${r.failureDetail ? ` — ${r.failureDetail}` : ""}${r.channel ? `\n${renderChannel(r.channel)}` : ""}`);
        return r.outcome === "ready" ? 0 : 1;
      }
    }
  } catch (e) {
    console.error(String(e));
    return 2;
  }
}
```

`apps/cli/src/dispatch.ts` — extend both lists:

```typescript
export type Command = "diagnose" | "keys" | "token" | "health" | "liquidity" | "map" | "channel";
const COMMANDS: Command[] = ["diagnose", "keys", "token", "health", "liquidity", "map", "channel"];
```

`apps/cli/src/main.ts` — add with the other imports/routes:

```typescript
import { runChannel } from "./commands/channel.js";
// ... in main(), alongside the other command routes:
if (command === "channel") process.exit(await runChannel(rest));
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run apps/cli/test/channel-args.test.ts && npm run typecheck:cli`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/channel.ts apps/cli/src/dispatch.ts apps/cli/src/main.ts apps/cli/test/channel-args.test.ts
git commit -m "feat(cli): channel command group (connect/open/list/update/close/watch)"
```

---

### Task 5: Demo channel simulator

**Files:**
- Create: `apps/web/src/demo/channel-sim.ts`
- Test: `apps/web/test/channel-sim.test.ts`

**Interfaces:**
- Consumes: `demoFetch` shape (`typeof fetch` serving JSON-RPC), `RpcChannel` from `@fiber-route-doctor/core`.
- Produces: `makeChannelSimFetch(base: typeof fetch): typeof fetch`. Task 6 wires it as the ChannelPanel's `fetchOverride` in demo mode.

- [ ] **Step 1: Write the failing tests** — `apps/web/test/channel-sim.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeChannelSimFetch } from "../src/demo/channel-sim.js";
import { demoFetch } from "../src/demo/demo-fetch.js";

const AUTH = { Authorization: "Bearer sim-token", "Content-Type": "application/json" };
async function rpc(f: typeof fetch, method: string, params: unknown[] = [{}], headers: Record<string, string> = AUTH) {
  const res = await f("http://sim", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json());
}
const channels = async (f: typeof fetch) => (await rpc(f, "list_channels")).result.channels;

describe("makeChannelSimFetch", () => {
  it("open_channel appends a NegotiatingFunding channel; each list poll advances one step to ChannelReady", async () => {
    const f = makeChannelSimFetch(demoFetch);
    await rpc(f, "connect_peer", [{ address: "/ip4/1.1.1.1/tcp/8228/p2p/x" }]);
    const open = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x2540be400" }]);
    expect(open.result.temporary_channel_id).toMatch(/^0x/);
    const states: string[] = [];
    for (let i = 0; i < 5; i++) states.push((await channels(f))[0].state.state_name);
    expect(states).toEqual(["NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady", "ChannelReady"]);
    const ready = (await channels(f))[0];
    expect(ready.local_balance).toBe("0x2540be400"); // opener holds the full balance
    expect(ready.enabled).toBe(true);
  });
  it("update_channel mutates enabled and fee", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const open = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x5f5e100" }]);
    await rpc(f, "update_channel", [{ channel_id: open.result.temporary_channel_id, enabled: false, tlc_fee_proportional_millionths: "0x5dc" }]);
    expect((await channels(f))[0].enabled).toBe(false);
  });
  it("shutdown marches to Closed then removes after 2 more polls", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const open = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x5f5e100" }]);
    for (let i = 0; i < 5; i++) await channels(f); // reach ChannelReady
    await rpc(f, "shutdown_channel", [{ channel_id: open.result.temporary_channel_id }]);
    expect((await channels(f))[0].state.state_name).toBe("Closed");
    await channels(f);
    expect((await channels(f)).length).toBe(0);
  });
  it("returns -32999 when the request has no Authorization header", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const r = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x1" }], { "Content-Type": "application/json" });
    expect(r.error.code).toBe(-32999);
  });
  it("errors on unknown channel_id and delegates non-channel methods to base", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const bad = await rpc(f, "update_channel", [{ channel_id: "0xnope", enabled: true }]);
    expect(bad.error).toBeTruthy();
    const gi = await rpc(f, "graph_channels");
    expect(gi.result.channels.length).toBeGreaterThan(600); // delegated to demoFetch fixtures
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/web/test/channel-sim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/web/src/demo/channel-sim.ts`:

```typescript
import type { RpcChannel } from "@fiber-route-doctor/core";

const MARCH = ["NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady", "ChannelReady"] as const;
const CHANNEL_METHODS = new Set(["connect_peer", "open_channel", "list_channels", "update_channel", "shutdown_channel"]);

interface SimChannel extends RpcChannel { _closedPolls?: number; }

const err = (id: number | undefined, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status: 200, headers: { "Content-Type": "application/json" } });
const ok = (id: number | undefined, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "Content-Type": "application/json" } });

/**
 * Stateful fetch for the hosted demo: channel methods run against an in-memory list whose
 * pending states advance ONE step per list_channels poll; everything else delegates to `base`.
 * Error-faithful: -32999 without an Authorization header; method error for unknown channel ids.
 * State is per-factory-call — recreate on demo-toggle to reset.
 */
export function makeChannelSimFetch(base: typeof fetch): typeof fetch {
  const sim: SimChannel[] = [];
  let counter = 0;

  return (async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string; params?: unknown[] };
    const method = body.method ?? "";
    if (!CHANNEL_METHODS.has(method)) return base(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (!headers["Authorization"]) return err(body.id, -32999, "Unauthorized");
    const p = (body.params?.[0] ?? {}) as Record<string, unknown>;

    switch (method) {
      case "connect_peer":
        return ok(body.id, null);
      case "open_channel": {
        const id = `0x53494d${(++counter).toString(16).padStart(58, "0")}`; // "SIM"-prefixed hex id
        sim.push({
          channel_id: id, pubkey: String(p.pubkey ?? "0x02"), state: { state_name: MARCH[0] },
          local_balance: String(p.funding_amount ?? "0x0"), remote_balance: "0x0",
          offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
          enabled: false, is_public: p.public !== false, pending_tlcs: [],
          created_at: `0x${Date.now().toString(16)}`, funding_udt_type_script: null
        });
        return ok(body.id, { temporary_channel_id: id });
      }
      case "list_channels": {
        for (const c of sim) {
          const i = (MARCH as readonly string[]).indexOf(c.state.state_name);
          if (i >= 0 && i < MARCH.length - 1) {
            c.state = { state_name: MARCH[i + 1] };
            if (MARCH[i + 1] === "ChannelReady") c.enabled = true;
          } else if (c.state.state_name === "Closed") {
            c._closedPolls = (c._closedPolls ?? 0) + 1;
          }
        }
        for (let i = sim.length - 1; i >= 0; i--) if ((sim[i]._closedPolls ?? 0) >= 2) sim.splice(i, 1);
        return ok(body.id, { channels: sim.map(({ _closedPolls, ...c }) => c) });
      }
      case "update_channel": {
        const c = sim.find((x) => x.channel_id === p.channel_id);
        if (!c) return err(body.id, -32602, `channel not found: ${String(p.channel_id)}`);
        if (typeof p.enabled === "boolean") c.enabled = p.enabled;
        return ok(body.id, null);
      }
      case "shutdown_channel": {
        const c = sim.find((x) => x.channel_id === p.channel_id);
        if (!c) return err(body.id, -32602, `channel not found: ${String(p.channel_id)}`);
        c.state = { state_name: "Closed" };
        c.enabled = false;
        return ok(body.id, null);
      }
    }
    return base(input, init);
  }) as typeof fetch;
}
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run apps/web/test/channel-sim.test.ts && npm run typecheck:web`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/demo/channel-sim.ts apps/web/test/channel-sim.test.ts
git commit -m "feat(web): stateful channel simulator for the hosted demo"
```

---

### Task 6: ChannelPanel + form helpers + App wiring

**Files:**
- Create: `apps/web/src/channel-form.ts`
- Create: `apps/web/src/ChannelPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/test/channel-form.test.ts`

**Interfaces:**
- Consumes: `ChannelClient`, `RpcChannel` from core; `useWallet()` (profile picker pattern from `DiagnosePanel.tsx`); `makeChannelSimFetch` + `demoFetch` (Task 5); `graphClientOptionsFor`-style option building (inline — ChannelClient takes the same `{url, biscuit, fetchImpl}`).
- Produces: `ChannelPanel({ fetchOverride?, demoActive })`; pure helpers `parseCkbAmount(s): string` (hex, throws w/ message), `shannonHexToCkb(hex): string`, `unauthorizedHint(readProbeSucceeded: boolean): string`, `PENDING_STATES: Set<string>`.

- [ ] **Step 1: Write the failing tests** — `apps/web/test/channel-form.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCkbAmount, shannonHexToCkb, unauthorizedHint, PENDING_STATES } from "../src/channel-form.js";

describe("parseCkbAmount", () => {
  it("converts CKB decimal strings to shannon hex", () => {
    expect(parseCkbAmount("100")).toBe("0x2540be400");
    expect(parseCkbAmount("62.5")).toBe("0x174876e80");
  });
  it("throws readable errors on junk", () => {
    expect(() => parseCkbAmount("")).toThrow(/CKB amount/);
    expect(() => parseCkbAmount("1.123456789")).toThrow(/decimal/);
    expect(() => parseCkbAmount("0")).toThrow(/greater than 0/);
  });
});

describe("shannonHexToCkb", () => {
  it("renders hex shannons as CKB", () => {
    expect(shannonHexToCkb("0x2540be400")).toBe("100");
    expect(shannonHexToCkb("0x174876e80")).toBe("62.5");
    expect(shannonHexToCkb("0x1")).toBe("0.00000001");
  });
});

describe("unauthorizedHint", () => {
  it("distinguishes scope-insufficient from key-mismatch", () => {
    expect(unauthorizedHint(true)).toMatch(/scope/i);   // reads work, write denied -> scope
    expect(unauthorizedHint(true)).toMatch(/operator/);
    expect(unauthorizedHint(false)).toMatch(/node's key|node key/i); // everything denied -> wrong key
  });
});

describe("PENDING_STATES", () => {
  it("covers the pre-ready march but not terminal states", () => {
    for (const s of ["NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady"]) {
      expect(PENDING_STATES.has(s)).toBe(true);
    }
    expect(PENDING_STATES.has("ChannelReady")).toBe(false);
    expect(PENDING_STATES.has("Closed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/web/test/channel-form.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers** — `apps/web/src/channel-form.ts`:

```typescript
/** Decimal CKB string -> shannon (1e8) 0x-hex. Mirrors the CLI's ckbToShannonHex. */
export function parseCkbAmount(s: string): string {
  if (!/^\d+(\.\d{1,8})?$/.test(s.trim())) throw new Error("invalid CKB amount (digits with up to 8 decimal places)");
  const [whole, frac = ""] = s.trim().split(".");
  const shannons = BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
  if (shannons <= 0n) throw new Error("amount must be greater than 0");
  return `0x${shannons.toString(16)}`;
}

/** 0x-hex shannons -> CKB decimal string with trailing zeros trimmed. */
export function shannonHexToCkb(hex: string): string {
  const v = BigInt(hex);
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** -32999 guidance: if a read (list_channels) succeeded with the same token, the write scope is missing. */
export function unauthorizedHint(readProbeSucceeded: boolean): string {
  return readProbeSucceeded
    ? "Unauthorized: token scope is insufficient for this operation — mint an 'operator' token (connect_peer needs write(\"peers\"), channel ops need write(\"channels\"))."
    : "Unauthorized: token was not accepted at all — it must be minted from the node's own biscuit key (import the node key in the Wallet, then mint).";
}

export const PENDING_STATES: ReadonlySet<string> = new Set([
  "NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady"
]);
```

- [ ] **Step 4: Verify helpers green**

Run: `npx vitest run apps/web/test/channel-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the panel** — `apps/web/src/ChannelPanel.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChannelClient, RpcMethodError, type RpcChannel } from "@fiber-route-doctor/core";
import { useWallet } from "./wallet-context.js";
import { parseCkbAmount, shannonHexToCkb, unauthorizedHint, PENDING_STATES } from "./channel-form.js";

interface ChannelPanelProps { fetchOverride?: typeof fetch; demoActive: boolean; }
type Confirm = { kind: "open"; pubkey: string; amountCkb: string } | { kind: "close"; channelId: string; force: boolean } | null;

export function ChannelPanel({ fetchOverride, demoActive }: ChannelPanelProps) {
  const { profiles } = useWallet();
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");
  const [address, setAddress] = useState("");
  const [openPubkey, setOpenPubkey] = useState("");
  const [amountCkb, setAmountCkb] = useState("500");
  const [channels, setChannels] = useState<RpcChannel[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [forceText, setForceText] = useState("");
  const [feeDraft, setFeeDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }
  const makeClient = useCallback(
    () => new ChannelClient({ url, biscuit: token.trim() || undefined, fetchImpl: fetchOverride }),
    [url, token, fetchOverride]
  );

  async function explainAndSetError(e: unknown) {
    if (e instanceof RpcMethodError && e.code === -32999) {
      let readOk = false;
      try { await makeClient().listChannels(); readOk = true; } catch { /* readOk stays false */ }
      setError(unauthorizedHint(readOk));
    } else { setError(String(e)); }
  }

  const refresh = useCallback(async () => {
    const id = ++runId.current;
    try {
      const list = await makeClient().listChannels();
      if (id === runId.current) { setChannels(list); setError(""); }
    } catch (e) { if (id === runId.current) await explainAndSetError(e); }
  }, [makeClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-poll while any channel is mid-lifecycle
  useEffect(() => {
    if (!channels?.some((c) => PENDING_STATES.has(c.state.state_name) || c.state.state_name === "Closed")) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [channels, refresh]);

  async function guard(run: () => Promise<void>) {
    setBusy(true); setMsg(""); setError("");
    try { await run(); } catch (e) { await explainAndSetError(e); } finally { setBusy(false); }
  }
  const doConnect = () => guard(async () => {
    await makeClient().connectPeer({ address: address.trim() });
    setMsg("connect_peer accepted"); await refresh();
  });
  const doOpen = (pubkey: string, amount: string) => guard(async () => {
    const r = await makeClient().openChannel({ pubkey: pubkey.trim(), funding_amount: parseCkbAmount(amount) });
    setMsg(`negotiation started — ${r.temporary_channel_id.slice(0, 14)}…`); setConfirm(null); await refresh();
  });
  const doUpdate = (c: RpcChannel, enabled?: boolean) => guard(async () => {
    const fee = feeDraft[c.channel_id]?.trim();
    await makeClient().updateChannel({
      channel_id: c.channel_id, enabled,
      tlc_fee_proportional_millionths: fee && /^\d+$/.test(fee) ? `0x${BigInt(fee).toString(16)}` : undefined
    });
    setMsg("update_channel accepted"); await refresh();
  });
  const doClose = (channelId: string, force: boolean) => guard(async () => {
    await makeClient().shutdownChannel({ channel_id: channelId, force: force || undefined });
    setMsg(`shutdown_channel accepted${force ? " (FORCE)" : ""}`); setConfirm(null); setForceText(""); await refresh();
  });

  return (
    <section style={{ marginTop: "0.25rem" }}>
      {demoActive && <div style={{ display: "inline-block", background: "#f1c40f", color: "#111", fontWeight: "bold", padding: "0.1rem 0.5rem", marginBottom: "0.5rem" }}>SIMULATED</div>}
      {demoActive && <div style={{ fontSize: 12, color: "#8aa" }}>Simulator checks only that a token is attached — mint any token in the Wallet above, pick it here, and click through the real lifecycle.</div>}
      {profiles.length > 0 && (
        <div style={{ margin: "0.4rem 0" }}>
          <label>profile: <select defaultValue="" onChange={(e) => applyProfile(e.target.value)}>
            <option value="" disabled>— pick a minted token —</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.scope})</option>)}
          </select></label>
        </div>
      )}
      <div style={{ margin: "0.4rem 0" }}><label>node url: <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 420 }} /></label></div>
      <div style={{ margin: "0.4rem 0" }}><label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label></div>

      <h3>Connect peer</h3>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="/ip4/../tcp/../p2p/.." style={{ width: 420 }} />
        <button onClick={doConnect} disabled={busy || !address.trim()}>Connect</button>
      </div>

      <h3 style={{ marginTop: "1rem" }}>Open channel</h3>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
        <input value={openPubkey} onChange={(e) => setOpenPubkey(e.target.value)} placeholder="peer pubkey 0x02.." style={{ width: 320 }} />
        <label>amount (CKB) <input value={amountCkb} onChange={(e) => setAmountCkb(e.target.value)} style={{ width: 90 }} /></label>
        <button onClick={() => setConfirm({ kind: "open", pubkey: openPubkey, amountCkb })} disabled={busy || !openPubkey.trim() || !amountCkb.trim()}>Open…</button>
      </div>
      <div style={{ fontSize: 12, color: "#8aa" }}>funding must clear the peer's auto-accept floor (its node_info `open_channel_auto_accept_min_ckb_funding_amount`) and the node wallet must hold the CKB</div>

      <h3 style={{ marginTop: "1rem" }}>Channels</h3>
      <button onClick={refresh} disabled={busy}>Refresh</button>
      {channels !== null && channels.length === 0 && <div style={{ color: "#8aa", marginTop: "0.4rem" }}>no channels</div>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {(channels ?? []).map((c) => (
          <li key={c.channel_id} style={{ margin: "0.5rem 0", borderLeft: `3px solid ${c.state.state_name === "ChannelReady" ? "#2ecc71" : PENDING_STATES.has(c.state.state_name) ? "#f1c40f" : "#e74c3c"}`, paddingLeft: "0.6rem" }}>
            <div><strong>{c.state.state_name}</strong>{c.enabled ? "" : " (disabled)"} — {c.channel_id.slice(0, 14)}… peer {c.pubkey.slice(0, 12)}…</div>
            <div style={{ fontSize: 13 }}>local {shannonHexToCkb(c.local_balance)} CKB / remote {shannonHexToCkb(c.remote_balance)} CKB</div>
            {c.failure_detail && <div style={{ color: "#e74c3c" }}>FAILURE: {c.failure_detail}</div>}
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.2rem", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => doUpdate(c, !c.enabled)} disabled={busy}>{c.enabled ? "Disable" : "Enable"}</button>
              <input value={feeDraft[c.channel_id] ?? ""} onChange={(e) => setFeeDraft({ ...feeDraft, [c.channel_id]: e.target.value })} placeholder="fee ppm" style={{ width: 80 }} />
              <button onClick={() => doUpdate(c)} disabled={busy || !(feeDraft[c.channel_id] ?? "").trim()}>Set fee</button>
              <button onClick={() => setConfirm({ kind: "close", channelId: c.channel_id, force: false })} disabled={busy}>Close…</button>
              <button onClick={() => setConfirm({ kind: "close", channelId: c.channel_id, force: true })} disabled={busy} style={{ color: "#e74c3c" }}>Force close…</button>
            </div>
          </li>
        ))}
      </ul>

      {confirm?.kind === "open" && (
        <div style={{ border: "1px solid #f1c40f", padding: "0.6rem", margin: "0.6rem 0" }}>
          Open a channel to <code>{confirm.pubkey.slice(0, 20)}…</code> funding <strong>{confirm.amountCkb} CKB</strong> from the node wallet?
          <div style={{ marginTop: "0.4rem" }}>
            <button onClick={() => doOpen(confirm.pubkey, confirm.amountCkb)} disabled={busy}>Confirm open</button>{" "}
            <button onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {confirm?.kind === "close" && (
        <div style={{ border: "1px solid #e74c3c", padding: "0.6rem", margin: "0.6rem 0" }}>
          {confirm.force ? <>FORCE-close <code>{confirm.channelId.slice(0, 14)}…</code>? This broadcasts the commitment tx. Type <strong>force</strong> to enable:</>
            : <>Cooperatively close <code>{confirm.channelId.slice(0, 14)}…</code>?</>}
          <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {confirm.force && <input value={forceText} onChange={(e) => setForceText(e.target.value)} placeholder="type force" style={{ width: 100 }} />}
            <button onClick={() => doClose(confirm.channelId, confirm.force)} disabled={busy || (confirm.force && forceText !== "force")}>Confirm close</button>
            <button onClick={() => { setConfirm(null); setForceText(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ color: "#2ecc71", marginTop: "0.5rem" }}>{msg}</div>}
      {error && <pre style={{ color: "#e74c3c", whiteSpace: "pre-wrap" }}>{error}</pre>}
    </section>
  );
}
```

- [ ] **Step 6: Wire into App** — `apps/web/src/App.tsx`:

Add imports:
```tsx
import { ChannelPanel } from "./ChannelPanel.js";
import { makeChannelSimFetch } from "./demo/channel-sim.js";
import { useMemo } from "react"; // merge into the existing react import
```
Inside `App()`, replace the `fetchOverride` line and add a sim instance that resets on demo toggle:
```tsx
const fetchOverride = demo ? demoFetch : undefined;
const channelFetchOverride = useMemo(() => (demo ? makeChannelSimFetch(demoFetch) : undefined), [demo]);
```
Add the section between the Wallet and Diagnose heroes (plain heading — no hero plate exists for it yet):
```tsx
<h2 style={{ fontFamily: "monospace", letterSpacing: "0.05em", borderBottom: "1px solid #3498db", paddingBottom: "0.3rem", marginTop: "2rem" }}>Channels</h2>
<ChannelPanel fetchOverride={channelFetchOverride} demoActive={demo} />
```

- [ ] **Step 7: Verify green + build**

Run: `npm test && npm run typecheck && (cd apps/web && npx vite build)`
Expected: all tests PASS (baseline 244 + new), typecheck clean, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/channel-form.ts apps/web/src/ChannelPanel.tsx apps/web/src/App.tsx apps/web/test/channel-form.test.ts
git commit -m "feat(web): ChannelPanel with confirms, auto-poll, sim badge; wire channel sim into App"
```

---

### Task 7: Live smoke + README + browser verification

**Files:**
- Create: `scripts/channel-live-smoke.mjs`
- Modify: `package.json` (root — add `smoke:channel` script)
- Modify: `README.md` (channel manager section)

**Interfaces:**
- Consumes: `ChannelClient` (Task 2), `scopeFacts("operator")` (Task 1), mint pattern from `scripts/biscuit-live-smoke.mjs`.
- Produces: `npm run smoke:channel` (SKIP without env; never funds a channel).

- [ ] **Step 1: Write the smoke** — `scripts/channel-live-smoke.mjs`:

```javascript
// Channel-manager live smoke: proves the AUTHORIZED write path without funding anything.
//   1. operator token accepted on connect_peer (FRD_PEER_ADDR peer);
//   2. open_channel with an absurd funding amount fails CLEANLY (error, not a hang/success).
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        FRD_PEER_ADDR=/ip4/../tcp/8228/p2p/Qm.. node --import tsx scripts/channel-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { ChannelClient, RpcMethodError } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
const peer = process.env.FRD_PEER_ADDR;
if (!keyPath || !url || !peer) { console.log("SKIP channel-live-smoke: set FRD_BISCUIT_KEY, FIBER_RPC_URL, FRD_PEER_ADDR"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("operator"), expiry: new Date(Date.now() + 3600e3) });
const client = new ChannelClient({ url, biscuit: token });

// 1. connect_peer must be AUTHORIZED (write("peers") via operator). Transport/peer errors are fine; -32999 is not.
try {
  await client.connectPeer({ address: peer });
  console.log("connect_peer: accepted");
} catch (e) {
  if (e instanceof RpcMethodError && e.code === -32999) { console.error("FAIL: operator token unauthorized on connect_peer"); process.exit(1); }
  console.log(`connect_peer: authorized (node reported: ${e.message ?? e})`);
}

// 2. absurd open must fail cleanly — proves the authorized open path w/o spending (100B CKB in shannons).
try {
  await client.openChannel({ pubkey: key.publicKeyString.replace("ed25519/", "0x02"), funding_amount: "0x" + (10_000_000_000_000_000_000n).toString(16) });
  console.error("FAIL: absurd open_channel unexpectedly succeeded");
  process.exit(1);
} catch (e) {
  if (e instanceof RpcMethodError && e.code === -32999) { console.error("FAIL: operator token unauthorized on open_channel"); process.exit(1); }
  console.log(`open_channel(absurd): rejected cleanly — ${e.message ?? e}`);
}
console.log("OK: operator write path authorized end-to-end; nothing was funded");
```

- [ ] **Step 2: Register the script** — root `package.json` scripts block gains:

```json
"smoke:channel": "node --import tsx scripts/channel-live-smoke.mjs"
```

- [ ] **Step 3: Run gated + live**

Run: `npm run smoke:channel` (no env) → expect `SKIP channel-live-smoke: ...`, exit 0.
Then live (peer addr = another fleet node, e.g. the N100 from the bootnodes list):
`FRD_BISCUIT_KEY=$HOME/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 FRD_PEER_ADDR=/ip4/192.168.68.91/tcp/8229/p2p/<peer-id> npm run smoke:channel`
Expected: `connect_peer: accepted` (or authorized-with-node-error), `open_channel(absurd): rejected cleanly`, `OK: ...`.

- [ ] **Step 4: README** — add under the existing tools sections:

```markdown
## Channel Manager (CLI + web)

Manage channels on your own node with an `operator`-scoped token (readonly + write("channels") + write("peers")):

    fiber-route-doctor token generate --scope operator --profile op --url http://127.0.0.1:8231
    fiber-route-doctor channel connect --url http://127.0.0.1:8231 --profile op --address /ip4/../tcp/8228/p2p/..
    fiber-route-doctor channel open    --url http://127.0.0.1:8231 --profile op --pubkey 0x02.. --amount 500
    fiber-route-doctor channel watch   --url http://127.0.0.1:8231 --profile op --channel-id 0x.. --pubkey 0x02..
    fiber-route-doctor channel update  --url http://127.0.0.1:8231 --profile op --channel-id 0x.. --fee-rate 1500
    fiber-route-doctor channel close   --url http://127.0.0.1:8231 --profile op --channel-id 0x..

Force-close requires `--force --yes-force`. The web panel mirrors this flow; in hosted demo
mode it runs a clearly-badged in-browser simulator (states march to ChannelReady per poll).

Live validation: `FRD_BISCUIT_KEY=... FIBER_RPC_URL=... FRD_PEER_ADDR=... npm run smoke:channel`
(never funds a channel — asserts authorization + clean rejection of an absurd open).
```

- [ ] **Step 5: Browser verification (controller runs pre-merge)**

`cd apps/web && npx vite build && npx vite preview --port 4173`, then with playwright: load `/fiber-route-doctor/`, toggle Demo data, create/import wallet + mint any token, select it in the Channels panel, Open (confirm) → watch states march to ChannelReady on auto-poll → Set fee → Close (confirm) → gone after 2 polls; SIMULATED badge visible. Stop the preview.

- [ ] **Step 6: Final green + commit**

Run: `npm test && npm run typecheck`
Expected: all PASS.

```bash
git add scripts/channel-live-smoke.mjs package.json README.md
git commit -m "feat: gated channel live-smoke (never funds) + channel manager docs"
```

---

## Done / verification (whole sub-project)

- `npm test` green (baseline 244 + ~25 new), `npm run typecheck` clean, `vite build` clean.
- `smoke:channel` SKIPs without env; live run proves operator-authorized connect + clean absurd-open rejection.
- Browser: demo-sim lifecycle (open → ChannelReady → fee → close) with SIMULATED badge.
- Ground-truth scope test pins operator-vs-old-full against the node's connect_peer rule.
- No funded channel is ever opened by tests/smokes — funding happens only in Sub-project C, human-triggered.
```
