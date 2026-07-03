# Fiber Infrastructure Gap Analysis & Roadmap

*fiber-route-doctor toolkit — "Gone in 60ms" Fiber Infrastructure Hackathon, July 2026*

*Every claim in this document is backed by working public code, automated tests, or live-testnet output. Unverified statements are marked as such.*

## 1. Executive summary

fnn works — but the distance between a running binary and an **operable** network is wide. A node operator today can start a Fiber node, open the RPC port, and immediately hit a wall: the node demands authentication tokens that nothing ships a way to create, fails payments without saying why, exposes no health endpoint, reports liquidity as raw per-channel state, and will happily show you a healthy-looking network graph while your own node is completely isolated.

We crossed that distance by building five open-source tools in three days (2026-07-01 → 2026-07-03), and this document is the map we drew along the way. The five gaps:

1. **Credential lifecycle** — fnn mandates biscuit auth on public listeners but ships no way to mint a token.
2. **Payment-failure diagnostics** — failures are opaque; there is no dry-run or route-explain.
3. **Health & readiness** — no health endpoint, and auth-rejection semantics are undocumented.
4. **Liquidity observability** — no aggregates, no history, undocumented balance semantics.
5. **Topology visibility & bootstrap** — gossip persists while a node is isolated, silently.

Every gap is paired with evidence: the tool we built to close it (5 tools, 209 automated tests, typecheck-clean TypeScript monorepo) and live proof against a real testnet node — including a network map of **246 nodes and 650 channels** rendered from our own vantage point, and a health verdict that correctly caught our own node's isolation. Recommendations split cleanly into what upstream fnn should ship and what the operator-tooling layer covers today.

Fiber is early, and gaps at this stage are normal. The point of this document is not criticism — it is a prioritized, reproducible map of what stands between a working binary and an operable network, from a team that walked the whole path in one hackathon window.

## 2. Method and evidence standards

Evidence for this document was gathered four ways.

**Built tools, test-first.** All five tools were built via test-driven development in a single npm-workspaces monorepo (`packages/core`, `packages/biscuit`, `apps/cli`, `apps/web`): 209 tests passing, aggregate strict-TypeScript typecheck clean. Each tool's per-task work went through independent code review, and each feature branch through a whole-branch review before merge.

**Live validation.** Every tool closed its loop against a real testnet node — a deployed fnn self-reporting **v0.7.1** (`node_info.version`, commit `4c1fde7…`). Where a tool's live output appears below, it is quoted from the recorded run.

**Source grounding.** Protocol-behavior claims are grounded against the `nervosnetwork/fiber` source (research snapshot spanning v0.6.1–v0.9.0-rc5), cited by upstream path. Because our deployed node runs v0.7.1 while current source is v0.9.0-rc5, claims are version-scoped where behavior could differ — and that drift is itself a finding (trap 3, §4).

**Prior verified research.** Protocol context (§6) draws on our two-pass, adversarially-verified June 2026 research comparing Fiber to Lightning, preserving its original confidence gradings. Claims that research could not verify are not upgraded here.

One rule throughout: a claim either carries a pointer — source path, tool test, or live output — or it is explicitly marked unverified.

## 3. The five gaps

### Gap 1: Credential lifecycle — mandatory auth, no way to mint

fnn requires biscuit authentication on any publicly-bound RPC listener and verifies tokens against `rpc.biscuit_public_key`, enforcing per-method datalog rules in `crates/fiber-lib/src/rpc/biscuit.rs` (`build_rules()`):

```rust
b.rule("list_channels", r#"allow if read("channels");"#);
b.rule("graph_nodes",  r#"allow if read("graph");"#);
b.rule("node_info",    r#"allow if read("node");"#);
```

