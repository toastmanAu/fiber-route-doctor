# Fiber Infrastructure Gap Analysis — Deliverable Design

**Date:** 2026-07-03
**Status:** Approved (framing, evidence sections, format, length, structure all approved by Phill)
**Deliverable:** `docs/GAP-ANALYSIS.md` (~4,500 words, committed + pushed, linked from README) for the "Gone in 60ms" Fiber Infrastructure Hackathon.

## Thesis and framing (approved: operator-infrastructure lens)

fnn works — but the distance between a running binary and an *operable* network is wide. We crossed that distance by building five open-source tools in three days; every gap this document names is backed by working public code, tests, and live-testnet proof. Recommendations split cleanly: what upstream fnn should ship, and what the operator-tooling layer (this toolkit) covers meanwhile.

Tone: constructive, evidence-first, zero snark. Fiber is early; gaps are normal; the point is a prioritized, reproducible map of them.

## Structure (approved)

1. **Executive summary** (~300w) — thesis; the five gaps in one line each; evidence standards in one sentence.
2. **Method** (~250w) — how evidence was gathered: five TDD-built tools (207 tests, typecheck-clean monorepo), live validation against a real testnet node (fnn **v0.7.1** at driveThree), source grounding against `nervosnetwork/fiber` (research corpus spans v0.6.1–v0.9.0-rc5 — version scope stated per claim where behavior may differ; the drift itself is a finding), plus the prior two-pass adversarially-verified protocol research (2026-06-17). Unverifiable claims are marked, not asserted.
3. **The five gaps** (~450w each) — per gap: what's missing → why it bites operators → evidence (tool + live proof + source pointer) → upstream ask → toolkit coverage.
4. **Trap catalog** (~800w) — reproducible sharp edges with repro steps.
5. **Live network observations** (~300w) — the testnet from our vantage point.
6. **Protocol context** (~300w, cited) — why operator tooling is the near-term differentiator.
7. **Consolidated roadmap** (~500w) — prioritized upstream-asks table + toolkit-roadmap table.
8. **Appendix: tool inventory** — one row per tool: purpose, tests, live proof, code pointer.

## Claims & evidence inventory (the plan hands each section's drafter exactly these)

### G1 — Credential lifecycle
- fnn mandates biscuit auth on any public RPC listener and verifies via `rpc.biscuit_public_key`; per-method datalog rules in `rpc/biscuit.rs::build_rules` (e.g. `node_info → read("node")`, `list_channels → read("channels")`).
- fnn ships NO way to mint tokens (no mint subcommand); `fiber-cli` only consumes (`--auth-token`/`--auth-token-file`/`FNN_AUTH_TOKEN`).
- Evidence: our BIP39→SLIP-0010(Ed25519, `m/44'/1'/0'`)→mint→scoped-facts pipeline produces tokens the real node accepts (live: readonly token → `graph_channels` 500 rows). Keystore: scrypt(N=2^15)+XChaCha20-Poly1305, 0600 atomic.
- Upstream ask: `fnn token mint/inspect` subcommand + documented scope templates. Toolkit: `keys`/`token` commands ship today.

### G2 — Payment-failure diagnostics
- `send_payment` failures are opaque; no dry-run/route-explain RPC (nearest is `build_router`).
- Fee-scale trap doubles as docs gap: channel `fee_rate` is **ppm** (/1,000,000) while the payment `max_fee_rate` ceiling is **per-thousand** (/1,000) — two scales in one API surface.
- Evidence: Route Doctor's constrained pathfinder + ranked failure attribution (causes incl. target_absent, channel_disabled, below_min_value, insufficient_capacity, fee_over_limit…), optional `build_router` cross-check.
- Upstream ask: dry-run/explain RPC returning structured failure causes. Toolkit: `diagnose` ships today.

### G3 — Health & readiness
- No health/readiness endpoint; operators must synthesize one from `node_info`/`list_peers`/`list_channels`.
- Auth-rejection semantics undocumented: middleware returns JSON-RPC error **-32999 "Unauthorized" over HTTP 200** (`rpc/middleware.rs::auth_reject_error`); a reverse proxy doing auth returns HTTP 401/403 instead — clients must classify both or misreport "node down".
- Evidence: health probe (5 checks, pass/warn/fail + fixes, exit codes, `--watch` + webhooks); live verdict on driveThree was a true-positive FAIL (isolated).
- Upstream ask: health RPC + documented auth-error contract. Toolkit: `health` ships today.

### G4 — Liquidity observability
- `list_channels` is raw per-channel state; no aggregates (total sendable/receivable, largest single payment), no history, and balance-vs-TLC-hold semantics are undocumented.
- Evidence: liquidity snapshot/diff tool (per-asset totals over ready+enabled, skew flags, holds, peer groups; persisted raw snapshots + diffs).
- Upstream ask: documented balance semantics; optional aggregate RPC. Toolkit: `liquidity --save/--diff` ships today.

