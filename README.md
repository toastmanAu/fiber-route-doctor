# Fiber Route Doctor

Routing diagnostics for the Fiber Network. Answers **"would this payment
succeed, via what path, and if not exactly why"** — by reading a node's
gossip graph, self-computing a constrained best path, and attributing any
block to ranked causes and fixes. Built for the "Gone in 60ms" Fiber
Infrastructure Hackathon (Category 2).

**📋 Read the full [Fiber Infrastructure Gap Analysis & Roadmap](docs/GAP-ANALYSIS.md)** — every gap backed by a working tool and live-testnet proof.

**🌐 [Live demo](https://toastmanau.github.io/fiber-route-doctor/)** — try the in-browser wallet, and toggle "Demo data" to explore a real 213-node / 650-channel testnet snapshot with no node.

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
In `--diff` output, asset deltas track usable (ready+enabled) liquidity while per-channel
balance deltas compare raw balances regardless of state — so a channel being disabled shifts
asset totals without producing a per-channel balance delta.

Live validation: `FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:liquidity`

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

## In-browser wallet (Tier B)

The web app carries its own biscuit keystore — no CLI needed to get a token into the
panels. Create or import a wallet, and it is encrypted at rest in IndexedDB (scrypt +
XChaCha20-Poly1305); the seed is decrypted only for the moment of a mint or export and
never held in memory between operations (passphrase-per-operation custody).

Mint a scoped token (readonly / invoicing / full), and it lands as a named profile that
the Health, Liquidity, and Network Map panels can select from a dropdown. The 24-word
seed is shown once at creation and only again behind an explicit passphrase-gated export.

Known limitation: JavaScript strings cannot be securely zeroized, so the passphrase and
decrypted seed live briefly on the JS heap during an operation — the same constraint as
the CLI. This is a convenience keystore for testnet operation, not a hardware wallet.

Live validation: `FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:wallet`
(asserts a stranger-key token is rejected AND an imported-node-key token is accepted)

## Live smoke
See [docs/demo-node.md](docs/demo-node.md). Requires a reachable Fiber v0.9 node.

## What it fills
Fiber ships `build_router` but gives no explanation when routing fails.
Route Doctor adds the failure-attribution layer: liquidity floors,
min/max value, expiry, fee ceilings, disabled channels, absent nodes, and
asset mismatch (cross-asset transfer is CCH-only in Fiber).

MIT licensed.
