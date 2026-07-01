# Fiber Node Health Probe — Design

**Date:** 2026-07-02
**Status:** Approved (architecture, data flow, testing sections approved by Phill)
**Piece:** Third tool in the Fiber Ops toolkit (after Route Doctor and Biscuit Key & Token Manager)

## Purpose

One command (and one web panel) that answers: *is this Fiber node up, authenticated, connected, and able to move money?* It distinguishes "node down" from "auth broken" from "node up but isolated/illiquid", and tells the operator how to fix each.

## Grounded RPC surface (from ckb-wallet-fiber knowledge graph + fiber source corpus)

| Method | Module | Params | Biscuit scope | Key result fields |
|---|---|---|---|---|
| `node_info` | info (`rpc/info.rs`) | none | `read("node")` | `version`, `commit_hash`, `pubkey`, `node_name`, `addresses`, `chain_hash`, `channel_count`, `pending_channel_count`, `peers_count`, `tlc_*`, `udt_cfg_infos` |
| `list_peers` | peer (`rpc/peer.rs`) | none | `read("peers")` | `peers: [{pubkey, address}]` |
| `list_channels` | channel (`rpc/channel.rs`) | `ListChannelsParams` (optional `pubkey`, `include_closed`, `only_pending`) | `read("channels")` | per channel: `channel_id`, `state`, `local_balance`, `remote_balance`, `offered_tlc_balance`, `received_tlc_balance`, `enabled`, `is_public`, `pending_tlcs`, `created_at`, `failure_detail` |

The probe calls `list_channels` with empty params. Verified in `rpc/channel.rs::list_channels`: with `include_closed` unset (defaults false) the node returns only **active** channel states — closed channels are excluded, so the "not `ChannelReady` → warn" rule cannot false-alarm on historical channels, while still-opening and shutting-down channels are included and correctly warned on.

All three scopes are already granted by our `readonly` token template (`packages/biscuit/src/scopes.ts`) — the probe composes with the existing token tooling with zero auth changes.

Note: the RPC facts above come from a research snapshot of the fiber repo; the live node is v0.9.0-rc5. The gated live smoke confirms field presence against the real node.

## Architecture — snapshot-then-rules (approved: approach C = A + watch mode)

Follows the Route Doctor pattern: one network boundary collects a plain snapshot, then pure functions rule over it.

### New files in `packages/core`

- **`health-types.ts`**
  - `RpcOutcome = { ok: true } | { ok: false; kind: "auth-denied" | "transport-error"; detail: string }`
  - `HealthSnapshot = { nodeInfo?: RpcNodeInfo; peers?: RpcPeerInfo[]; channels?: RpcChannel[]; outcomes: { nodeInfo: RpcOutcome; listPeers: RpcOutcome; listChannels: RpcOutcome } }`
  - `CheckStatus = "pass" | "warn" | "fail" | "skip"`
  - `CheckResult = { id: string; title: string; status: CheckStatus; reason: string; fix?: string }`
  - `HealthReport = { checks: CheckResult[]; verdict: CheckStatus; node?: NodeSummary }` (`NodeSummary` = version, pubkey, name, addresses, chain hash, counts)
  - RPC result types (`RpcNodeInfo`, `RpcPeerInfo`, `RpcChannel`) modeled on the fiber-json-types fields above; u128/u64 hex fields parsed as `bigint`.
- **`health-client.ts`** — `HealthClient extends GraphClient` adding `nodeInfo()`, `listPeers()`, `listChannels()`; plus `collectHealthSnapshot(client): Promise<HealthSnapshot>` which runs the three calls and **captures each failure independently** (classifying biscuit/permission errors as `auth-denied`, everything else as `transport-error`) instead of throwing.
- **`health-checks.ts`** — pure functions `(snapshot) => CheckResult`:
  1. **reachability** — fail if *all* calls transport-errored (node unreachable); pass otherwise.
  2. **auth** — **fail** if *all* calls were `auth-denied` (token rejected outright); **warn** if only *some* were denied (token valid but missing scopes), naming each missing scope; fix hint: `fiber-route-doctor token generate --scope readonly …`. Pass if all calls authorized. Skip if nothing reached the node (transport failure).
  3. **node-info** — pass with summary (version, chain, counts); skip if the call failed.
  4. **peers** — fail if 0 peers ("node is isolated — no gossip, no routing"); pass with count otherwise; skip if unavailable.
  5. **channels** — warn conditions (each with reason + fix):
     - no channels at all ("node up but no liquidity — open a channel");
     - any channel not in `ChannelReady` state (include `state` and `failure_detail`);
     - any channel `enabled: false`;
     - any non-empty `pending_tlcs` (possible stuck TLCs);
     - total `local_balance === 0n` across ready channels ("cannot send — no outbound liquidity").
     Pass if channels exist, all ready/enabled, no pending TLCs, local balance > 0. Skip if unavailable.
- **`health.ts`** — `runHealthProbe(client): Promise<HealthReport>`: collect snapshot → run check registry → verdict = worst status among non-skip checks (`fail > warn > pass`).
- **`health-format.ts`** — `formatHealthText(report)`: ✓/⚠/✗/− per check with reason and fix lines, node summary header. Report is plain-JSON-serializable (bigints rendered as strings) for `--json`.

### CLI (`apps/cli`)

