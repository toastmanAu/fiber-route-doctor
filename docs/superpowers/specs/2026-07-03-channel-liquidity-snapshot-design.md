# Channel Liquidity Snapshot — Design

**Date:** 2026-07-03
**Status:** Drafted from approved scoping answers (own-node scope, full analytics set, save + diff, core + CLI + web). Architecture A (raw-first, compute-on-read) chosen per session recommendation pattern; awaiting final user review of this spec.
**Piece:** Fourth tool in the Fiber Ops toolkit (after Route Doctor, Biscuit Key & Token Manager, Node Health Probe).

## Purpose

One command (and one web panel) that answers: *what can this node send and receive right now, per asset, and how is that liquidity distributed across channels and peers?* Persisted snapshots plus `--diff` turn it into an ops trail: balance drift, opened/closed channels, hold buildup.

Scope is **own-node only** (`list_channels`). Network-wide graph analytics belong to the future Fiber Network Map tool.

## Data source (all already grounded/typed in this repo)

`HealthClient.listChannels()` (tool 3) returns `RpcChannel[]`: `channel_id`, counterparty `pubkey`, `state {state_name}`, `enabled`, `is_public`, `local_balance`/`remote_balance`/`offered_tlc_balance`/`received_tlc_balance` (u128 hex strings), `funding_udt_type_script`, `created_at`, `failure_detail`. Default call excludes closed channels. No new RPC code is needed. Asset identity reuses `asset.ts` (`AssetId = "CKB" | Hex` derived from the UDT type script) from Route Doctor.

## Architecture — raw-first snapshots, compute-on-read (Approach A)

The persisted artifact is normalized **raw observations**; every analytic and diff is a pure function applied at read time. Old snapshots stay diffable when analytics evolve. Storage is a dumb interface; the Node filesystem implementation lives in the CLI so core stays browser-safe (same split as the biscuit token store).

### New files in `packages/core`

- **`liquidity-types.ts`**
  - `ChannelLiquidity = { channelId: Hex; peer: Hex; asset: AssetId; state: string; enabled: boolean; isPublic: boolean; local: string; remote: string; offeredHold: string; receivedHold: string; createdAt: string }` — balances are **decimal strings** (JSON-safe; u128 overflows Number; JSON.stringify rejects bigint).
  - `LiquiditySnapshot = { ts: string; nodeUrl: string; channels: ChannelLiquidity[] }` — plain JSON-serializable, no transforms needed.
  - `SnapshotStore = { list(): string[]; get(name: string): LiquiditySnapshot | undefined; put(s: LiquiditySnapshot): string; latest(): LiquiditySnapshot | undefined }`.
  - Report types: `AssetLiquidity = { asset: AssetId; channelCount: number; readyCount: number; outbound: string; inbound: string; maxSend: string; maxReceive: string; inFlightOut: string; inFlightIn: string }`; `SkewFlag = { channelId: Hex; asset: AssetId; localRatioPct: number; flag: "drained" | "full" }`; `PeerGroup = { peer: Hex; channelCount: number; outbound: string; inbound: string }`; `LiquidityReport = { ts: string; assets: AssetLiquidity[]; skews: SkewFlag[]; peers: PeerGroup[]; totalChannels: number; excludedChannels: number }`.
- **`liquidity.ts`**
  - `buildLiquiditySnapshot(channels: RpcChannel[], nodeUrl: string, ts: string): LiquiditySnapshot` — hex→decimal-string normalization; `funding_udt_type_script` → `AssetId` via existing asset helper.
  - `computeLiquidityReport(snapshot: LiquiditySnapshot): LiquidityReport` — per-asset totals where **outbound/inbound/max\* count only `ChannelReady` + `enabled` channels**; non-ready or disabled channels are counted in `excludedChannels` and shown by the formatter with an annotation. `maxSend` = the largest single `local` balance among ready+enabled channels of that asset (upper bound on a single-path payment out); `maxReceive` = the largest single `remote` balance (upper bound on a single-path payment in). Skew: `localRatio = local / (local + remote)` per ready channel; `< 10%` → `drained` (can't send), `> 90%` → `full` (can't receive); thresholds are named exported constants (`SKEW_DRAINED_PCT = 10`, `SKEW_FULL_PCT = 90`). Per-peer grouping sums ready-channel balances by counterparty pubkey. All arithmetic in `bigint` internally; results serialized back to decimal strings.
- **`liquidity-diff.ts`**
  - `diffSnapshots(prev: LiquiditySnapshot, next: LiquiditySnapshot): LiquidityDiff` where `LiquidityDiff = { fromTs: string; toTs: string; opened: ChannelLiquidity[]; closed: ChannelLiquidity[]; balanceDeltas: Array<{ channelId: Hex; asset: AssetId; localDelta: string; remoteDelta: string }>; assetDeltas: Array<{ asset: AssetId; outboundDelta: string; inboundDelta: string }> }` — deltas are signed decimal strings; channels matched by `channelId`; zero-delta channels omitted from `balanceDeltas`.