That is a sound design — scoped, capability-style tokens per RPC method. The gap: **nothing in the shipped tooling mints those tokens.** We searched the fiber-cli command surface of the research snapshot for any `token` or `mint` subcommand: none exists; `fiber-cli` only *consumes* tokens (`--auth-token`, `--auth-token-file`, `FNN_AUTH_TOKEN`) (version scope: corpus ≤ v0.9.0-rc5). An operator who binds a public listener — which mainstream deployment requires — is left to discover the biscuit-wasm API themselves, along with its sharp edges (trap 7, §4).

**What we built.** A full credential lifecycle: BIP39 mnemonic → SLIP-0010 Ed25519 derivation (path `m/44'/1'/0'`) → biscuit key; an encrypted keystore (scrypt N=2¹⁵ + XChaCha20-Poly1305, files written 0600 via atomic temp-and-rename); scoped token minting with `readonly` / `invoicing` / `full` templates that mirror fnn's own datalog facts; token profiles; and offline token inspection.

**Live proof.** Our minted token was accepted by the real node on the first attempt: *"minted readonly token, authenticated, graph_channels returned 500 channels"* (2026-07-02 — the 500 figure is itself a finding; see trap 6).

| | |
|---|---|
| **Upstream ask** | `fnn token mint` / `fnn token inspect` subcommands + documented scope templates |
| **Toolkit today** | `fiber-route-doctor keys init/import` and `token generate/list/show/inspect` |

### Gap 2: Payment-failure diagnostics — opaque failures, no dry-run

When a payment cannot route, the operator gets a failure — not a reason. There is no dry-run or route-explain RPC in the corpus snapshot (version-scoped); the nearest primitive is `build_router`, which returns a route or an error but not a structured diagnosis of *why* candidate paths fail.

The API surface also hides a genuine trap that doubles as a documentation gap: **two different fee scales on one surface.** A channel's advertised `fee_rate` is parts-per-million (divide by 1,000,000), while the payment-level `max_fee_rate` ceiling is per-thousand (divide by 1,000). Conflating them mis-prices every hop by three orders of magnitude — we hit this while building the pathfinder, and it is baked into our implementation as a hard-won constant pair (trap 4, §4).

**What we built.** Route Doctor: pulls `graph_nodes`/`graph_channels`, builds an immutable graph model, runs a constrained least-fee pathfinder, and — when no acceptable route exists — attributes the failure across ten structured causes (`target_absent`, `no_asset_channel`, `asset_mismatch`, `channel_disabled`, `below_min_value`, `above_max_value`, `insufficient_capacity`, `expiry_over_limit`, `fee_over_limit`, `router_declined`), each with a suggested fix, plus an optional `build_router` cross-check against the node's own routing (`packages/core/src/types.ts`, `attribute.ts`).

| | |
|---|---|
| **Upstream ask** | A dry-run / route-explain RPC returning structured failure causes |
| **Toolkit today** | `fiber-route-doctor diagnose --source … --target … --amount …` |

### Gap 3: Health & readiness — no endpoint, undocumented auth semantics