- `dispatch.ts`: add `"health"` command.
- `commands/health.ts`: parses `--url`, token flags (`--biscuit` / `--auth-token-file` / `--profile` / `FNN_AUTH_TOKEN` — identical resolution to `diagnose` via `resolveToken`), `--json`, `--watch`, `--interval <seconds>` (default 10).
- One-shot mode exit codes: **0** = all pass, **1** = degraded (any warn), **2** = unhealthy (any fail). Tool crashes keep the existing `main().catch` exit 2 — an unreachable/erroring probe is unhealthy either way.
- `--watch`: loop with `setInterval`-style polling; re-render full report each tick; when any check's status changes from the previous tick, print a timestamped transition line (`peers: pass → fail`). Ctrl+C to exit. Watch mode ignores exit-code semantics.

### Watch-mode alerting (webhooks)

- `--webhook <url>` (watch mode only; error if given without `--watch`): on every tick where at least one check transitioned status, POST a JSON alert to the URL. No transitions → no POST (transition-edge triggered, not level-triggered — no alert spam on a steadily-broken node).
- `--webhook-format generic|slack|discord` (default `generic`):
  - `generic`: `{ ts, nodeUrl, verdict, previousVerdict, transitions: [{ check, from, to, reason }], report }` — bigints as strings, machine-consumable.
  - `slack`: `{ text: "<human summary>" }`; `discord`: `{ content: "<human summary>" }` — same one-line-per-transition summary the terminal prints, so a bare Slack/Discord incoming-webhook URL works with zero glue.
- Delivery is fire-and-forget with one retry: a failed POST (non-2xx or network error) logs a single warning line and never crashes or delays the watch loop.
- Security: the biscuit token is **never** included in the payload or webhook headers; webhook URL must be `http:`/`https:` (validated at arg-parse time); payload contains only the health report data the terminal already shows.
- Implementation seam: `postAlert(url, format, alert, fetchImpl)` in core (`health-alert.ts`) so it's unit-testable with injected fetch and reusable later; the CLI watch loop owns transition detection and calls it.

### Web (`apps/web`)

- New health panel beside the existing route view: inputs (node URL, token — reusing the existing form conventions), "Probe" button, traffic-light check list (green/amber/red/grey), node summary card (version, pubkey short-form, chain, peer/channel counts), and an auto-refresh toggle (browser equivalent of `--watch`, default off, 10s interval).
- Uses the same core engine (`HealthClient` + `runHealthProbe`) via browser `fetch` — no separate logic.

## Data flow & degradation (approved)

```
health cmd → resolveToken → collectHealthSnapshot(url, token)
  → three RPC calls, per-call outcome captured (never throws for call failures)
  → pure checks over snapshot → HealthReport → text/JSON + exit code
```

- Transport error on **all** calls → reachability **fail**, all data checks **skip** (don't invent state).
- `auth-denied` on some calls → auth check **warn/fail** naming the scope; the dependent data checks **skip** rather than report on missing data.
- Security: token never logged or echoed; errors surfaced to the user are RPC error messages only. Input validation on `--interval` (positive integer, sane bounds).

## Testing (approved)

TDD per task (RED → GREEN), Vitest, consistent with the repo's existing 73-test suite:

- **Check unit tests** — plain snapshot fixtures: healthy; isolated (0 peers); auth-denied subset; node fully down; channel not ready with `failure_detail`; disabled channel; stuck pending TLC; zero outbound liquidity; no channels.
- **`collectHealthSnapshot` tests** — injected `fetchImpl` (same pattern as GraphClient tests): HTTP 401/permission-denied RPC error → `auth-denied`; network throw / HTTP 500 → `transport-error`; mixed outcomes.
- **Verdict/orchestrator tests** — worst-status aggregation, skip exclusion.
- **Formatter tests** — text output shape for pass/warn/fail/skip mixes; JSON serializability (bigint handling).
- **CLI tests** — dispatch recognizes `health`; arg validation (`--interval` bounds, `--webhook` requires `--watch`, webhook URL scheme, `--webhook-format` enum); exit-code mapping.
- **Alerting tests** — injected `fetchImpl`: POST fired with correct payload on a transition tick; no POST when nothing transitioned; slack/discord payload shapes; failed POST retries once then logs without throwing; token never present in payload.
- **Gated live smoke** — `npm run smoke:health` (env-gated on `FIBER_RPC_URL` + token env, like `smoke:biscuit`) against the driveThree node: expects verdict computed, node_info version string non-empty, ≥1 peer. Watch mode excluded from smoke (manual).

Web panel is verified by typecheck + manual demo run (consistent with the existing web app's testing posture).

## Out of scope / backlog

- Historical trending / persistence of health results.
- Webhooks from the web panel's auto-refresh (browser cross-origin POST to arbitrary webhook URLs is unreliable; alerting is CLI-only).
- Channel liquidity *snapshot* tool (separate roadmap piece — deeper balance analytics than the health warn rules here).
- Per-check `--only`/`--skip` filters.

## Composition story (demo)

```
fiber-route-doctor keys import --hex ~/.fiber-dt/biscuit_private_key
fiber-route-doctor token generate --scope readonly --profile driveThree --url http://127.0.0.1:8231
fiber-route-doctor health --profile driveThree --url http://127.0.0.1:8231          # one-shot
fiber-route-doctor health --profile driveThree --url http://127.0.0.1:8231 --watch  # live ops view
fiber-route-doctor health --profile driveThree --url http://127.0.0.1:8231 --watch \
  --webhook https://discord.com/api/webhooks/… --webhook-format discord             # alert on transitions
```