- **`liquidity-format.ts`**
  - `formatLiquidityText(report: LiquidityReport): string` — per-asset headline block (outbound/inbound/max send/max receive/in-flight), then per-channel rows with a 10-cell bar of local share (`[███░░░░░░░] 30%`), skew/hold/excluded annotations, then per-peer summary. Empty node renders `no channels — nothing to snapshot`.
  - `formatLiquidityDiff(diff: LiquidityDiff): string` — opened/closed lines and signed per-channel/per-asset deltas.

### CLI (`apps/cli`)

- `dispatch.ts` gains `"liquidity"`.
- `commands/liquidity.ts`: flags `--url` (required) + standard token resolution (`--biscuit`/`--auth-token-file`/`--profile`/`FNN_AUTH_TOKEN`), `--json` (prints `{ report, snapshot }`), `--save` (persist snapshot AFTER rendering), `--diff` (load latest saved snapshot; render report then diff vs live; clear error `no saved snapshot to diff against — run with --save first` if none). `--save --diff` together: diff against previous latest, then save the new one.
- `NodeFsSnapshotStore` (CLI-side): dir `~/.config/fiber-route-doctor/snapshots/`, files `<ISO-ts>.json` (colons replaced for filesystem safety), written 0600 via atomic temp+rename (same pattern as the token store); `latest()` = lexicographically greatest filename (ISO timestamps sort correctly).
- Exit codes: 0 success (regardless of liquidity state — informational tool, not a gate), 2 usage/probe errors.

### Web (`apps/web`)

- `liquidity-view.ts` (pure, unit-tested): `buildLiquidityView(report)` → totals cards per asset + per-channel bar rows (percent widths, colors: bar fill #2ecc71, drained flag #e74c3c, full flag #f1c40f, excluded #7f8c8d).
- `LiquidityPanel.tsx`: url/token(password) form + Probe button (same conventions as HealthPanel, including the generation-counter guard pattern if auto-refresh is added — v1 is manual probe only, no auto-refresh, no persistence in browser).
- Wired into `App.tsx` below `HealthPanel`.

## Data flow

```
liquidity cmd → resolveToken → HealthClient.listChannels()
  → buildLiquiditySnapshot(channels, url, new Date().toISOString())
  → computeLiquidityReport → formatLiquidityText / --json
  → [--diff: store.latest() → diffSnapshots → formatLiquidityDiff]
  → [--save: store.put(snapshot)]
```

Errors: RPC/auth failures surface as the thrown error message and exit 2 (the health probe is the tool for diagnosing them; no degradation matrix here). Token never appears in snapshots, output, or saved files.

## Edge cases

- 0 channels → explicit empty-node message (the current driveThree state; the smoke test exercises this path honestly).
- All channels non-ready/disabled → totals are zero with `excludedChannels` explaining why.
- `local + remote == 0` → skip skew ratio (avoid divide-by-zero), no flag.
- UDT channels: group under `AssetId` hex key, display shortened; unknown/absent UDT script = CKB.
- Diff where an asset appears/disappears entirely → assetDeltas still emitted (delta from/to zero).

## Testing

TDD per task, Vitest, same conventions as tools 1–3:

- **Normalize**: hex→decimal conversion incl. u128 > Number.MAX_SAFE_INTEGER values; UDT→AssetId mapping.
- **Compute**: multi-asset fixtures; ready/disabled/non-ready exclusion; skew boundaries (exactly 10%/90% — flags fire strictly below/above); zero-capacity channel; holds; peer grouping.
- **Diff**: opened/closed/delta/no-change; asset appears/disappears; signed string deltas.
- **Format**: report snapshot shapes; bar rendering at 0%/30%/100%; empty node; diff text.
- **Store** (CLI): temp-dir round-trip, atomic write, 0600 mode, latest() ordering with multiple files.
- **CLI args**: flag validation, `--diff` with no saved snapshot error path.
- **Web view**: percent/colors mapping.
- **Gated live smoke** `npm run smoke:liquidity` (env-gated like smoke:health): mints readonly token, prints report, asserts snapshot built (channel count ≥ 0) — passes on the currently-empty driveThree node via the empty-node path.

## Out of scope / backlog

- Network-wide liquidity (Fiber Network Map tool).
- Scheduled snapshotting / retention pruning; charting trends over many snapshots.
- Rebalancing actions (this tool observes; it never moves funds).
- Browser-side snapshot persistence.

## Composition story (demo)

```
fiber-route-doctor liquidity --profile driveThree --url http://127.0.0.1:8231 --save     # baseline
# ... open a channel, route some payments ...
fiber-route-doctor liquidity --profile driveThree --url http://127.0.0.1:8231 --diff --save   # what changed?
```