There is no health or readiness RPC. An operator (or an orchestrator's liveness probe) must synthesize one from `node_info`, `list_peers`, and `list_channels` — three calls with three different failure modes.

Worse, the auth-rejection contract is undocumented and surprising: a rejected or missing token does not produce an HTTP 401. The middleware returns a **JSON-RPC method error `-32999 "Unauthorized"` over HTTP 200** (`crates/fiber-lib/src/rpc/middleware.rs`):

```rust
fn auth_reject_error() -> ErrorObjectOwned {
    ErrorObject::owned(-32999, "Unauthorized", None::<()>)
}
```

Meanwhile a node deployed behind a reverse proxy doing its own auth *will* return HTTP 401/403. A client that classifies only one of these shapes reports "node down" when the truth is "auth problem" — a diagnosis that sends the operator to entirely the wrong runbook.

**What we built.** A health probe running five checks — reachability, authentication, node info, peer connectivity, channel health — each returning pass/warn/fail with a reason and a concrete fix, composed into a worst-status verdict with scriptable exit codes (0/1/2). It classifies both auth-rejection shapes (`-32999` and HTTP 401/403) as auth failures, not transport failures. A `--watch` mode re-probes on an interval and fires **edge-triggered webhooks** (generic/Slack/Discord) only when a check changes status.

**Live proof.** The probe's first live verdict was a true positive — it caught our own node's isolation: *"✗ Peer connectivity — 0 peers — node is isolated (no gossip, no routing)"* on *"fnn v0.7.1"*.

| | |
|---|---|
| **Upstream ask** | A health/readiness RPC + a documented auth-error contract |
| **Toolkit today** | `fiber-route-doctor health [--watch --webhook …]` |

### Gap 4: Liquidity observability — raw state, no aggregates, no history

`list_channels` returns rich per-channel state — balances, TLC holds, channel state flags — but answers none of the questions an operator actually asks: *How much can I send right now? How much can I receive? What is my largest single payment? What changed since yesterday?* There are no aggregate views and no history, and the semantics of `local_balance` versus the `offered_tlc_balance`/`received_tlc_balance` holds are undocumented (we determined them empirically; unverified against upstream docs because no upstream docs state them).

**What we built.** A liquidity snapshot tool: per-asset aggregates computed only over channels that are both `ChannelReady` and enabled (send/receive totals, largest single sendable/receivable payment, in-flight holds), per-channel balance-skew flags (`drained` <10% local — can't send; `full` >90% — can't receive), and per-peer groupings. Snapshots persist as raw, JSON-safe observations (`--save`, atomic 0600 files) so `--diff` reports opened/closed channels and balance drift between any two points in time — and stays valid as the analytics evolve, because raw observations, not derived numbers, are what's stored.

**Live proof.** Run against our (then channel-less) node, the tool reported the truth rather than a zero-filled table: *"no channels — nothing to snapshot … OK: snapshot built — 0 channel(s), 0 asset(s), 0 excluded."*

| | |
|---|---|
| **Upstream ask** | Documented balance/hold semantics; optionally an aggregate liquidity RPC |
| **Toolkit today** | `fiber-route-doctor liquidity [--save] [--diff] [--json]` |

### Gap 5: Topology visibility & bootstrap — a network that looks fine while you're alone

The gossip store persists independently of connectivity. Our node reported **hundreds of gossiped channels while having zero peers** — `graph_channels` full of data, `list_peers` empty. To a new operator the network "looks fine" precisely while their node can route nothing, receive nothing, and settle nothing. No log line, no `node_info` field, nothing warns that the node is isolated; and getting un-isolated means manually finding a peer multiaddr for `connect_peer`, with no documented starter peers.

The same shape confuses in a second way: `graph_channels` (the network's gossip) versus `list_channels` (your own channels) is the #1 new-operator conflation — "the node shows 500 channels" and "the node has 0 channels" are simultaneously true (trap 5, §4).

**What we built.** A network map — pure topology model plus a deterministic force-directed layout (same graph in, same map out) — rendered two ways: an interactive web panel (pan/zoom, node details, top-10 hubs, and an overlay that draws Route Doctor's diagnosed path onto the live topology) and a CLI export producing a fully self-contained HTML file, hostable as-is. The health probe (§Gap 3) flags isolation explicitly.

**Live proof.** The map rendered the live testnet — **246 nodes, 650 channels** after our pagination fix (trap 6) — *from an isolated node*, which is exactly the paradox this gap describes.

| | |
|---|---|
| **Upstream ask** | Isolation warnings (log + `node_info`); documented bootstrap peers |
| **Toolkit today** | `fiber-route-doctor map --out fiber-map.html` + `health` isolation check |

## 4. Trap catalog: reproducible sharp edges

Everything below was hit while building the toolkit, and each entry gives the shortest reproduction we know. The repro commands assume the toolkit repo (`npm install`, Node ≥ 22), a running fnn node, and — where a token is needed — the smoke-test environment variables (`FRD_BISCUIT_KEY`, `FIBER_RPC_URL`) described in the README. None of these traps is hypothetical: each one cost us real debugging time, and several produced *wrong-but-plausible* behavior rather than errors, which is the expensive kind.

| # | Trap | Symptom | Layer |
|---|------|---------|-------|
| 1 | IPv4-only bind vs `localhost` | "fetch failed" while the node is up | Transport |
| 2 | `-32999` over HTTP 200 | Auth failures diagnosed as outages | RPC/auth |
| 3 | Version drift (v0.7.1 vs v0.9.0-rc5) | Docs describe a node you aren't running | Ops |
| 4 | Two fee scales (ppm vs per-thousand) | Fees mis-priced ×1000 | API semantics |
| 5 | Gossiped graph ≠ your channels | "500 channels" on a channel-less node | Mental model |
| 6 | Silent 500-row page cap | Truncated graph, no error | RPC pagination |
| 7 | biscuit-wasm run-limit (ecosystem) | Valid tokens reported as denied under load | Client library |

### Trap 1 — IPv4-only bind vs `localhost`

The node binds its RPC listener on IPv4 (`0.0.0.0`). Modern Node.js `fetch` resolves `localhost` to `::1` (IPv6) first, so a client using `localhost` gets a connection refusal — surfaced only as a generic *"fetch failed"* — while the node is running and reachable.

```bash
FIBER_RPC_URL=http://localhost:8231  npm run smoke:health   # ✗ "no RPC call reached the node: fetch failed"
FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:health   # ✓ full report
```

Use `127.0.0.1` explicitly, or bind the node dual-stack.

### Trap 2 — Auth rejection is `-32999` over HTTP 200

As documented in Gap 3: a bad or missing token yields HTTP 200 with a JSON-RPC error (`-32999 "Unauthorized"`), while a reverse-proxied deployment yields HTTP 401/403 for the same logical condition. Classify **both** as auth, or you will misdiagnose auth problems as outages.

```bash
curl -s -X POST http://127.0.0.1:8231 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"node_info","params":[]}'
# → {"jsonrpc":"2.0","id":1,"error":{"code":-32999,"message":"Unauthorized"}}
```

### Trap 3 — Version drift

Our deployed node self-reports **v0.7.1**; the current public source is **v0.9.0-rc5**. Documentation and research written against source can describe RPC shapes and behaviors your deployed node does not have (and vice versa). Check `node_info.version` first — our health probe prints it in its summary line — and version-scope everything else you read, including this document.

```bash
fiber-route-doctor health --profile dt --url http://127.0.0.1:8231 | head -2
# Fiber node health — verdict: …
# node: fnn v0.7.1 … ← believe this, not the docs' version
```

### Trap 4 — Two fee scales on one surface

A channel's `fee_rate` is **parts-per-million**: a rate of `1000` means 0.1%, i.e. `fee = amount × 1000 / 1_000_000`. The payment-level `max_fee_rate` ceiling is **per-thousand**: a ceiling of `5` means 0.5%, i.e. `max_fee = amount × 5 / 1_000`. Worked example: routing 1,000,000 shannons through a `fee_rate = 1000` channel costs 1,000 shannons; a `max_fee_rate = 5` ceiling allows up to 5,000. Same-looking numbers, thousandfold-different meanings — our pathfinder encodes both divisors as reviewed constants.

### Trap 5 — The gossiped graph is not your channels

`graph_channels` returns the network's gossiped topology (persisted regardless of your connectivity); `list_channels` returns **your** channels. On our node the answers were, simultaneously: 650 and 0.

```bash
fiber-route-doctor map --profile dt --url http://127.0.0.1:8231 --json | head -3  # network: 650 channels
fiber-route-doctor liquidity --profile dt --url http://127.0.0.1:8231            # you: "no channels"
```

### Trap 6 — The silent 500-row page cap

`graph_nodes` and `graph_channels` **do** paginate: params accept `limit` and `after`, responses carry `last_cursor`, and the server caps each page at `default_max_limit = 500` (`crates/fiber-lib/src/rpc/graph.rs`). The trap is that the obvious call shape — empty params — silently returns at most 500 rows with no error and no "truncated" flag; the only signal is a full page plus a cursor it is very easy to ignore.

We speak from experience: **we shipped four tools before noticing.** Every "500 channels" figure in our earlier live validations was exactly the page cap; the real network had 650. Our client now follows `last_cursor` until a short page (fixed with a red-green test: 500 → 650). Upstream, a one-line doc callout — or a `truncated: true` hint — would save every future client author this mistake.

### Trap 7 — biscuit-wasm's run limit makes timeouts look like denials (ecosystem)

Anyone building token tooling against `@biscuit-auth/biscuit-wasm` (v0.6.0) inherits two sharp edges. First, the datalog authorizer's default evaluation budget (~1ms) can be exceeded under CPU contention, throwing `{"RunLimit":"Timeout"}` — and the natural `try { authorize() } catch { return denied }` pattern then reports a **valid token as denied**, intermittently, under load. Second, the fix API is booby-trapped: `authorizeWithLimits()` deserializes a flat `max_time_micro` integer field — passing a Rust-Duration-shaped `{secs, nanos}` object is **silently ignored** as an unknown field, leaving the 1ms default in place while appearing to work. Fail-closed pattern: raise the limit via `max_time_micro`, and rethrow run-limit errors instead of mapping them to "denied" (`packages/biscuit/src/authorize.ts`).

## 5. The live network from one node's vantage

Snapshot date 2026-07-03, testnet, observed from our node (fnn v0.7.1). After paginating the full gossip: **246 nodes** in the topology model (213 gossiped node announcements plus 33 nodes known only as channel endpoints), **650 channels**, **720,185 CKB** total channel capacity (each channel counted once).

The capacity is strikingly concentrated. Ranking nodes by endpoint capacity (a node's sum over its channels — note this convention counts each channel at both endpoints, so the denominator below is twice the single-counted total): the top-10 hubs hold **93.6%** of all endpoint capacity. The top three: `CkbaNode-1` (degree 21, ≈524,605 CKB endpoint capacity), `CkbaNode-2` (degree 24, ≈520,791 CKB) — two named nodes that appear to anchor the network's capacity — and an *unnamed* node (`0262dafc0759…`) that is an endpoint of **542 of the 650 channels**: a connectivity mega-hub carrying ≈110,072 CKB.

Two observations follow, clearly labeled as inference. First, this is a hub-and-spoke network in practice: a handful of nodes carry both the capacity and the connectivity, so their health *is* network health — which makes monitoring tooling (Gaps 3–4) a network-level concern, not a per-operator nicety. Second, our own onboarding experience — a fresh node that stayed silently isolated while displaying all of the above — suggests the default experience for every new operator joining this topology today. The network looked splendid from inside our isolation.

## 6. Protocol context: why operator tooling matters now

Our June 2026 two-pass, adversarially-verified research comparing Fiber with Lightning concluded (original gradings preserved):

> "Fiber is, by its own documentation and source code, a **faithful re-implementation of Bitcoin Lightning's architecture on CKB** — not a next-generation departure. It reuses Lightning's playbook almost verbatim: source-routed Sphinx onion routing, a BOLT-7 gossip protocol, a Dijkstra-variant pathfinder, and hash-based HTLCs."

Its genuine **shipped** advantages, both flowing from CKB's Cell model and Turing-complete CKB-VM, are native multi-asset channels (CKB / UDT / RGB++ in-channel) and programmable settlement (channel scripts can encode arbitrary CKB Script logic) — channel-construction and hash-algorithm facts were graded HIGH (3-0 verified). Several advertised differentiators remain **roadmap, not shipped**: PTLCs, the Daric O(1)-storage watchtower design, generalized multi-asset cross-chain swaps, and cross-asset in-network routing. (Some claims in that research remain "couldn't verify, not refuted"; we do not upgrade them here.)

The inference we draw — labeled as such: while the protocol-level differentiators are still landing, **operational maturity is Fiber's most available near-term differentiator**. Lightning's decade taught that node operability — credentialing, diagnostics, monitoring, liquidity management — is what converts a working protocol into a working network. That is precisely where the five gaps of §3 sit, and every one of them is addressable today, at the tooling layer, without consensus or protocol changes.

## 7. Consolidated roadmap

### Upstream asks, prioritized

| # | Ask | Closes | Effort |
|---|-----|--------|--------|
| 1 | `fnn token mint`/`inspect` subcommand + scope-template docs | Gap 1 | M |
| 2 | Health/readiness RPC + documented auth-error contract | Gap 3, trap 2 | M |
| 3 | Dry-run / route-explain RPC with structured failure causes | Gap 2 | L |
| 4 | Unify or loudly document the two fee scales | Gap 2, trap 4 | S |
| 5 | Isolation warning (log + `node_info` field) + documented bootstrap peers | Gap 5 | S |
| 6 | Document balance/hold semantics for `list_channels` | Gap 4 | S |
| 7 | Pagination doc callout or `truncated` hint on graph RPCs | Trap 6 | S |

Sequencing rationale: #1 blocks every public deployment today (auth is mandatory but unmintable); #2 unblocks orchestrated/monitored deployments; the S-sized items (#4–#7) are documentation fixes with outsized trap-prevention value and could land in a single docs pass.

Equally deliberate is what we are **not** asking for: no protocol changes, no consensus changes, no new on-chain scripts. Every ask above is node-software or documentation work, independently shippable, and none blocks any other. We built working stand-ins for #1–#3 in three days at the tooling layer; native versions inside fnn would be strictly better (no key-handling split across tools, no version-drift surface), and our implementations are MIT-licensed reference material for whoever picks them up.

### Toolkit roadmap

| Item | What |
|------|------|
| Tier B keystore GUI | In-browser encrypted keystore (IndexedDB + WASM crypto) for the web app |
| Fleet view | One dashboard across multiple nodes' health + liquidity |
| Snapshot trend history | Chart liquidity snapshots over time (raw-first storage already supports it) |
| Map time-series | Topology diffs between map snapshots |
| Alerting expansion | More webhook targets; alert routing rules |
| Recorded polish backlog | Small items logged during review (shared flag parser, zoom `preventDefault`, …) |

All five current tools are shipped, tested (209 tests), and live-validated; the roadmap above is additive.

## 8. Appendix: tool inventory

| Tool | Purpose | CLI | Live proof | Source |
|------|---------|-----|------------|--------|
| Route Doctor | Payment-failure diagnosis: constrained pathfinding + ranked causes | `diagnose` | Live graph parsed; pathfinder validated vs `build_router` | `packages/core`, `apps/cli` |
| Biscuit Key & Token Manager | Mnemonic→key custody, encrypted keystore, scoped token minting | `keys`, `token` | Minted token accepted by real node; `graph_channels` returned data | `packages/biscuit` |
| Node Health Probe | 5-check health verdict, exit codes, watch + webhooks | `health` | True-positive isolation FAIL on our own node (fnn v0.7.1) | `packages/core`, `apps/cli` |
| Channel Liquidity Snapshot | Per-asset send/receive aggregates, skew flags, save/diff | `liquidity` | Honest empty-node path on a channel-less node | `packages/core`, `apps/cli` |
| Fiber Network Map | Deterministic force-layout topology map, web + standalone HTML | `map` | 246 nodes / 650 channels rendered live from an isolated node | `packages/core`, `apps/cli`, `apps/web` |

All tools share one repo — <https://github.com/toastmanAu/fiber-route-doctor> (MIT) — one test suite (209 tests), and one composition story: `keys import` → `token generate` → any tool, against any fnn node.
