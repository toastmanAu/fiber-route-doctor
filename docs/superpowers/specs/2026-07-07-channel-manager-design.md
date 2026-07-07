# Fiber Channel Manager — Design (Sub-project B)

**Status:** approved design, pre-plan
**Date:** 2026-07-07
**Part of:** the channel-manager program (A = fnn v0.9.0-rc7 retarget, DONE; **B = this spec**; C = fleet bring-up executed with B's tools). Targets the fnn **v0.9.0-rc7** RPC surface verified in A.

## Goal

Manage Fiber channels on the operator's own node from both CLI and web: connect a peer,
open a funded channel, watch it to `ChannelReady`, list, tune fees/enablement, and close —
authorized by a biscuit token minted with a new least-privilege `operator` scope. On the
hosted demo, the same panel runs against an in-browser simulated channel state machine so
judges experience the full lifecycle without a node.

## Why

Every existing tool (Health, Liquidity, Diagnose, Map) is read-only and the local node has
0 channels — there is nothing local to demonstrate. B supplies the write side: it creates
the real channels C will open across the fleet (dt ↔ Pi/N100), and it showcases the biscuit
auth story end-to-end (scoped write tokens, per-method datalog rules).

## Decisions (made during brainstorm)

1. **Op scope: lifecycle + fee tuning.** `connect_peer`, `open_channel`, state-watch,
   list (reuses `list_channels`), `update_channel` (fee/enable), `shutdown_channel`.
   Payments/invoices are OUT (deferred; new channels being 100/0-skewed is fine — it makes
   the Liquidity tool's skew flags fire truthfully).
2. **Auth: add `operator`, fix `full`.** New template `operator` = READONLY facts +
   `write("channels")` + `write("peers")` — exactly the manager's grant. `full` addition-
   ally gains `write("peers")` and `write("payments")` so its name stops lying (the node
   requires `write("peers")` for `connect_peer` — rpc/biscuit.rs:127 — which our current
   `full` lacks). Existing minted tokens are unaffected (facts bake at mint time).
3. **Hosted demo: simulated state.** In demo mode the panel drives an in-browser stateful
   fetch (`makeChannelSimFetch`) whose channels march through the real state names on each
   poll. Clearly badged "SIMULATED". Real mode is unchanged (CORS-enabled node + token).
4. **Architecture: Approach A** — extend `packages/core` (a fourth engine beside graph/
   health/liquidity), no new package.

## Components

### packages/core (new files)

- **`channel-types.ts`** — fnn v0.9 wire types (all u64/u128 as 0x-hex strings, per the
  `U64Hex`/`U128Hex` serde verified in A):
  - `RpcConnectPeerParams { address?: string; pubkey?: Hex; save?: boolean }` — at least
    one of `address`/`pubkey` (0.9 contract). `addr_type` omitted (YAGNI).
  - `RpcOpenChannelParams { pubkey: Hex; funding_amount: Hex; public?: boolean;
    funding_fee_rate?: Hex; commitment_fee_rate?: Hex;
    tlc_fee_proportional_millionths?: Hex }` — the remaining 0.9 knobs (shutdown_script,
    commitment_delay_epoch, tlc_min_value, max_tlc_*, one_way, funding_udt_type_script)
    are omitted from B.
  - `RpcOpenChannelResult { temporary_channel_id: Hex }`
  - `RpcUpdateChannelParams { channel_id: Hex; enabled?: boolean;
    tlc_fee_proportional_millionths?: Hex; tlc_expiry_delta?: Hex;
    tlc_minimum_value?: Hex }`
  - `RpcShutdownChannelParams { channel_id: Hex; close_script?: UdtScript;
    fee_rate?: Hex; force?: boolean }`
- **`channel-client.ts`** — `ChannelClient extends HealthClient` (inherits JSON-RPC
  plumbing, Authorization header, `RpcMethodError`/`RpcHttpError` taxonomy, and
  `listChannels()`): `connectPeer(p)`, `openChannel(p)`, `updateChannel(p)`,
  `shutdownChannel(p)`. Thin — no retry/backoff logic in B.
- **`channel-watch.ts`** — `watchChannelState(client, channelId, opts)`:
  polls `listChannels()` until the channel's `state.state_name === "ChannelReady"`, a
  terminal failure (a `failure_detail`-bearing channel, or a previously-seen channel
  disappearing from the list), or the poll budget is exhausted.
  `opts { maxPolls = 60, delayMs = 5000, onTick?, delayFn? }` — `delayFn` injectable so
  tests run with zero delay. Returns
  `{ outcome: "ready" | "failed" | "timeout"; channel?: RpcChannel; polls: number;
  failureDetail?: string }`. Matches by `channel_id`, accepting that `open_channel`
  returns a TEMPORARY id: the watcher first resolves the temp id to the real channel by
  matching on counterparty `pubkey` + newest `created_at` when the temp id is not found
  directly (documented limitation: concurrent opens to the same peer can ambiguate; C
  opens serially).

### packages/biscuit

- **`scopes.ts`** — `ScopeTemplate` gains `"operator"`;
  `operator → [...READONLY, 'write("channels")', 'write("peers")']`;
  `full → [...READONLY, 'write("channels")', 'write("cch")', 'write("invoices")',
  'write("peers")', 'write("payments")']`.
- CLI `--scope` validation and the web WalletPanel `<select>` gain `operator`.

### apps/cli

- **`commands/channel.ts`** — command group following the existing dispatch pattern:
  - `channel connect --address <multiaddr> [--pubkey <hex>] [--save]`
  - `channel open --pubkey <hex> --amount <CKB> [--private] [--fee-rate <ppm>]`
    (CKB → shannons ×10^8 → hex; prints temporary_channel_id)
  - `channel list [--json]` (reuses list_channels; renders state/balances/pubkey)
  - `channel update --channel-id <hex> [--enable|--disable] [--fee-rate <ppm>]`
  - `channel close --channel-id <hex> [--fee-rate <shannons-per-kb>]`
    (`--force` requires the additional literal flag `--yes-force`)
  - `channel watch --channel-id <hex> [--max-polls N] [--interval s] [--json]`
  - Token resolution via the existing `resolveToken` (`--profile`/`--auth-token-file`/
    `FNN_AUTH_TOKEN`/`--biscuit`); exit codes and `--json` follow house style.

### apps/web

- **`ChannelPanel.tsx`** — mirrors the other panels (profile picker + url + password-type
  token field). Sections: Connect form; Open form (funding amount entered in CKB,
  converted to shannon hex; shows the auto-accept floor hint); Channel list (auto-poll
  while any channel is in a pending state) with per-channel enable/disable, fee update,
  and Close; two-step confirm on Open and Close (echoes amount / channel id); force-close
  requires typing `force`. Shows a "SIMULATED" badge when driven by the sim.
- **`demo/channel-sim.ts`** — `makeChannelSimFetch(base: typeof fetch): typeof fetch`.
  In-memory channel array (module-instance state, fresh per factory call). Handles:
  `connect_peer` (records peer, returns ok), `open_channel` (appends channel in
  `NegotiatingFunding`, returns temp id), `list_channels` (each call ADVANCES every
  pending channel one step: `NegotiatingFunding → CollaboratingFundingTx →
  SigningCommitment → AwaitingChannelReady → ChannelReady`; then serves the list),
  `update_channel` (mutates enabled/fee), `shutdown_channel` (marches to `Closed`, then
  removes after 2 more polls). Everything else delegates to `base` (the existing
  demoFetch). Error fidelity: `-32999` if the request lacks an Authorization header;
  method error for unknown channel_id — so the panel's error paths run in demo too.
  App wires `fetchOverride={demo ? makeChannelSimFetch(demoFetch) : undefined}` for the
  ChannelPanel (single sim instance per demo-toggle, so state persists across polls but
  resets when demo toggles off/on).

## Data flow (demo-day path)

```
mint operator token (wallet or CLI, from the node's key)
  → connect_peer {address: /ip4/../tcp/../p2p/..}        [write("peers")]
  → open_channel {pubkey, funding_amount}                [write("channels")]
      node funds from its own CKB wallet → temporary_channel_id
  → auto-poll list_channels → state marches → ChannelReady   (CLI: channel watch)
  → Health/Liquidity/Map panels light up with the real channel
  → update_channel {tlc_fee_proportional_millionths}     → Diagnose reflects new fee
  → shutdown_channel (cooperative)                       → Liquidity shows it gone
```

Funding realities: amount must clear the counterparty's
`open_channel_auto_accept_min_ckb_funding_amount` (surfaced as a hint by querying the peer
where reachable, else documented in the panel help); channel-ready wait is on-chain
confirmation time — watch defaults are generous (60 polls × 5 s).

## Error handling

- **Auth errors teach the two layers.** On `-32999`, CLI/panel messaging distinguishes
  "token not signed by the node's key (import the node key / mint from it)" from "scope
  insufficient — this operation needs `operator` (`connect_peer` requires
  write(\"peers\"))". Detection heuristic: if a readonly-covered call (e.g. `list_channels`)
  succeeds with the same token but the write op returns -32999, report scope-insufficient;
  otherwise report key-mismatch.
- **Async failure after RPC success.** `open_channel` success only starts negotiation.
  `watchChannelState` reports terminal failures with the node's `failure_detail` verbatim;
  the panel renders per-channel state + failure detail inline. No silent stalls.
- **Destructive-op guard rails.** Two-step confirms in web (echo amount/id); force-close
  gated behind typed `force` (web) / `--yes-force` (CLI). `update_channel` is reversible —
  no ceremony.
- **Token hygiene.** Tokens never logged, echoed, or written to fixtures — house rule.

## Testing

- **Unit (Vitest):** param-shape construction; `ChannelClient` wiring via injected
  `fetchImpl` (asserts method, params, Authorization header — mirrors
  `graph-client.test.ts`); `watchChannelState` outcomes (ready / failed-with-detail /
  disappeared / timeout / temp-id resolution) with zero-delay `delayFn`; scope templates
  (operator facts exact; full includes peers+payments); channel-sim determinism (open →
  4 polls → ChannelReady; close → Closed → removed; delegation passthrough; -32999 without
  auth header); CLI arg parsing (incl. `--force` without `--yes-force` rejected).
- **Authorization ground truth:** biscuit test authorizing `connect_peer` against the
  node's actual datalog rule (`allow if write("peers")`) — `operator` passes, the OLD
  `full` fact-set fails. Pins the reason the scope exists.
- **Live smoke (gated):** `smoke:channel` — mints `operator`, `connect_peer` to
  `FRD_PEER_ADDR` (SKIP if unset), asserts accepted; asserts `open_channel` with an
  absurd funding amount fails CLEANLY (error, not hang) — proves the authorized write path
  without spending. Real funded opens are manual (Sub-project C; outward on-chain actions
  stay user-triggered).
- **Browser verification (pre-merge):** playwright pass over the demo sim — open → watch
  march to ChannelReady → fee-update → close; SIMULATED badge visible; two-step confirm
  works.

## Non-goals (B)

- Payments/invoices (`send_payment`, `new_invoice`) and rebalancing.
- UDT-funded channels (`funding_udt_type_script`) — CKB only in B.
- Multi-node orchestration (C runs the manager against each node in turn).
- Retry/backoff sophistication in `ChannelClient`.
- Using 0.9's `outbound_liquidity` in Diagnose (logged as a separate enhancement).
- `open_channel_with_external_funding` / external-wallet signing.

## Rollback / risk

All code is additive (new files + scopes addition + App wiring). The one shared-surface
change is `scopes.ts` — covered by exact-fact tests. Live-node risk is bounded: the smoke
never funds; funded operations happen only when a human runs them (C).
