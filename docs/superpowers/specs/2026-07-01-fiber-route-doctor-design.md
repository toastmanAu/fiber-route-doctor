# Fiber Route Doctor — Design Spec

- **Date:** 2026-07-01
- **Status:** approved — ready for implementation planning
- **Hackathon:** "Gone in 60ms: Fiber Network Infrastructure Hackathon" (July 1–15, 2026 · $20k · CKBoost)
- **Category:** 2 — Node, Routing, Cross-Chain, and Diagnostics Infrastructure
- **Target Fiber version:** v0.9.x (verified against `nervosnetwork/fiber` v0.9.0-rc5, 2026-06-29)

## 1. One-line summary

A routing-diagnostics tool for Fiber that answers **"would this payment succeed, via what path, and if not *exactly why*"** — by driving the node's own `build_router` RPC for a ground-truth route and adding the failure-attribution and explanation layer that Fiber itself does not provide.

## 2. Problem & infra gap

Fiber ships a capable pathfinder (`build_router`, backward-Dijkstra with success-probability and fee weighting) and exposes the full gossip graph (`graph_nodes`, `graph_channels`). What it does **not** provide is any explanation when routing fails or is fragile. Operators and wallet developers face opaque "no route found" / flaky-payment situations with no structured cause. (This project's own prior research — `fiber-vs-lightning-research-2026-06-17.md` — independently documented flaky testnet routing as a real pain point.)

**The gap Route Doctor fills:** turn "no route" into a ranked, actionable diagnosis — which constraint eliminated the path (liquidity floor, min/max value, expiry delta, fee ceiling, disabled channel, node absent from gossip, asset mismatch), and what the operator can do about it.

## 3. Scope (ruthless YAGNI)

### MVP — must ship
1. **Graph ingestion** — pull `graph_nodes` + `graph_channels` from a node, build an immutable in-memory model.
2. **Route probe** — given `(source, target, amount, asset)`, drive `build_router` for the ground-truth path (or capture its failure).
3. **Diagnosis** — pure analysis over the graph model producing a structured `RouteReport`: verdict, chosen path, per-hop breakdown, ranked blocking reasons, suggested fixes.
4. **CLI** — operator command that prints the report as a table / ASCII path.
5. **Web demo** — minimal hosted dashboard: enter a probe, visualize the graph with the found path highlighted (or blocked hops in red) + ranked reasons.
6. Working live against a Fiber v0.9 testnet node.

### Stretch — only if time remains
- Live send-failure attribution via `get_payment` failure codes.
- Payment-success **probability** heuristic surfaced per path.
- **Trampoline-path** awareness (v0.7.0 feature).
- "What-if" simulation: *if I opened channel X with capacity Y, does the target become reachable?*
- Cross-asset mismatch detector as a first-class explainer.
- Channel-state-change alerting.

## 4. Architecture — three layers, shared core

```
graph_nodes / graph_channels / build_router / get_payment   (Fiber node RPC, v0.9)
                     │
          ┌──────────▼───────────┐
          │  @fiber-route-doctor  │   ← the reusable infrastructure (zero UI)
          │  /core                │
          │  GraphClient          │  RPC transport + Biscuit auth + v0.9 pubkey/snake_case types
          │  GraphModel           │  immutable directed multigraph (per-direction edges)
          │  RouteProbe           │  drives build_router → ground-truth path OR structured error
          │  Diagnosis            │  reachability + per-hop constraint attribution → RouteReport
          └───────┬───────────┬───┘
                  │           │
        apps/cli (operator)   apps/web (hosted demo — reuses fiber-wallet node-graph viz)
```

### Layer responsibilities

- **`GraphClient`** — the only component that touches the network. Wraps the Fiber JSON-RPC surface with v0.9-correct types (`pubkey` not `peer_id`, snake_case enums, `fiber-json-types` shapes) and optional Biscuit auth. Depends on: a node RPC URL. Used by: `RouteProbe`, graph ingestion.
- **`GraphModel`** — immutable directed multigraph built from `graph_nodes` + `graph_channels`. Per-direction edges carry `fee_rate`, `tlc_expiry_delta`, `tlc_minimum_value`, `tlc_maximum_value`, enabled flag, asset (`funding_udt_type_script`). Depends on: nothing (plain data). Used by: `Diagnosis`.
- **`RouteProbe`** — given a probe request, calls `build_router` and normalizes the result into either a `SessionRoute`-shaped path or a structured failure. Depends on: `GraphClient`. Used by: `Diagnosis`, apps.
- **`Diagnosis`** — a **pure, synchronous function** `diagnose(model, probe, probeResult) → RouteReport`. No network. Attributes verdicts to concrete causes. Depends on: `GraphModel` only. Used by: apps.

### Data flow

connect → pull graph → build immutable `GraphModel` → `probe(target, amount, asset)` → `build_router` → **if route:** annotate each hop against its constraints → **if no route:** attribute the blocking constraint(s) → emit `RouteReport` (JSON) → CLI renders table / web highlights path + red blocked hops + ranked fixes.

## 5. The diagnosis engine (where the value is)

`Diagnosis` is pure over the immutable `GraphModel` (all network isolated in `GraphClient`/`RouteProbe`). It attributes each verdict to concrete, named causes:

- target absent from gossip graph
- channel disabled / not `enabled`
- amount below `tlc_minimum_value` floor
- amount above `tlc_maximum_value`
- insufficient directional capacity on a hop
- summed `tlc_expiry_delta` over the acceptable limit
- fee over the caller's cap
- **asset mismatch** — source and target reachable only via channels of different assets (surfaces the "no cross-asset routing" reality confirmed in prior research; cross-asset transfer is CCH-only)

**`RouteReport` output shape (conceptual):**
- `verdict`: `payable` | `blocked` | `risky`
- `path`: ordered hops (when payable/risky), each with node pubkey, channel outpoint, asset, fee, expiry contribution
- `reasons`: ranked list of `{ cause, hop?, detail }`
- `fixes`: ranked actionable suggestions (e.g. "amount below min-value on hop 2; raise to ≥ X" / "target only reachable via RUSD channels; open a RUSD channel or use CCH")

## 6. Stack & reuse

- **Language:** TypeScript throughout (Node ≥22, matches `fiber-wallet`).
- **Web:** React + Vite, buildable to a static bundle hostable on Vercel / Cloudflare Pages.
- **Reuse from `fiber-web/fiber-wallet`:** RPC method map + permission map (`docs/rpc-method-map.md`, `docs/rpc-permission-map.md`), the node-graph visualization, and the `fiber-rpc-smoke.mjs` smoke-test pattern.
- **Types:** adopt `fiber-js` types where compatible with v0.9.
- **Demo node:** Fiber v0.9 testnet node via the official Docker image (added v0.8.1), seeded with a few channels; web demo points at it. Read-only `graph_*` queries also work against public testnet nodes as a fallback. BYO-node instructions provided for real operator use.

## 7. Testing

- **`Diagnosis` (core value):** golden-file unit tests over captured `graph_channels` / `graph_nodes` JSON snapshots (real testnet fixtures, committed). Every blocking-reason branch gets a fixture. Pure function → no network, deterministic, fast. This is where the 80% coverage target lives.
- **`GraphClient` / `RouteProbe`:** mocked-RPC contract tests asserting v0.9 pubkey/snake_case request+response shapes, plus one gated live smoke test against the testnet node (skip-on-missing-node, mirroring `fiber-rpc-smoke.mjs`).
- **CLI / web:** thin render layers, snapshot-tested against `RouteReport` fixtures.

## 8. Deliverables mapped to the hackathon checklist

- Open-source repo (MIT).
- Hosted web demo + runnable README instructions.
- Video demonstration (probe a payment → watch it get diagnosed live).
- Technical breakdown.
- **Infra-gap analysis:** Fiber gives you `build_router` but no failure explanation — Route Doctor fills it.
- Future development roadmap (the §3 stretch list).
- Category 2 selection.

## 9. Risks & mitigations

- **`build_router` may require node-local auth / a funded node** → run our own testnet node (Docker); read-only `graph_*` still works against public nodes as a fallback for the ingestion + diagnosis path.
- **Testnet routing is flaky** (documented in prior research) → that is precisely *why the tool exists*; MVP diagnosis works purely on graph data and `build_router`, with no live send required.
- **Breadth of scope** → the MVP boundary in §3 is firm; all live-send and visual-simulation features are explicitly stretch.
- **v0.9 breaking RPC changes** (`peer_id`→`pubkey`, snake_case enums, `fiber-json-types`) → `GraphClient` is written against v0.9 from day one; contract tests pin the shapes.

## 10. Non-goals

- Not reimplementing Fiber's pathfinder — we drive `build_router` and add the explanation layer.
- Not a wallet or a consumer application (this hackathon is infrastructure-only).
- Not a live-send/payment executor in the MVP (probe/diagnose only).
- No cross-asset routing simulation beyond detecting and explaining mismatch (cross-asset is CCH-only in Fiber).
