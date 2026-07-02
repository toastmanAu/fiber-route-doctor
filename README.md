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

## Live smoke
See [docs/demo-node.md](docs/demo-node.md). Requires a reachable Fiber v0.9 node.

## What it fills
Fiber ships `build_router` but gives no explanation when routing fails.
Route Doctor adds the failure-attribution layer: liquidity floors,
min/max value, expiry, fee ceilings, disabled channels, absent nodes, and
asset mismatch (cross-asset transfer is CCH-only in Fiber).

MIT licensed.