### G5 — Topology visibility & bootstrap
- Gossip data persists while a node is isolated: our node reports **500 gossiped channels with 0 peers** — "the network looks fine" while the node can't route anything. No isolation warning; seed-peer bootstrap is manual `connect_peer` with no documented starter peers.
- gossiped-graph (`graph_channels`) vs own-channels (`list_channels`) confusion is the #1 new-operator trap.
- Evidence: map rendered 214 nodes/500 channels live FROM an isolated node; health probe flags isolation explicitly.
- Upstream ask: isolation warnings in logs/`node_info`; documented bootstrap peers. Toolkit: `map` + health ship today.

### Trap catalog (each with repro steps; verify exact details against ledger/source during drafting)
1. **IPv4-only bind vs localhost**: fnn listens on `0.0.0.0` (IPv4); Node ≥18 fetch resolves `localhost` → `::1` first → "fetch failed". Repro: same smoke with `localhost` vs `127.0.0.1`.
2. **-32999 over HTTP 200** (see G3) + proxy-401 variant. Repro: `curl` node_info without Authorization.
3. **Version drift**: deployed binary self-reports v0.7.1 (`node_info.version`); current source/docs describe v0.9.0-rc5. Claims must be version-scoped. Repro: `smoke:health` output.
4. **Two fee scales** (see G2).
5. **Gossiped vs own channels** (see G5).
6. **Unpaginated graph fetch**: our clients (and the obvious call shape) fetch the whole graph in one call; VERIFY during drafting whether `graph_nodes`/`graph_channels` accept pagination params in the corpus (`rpc/graph.rs`) — claim accordingly (either "no pagination exists" or "pagination exists but is undiscoverable/undocumented").
7. **Ecosystem: biscuit-wasm run-limit**: default ~1ms datalog `max_time` throws `{RunLimit:"Timeout"}` under CPU contention — a naive catch reports a VALID token as denied; the `RunLimits` serde field is flat `max_time_micro` (a `{secs,nanos}` Duration shape is silently ignored). Fix pattern: `authorizeWithLimits` + rethrow run-limit errors (fail closed).

### Live network observations
- 214 nodes / 500 channels gossiped (testnet, 2026-07-03, from driveThree's vantage); hub concentration figures pulled from `map --json` during drafting (top-10 by capacity).
- Our operational experience: fresh node = isolated by default; the toolkit's own health verdict caught it.

### Protocol context (cited: `fiber-vs-lightning-research-2026-06-17.md`, two-pass verified)
- Fiber's shipped form is a faithful Lightning re-implementation on CKB (Sphinx onion routing, BOLT-7-style gossip, Dijkstra-variant pathfinding, HTLCs); genuine shipped advantages: native multi-asset channels + programmable settlement (Cell model / CKB-VM).
- PTLC, Daric O(1) watchtower, generalized CCH remain roadmap.
- Inference drawn: with protocol parity a work-in-progress, **operational maturity is the near-term differentiator** — exactly where the five gaps sit. Preserve the research doc's confidence grading; do not upgrade abstained claims.

### Roadmap tables
- **Upstream asks (prioritized)**: 1 token mint subcommand; 2 health RPC + auth-error docs; 3 dry-run/route-explain; 4 fee-scale docs unification; 5 isolation warnings + bootstrap docs; 6 balance-semantics docs; 7 graph pagination (per trap-6 verification).
- **Toolkit roadmap**: Tier B in-browser keystore GUI; fleet view (multi-node health/liquidity); snapshot trend history; map time-series; webhook alerting expansion; the recorded backlog polish items.

### Appendix — tool inventory
One row each (Route Doctor, Biscuit Key & Token Manager, Node Health Probe, Channel Liquidity Snapshot, Fiber Network Map): one-line purpose, CLI entry, live proof one-liner, source dir.

## Evidence discipline (binding on all drafters)

- Every factual claim carries a proof pointer: fiber source path (corpus `~/ckb-wallet/research/fiber-payment-channels/raw/fiber/...` — cite as upstream paths e.g. `crates/fiber-lib/src/rpc/biscuit.rs`), toolkit test file, or live-smoke output quote.
- Version-scope any claim that could differ between v0.7.1 (deployed) and v0.9.0-rc5 (source).
- Unverified = say so. No superlatives without numbers. The biscuit token, private keys, and any secret material never appear — not even redacted forms.
- Numbers used: 5 tools, 207 tests, 214 nodes, 500 channels, 3 days — verify each against ledger/git before final.

## Production pipeline (approved)

Adapted subagent-driven development: plan splits the doc into sections; **sonnet** implementers draft prose from the per-section claims+evidence inventory (no haiku for judged prose); per-section reviewer fact-checks EVERY pointer against the actual source/ledger/smoke record; final **fable** whole-doc review for coherence, accuracy, tone, and length; then commit, push, and link from README ("Read the full [Gap Analysis](docs/GAP-ANALYSIS.md)").

## Out of scope

- Video script (separate deliverable; this doc feeds it).
- Hosted demo (separate deliverable).
- Any new tool code (except the README link line).
