# Hackathon Submission — Fiber Route Doctor

Answers for the "Gone in 60ms" Fiber Infrastructure Hackathon submission form.

---

## 1. Submission category

Category 2: Node, Routing, Cross-Chain, and Diagnostics Infrastructure

---

## 2. Project overview

Fiber Route Doctor is an open-source (MIT) operator toolkit for Fiber Network nodes — six composable tools sharing one engine: payment-route diagnostics, a biscuit key & token manager, a node health probe, a channel liquidity snapshot, an interactive network map, and a channel manager. It answers the questions a node operator actually asks: would this payment succeed, via what path, and if not exactly why? Is my node healthy? What can it send and receive right now? What does the network look like from here — and how do I open and manage channels on it?

Target audience: Fiber node operators and routing-node runners first, and dApp/wallet developers building on fnn's RPC second. It ships as a CLI for operators, a TypeScript core library for developers, and a hosted web app (installable PWA whose demo mode — including the wasm crypto — works fully offline: https://toastmanau.github.io/fiber-route-doctor/). 274 automated tests; every tool validated live against real fnn v0.9.0-rc7 testnet nodes.

---

## 3. What problem does it solve?

Fiber's node software is production-lean but operationally opaque. We documented five infrastructure gaps (each backed by a working tool and live-testnet proof — full write-up in docs/GAP-ANALYSIS.md):

1. **Credential lifecycle** — fnn *mandates* biscuit auth on any public RPC listener but ships no way to mint tokens. Our key & token manager fills this: BIP39 → SLIP-0010 Ed25519 key custody (encrypted at rest) and offline minting of scoped tokens (readonly / invoicing / operator / full) mapped to fnn's actual datalog rules.
2. **Payment-failure diagnostics** — `build_router` returns nothing actionable on failure. Route Doctor loads the gossip graph, self-computes a constrained least-fee path, and attributes any block to ranked causes and fixes (liquidity floors, min/max limits, expiry, fee ceilings, disabled channels, asset mismatch).
3. **Health & readiness** — no health endpoint, undocumented auth semantics. The health probe runs five checks with CI-style exit codes, watch mode, and Slack/Discord webhooks.
4. **Liquidity observability** — RPC exposes raw channel state only. The snapshot tool aggregates per-asset send/receive capacity, flags drained/full skew, and diffs saved snapshots over time.
5. **Topology visibility** — no way to see the network. The map renders the gossiped graph (deterministic force layout, hubs ranked, your node and diagnosed route highlighted).

Along the way we catalogued seven reproducible sharp edges in fnn's RPC (e.g. the silent 500-row page cap that truncated our own graph reads until we noticed, and `-32999 Unauthorized` arriving over HTTP 200) — documented with fixes as upstream-ready feedback.

---

## 4. System design

Monorepo with a strict layering rule: all logic lives in UI-free packages; the CLI and web app are thin shells over the same engine.

- `packages/core` — GraphClient (JSON-RPC + cursor-pagination loop), immutable GraphModel, constrained least-fee pathfinder, diagnosis/attribution engine, health/liquidity/map/channel clients, deterministic d3-force layout.
- `packages/biscuit` — mnemonic/key derivation, encrypted keystore, scope templates → biscuit datalog facts, token minting/inspection, shared token resolution.
- `apps/cli`, `apps/web` — shells.

**Operator flow (CLI):** `keys init` (or `keys import --hex` to adopt an existing node key) → `token generate --scope readonly --profile dt` → every command (`diagnose`, `health`, `liquidity`, `map`, `channel …`) resolves auth the same way: `--biscuit` | `--auth-token-file` | `--profile` | `FNN_AUTH_TOKEN`. Channel lifecycle: `channel connect/open/watch/update/close`, with force-close double-gated (`--force --yes-force`).

**Web flow:** in-browser wallet (IndexedDB keystore, scrypt + XChaCha20-Poly1305, passphrase-per-operation) → mint a scoped token entirely client-side in wasm → token lands as a named profile that all panels select from. Demo mode swaps the transport for a bundled real-testnet snapshot (and a clearly-badged channel simulator), so the full UX is explorable with no node; as a PWA it's installable and works offline after one visit.

**Developer flow:** TDD throughout (274 tests); pure functions for everything testable; live-node behavior covered by seven gated smoke scripts (`smoke:biscuit/health/liquidity/map/wallet/channel/live`) that skip unless env vars point at a real node — the channel smoke asserts authorization and clean rejection without ever funding.

---

## 5. Setup environment

- Dev machine: Linux (Ubuntu), Node.js ≥22, npm ≥11 workspaces. `npm install && npm test` is the whole setup.
- Live test fleet: two fnn v0.9.0-rc7 testnet nodes on LAN — an x86 desktop and a Raspberry Pi — with biscuit auth enabled (`rpc.biscuit_public_key`), funded from the testnet faucet. We opened a real 500-CKB channel between them *using the toolkit itself* and left it open as live demo data.
- Web: React 18 + Vite 5, deployed by GitHub Actions to GitHub Pages on every push to master; CI runs the full test suite plus a 29-check PWA verification before deploying. No backend anywhere — the web app is fully client-side.

---

## 6. Tooling

- **Fiber (fnn) JSON-RPC v0.9**: `graph_nodes` / `graph_channels` (with cursor pagination), `node_info`, `list_peers`, `list_channels`, `connect_peer`, `open_channel`, `update_channel`, `shutdown_channel`, and `build_router` as an optional cross-check on our own pathfinder.
- **biscuit-wasm 0.6** — token minting, inspection, and local authorization checks against fnn's per-method datalog rules (we ground-truthed our scopes against `rpc/biscuit.rs build_rules()` in the fiber source).
- **@scure/bip39 + SLIP-0010 (micro-key-producer) + noble crypto** — mnemonic → Ed25519 biscuit key; scrypt + XChaCha20-Poly1305 for keystore encryption (Node fs keystore for CLI, IndexedDB for web).
- **CKB testnet** — channel funding/settlement happens on-chain via the node's wallet; our channel-open flow was proven with a real on-chain funded channel.
- **d3-force** (deterministic layout), **React 18 / Vite 5 / vite-plugin-pwa (Workbox)**, **Vitest**, **tsx**. TypeScript strict ESM throughout.

---

## 7. Current functionality

All six tools are complete, merged, and live-proven against real v0.9.0-rc7 nodes:

1. **Route diagnostics** — full-graph load (pagination-correct), least-fee constrained path, verdict payable/blocked with ranked causes and fixes; SVG route visualization in the web app; `--router` cross-check against the node's `build_router`. Live: diagnosed a payable 1-hop route over our own real channel.
2. **Biscuit key & token manager** — key init/import/export-public, scoped token minting with expiry, named profiles, token inspection. Live: our tokens are accepted by real fnn nodes; a stranger-key token is rejected (both asserted in smokes).
3. **Node health probe** — 5 checks, worst-status verdict, exit codes 0/1/2, `--watch`, edge-triggered Slack/Discord/generic webhooks that never carry the token.
4. **Channel liquidity snapshot** — per-asset totals, per-channel bars, drained/full skew flags, TLC holds, per-peer groups, saved snapshots + `--diff`. Live: correctly flagged our fresh channel as full-skew (all liquidity local).
5. **Fiber network map** — interactive pan/zoom panel with node details and Diagnose-route overlay; self-contained HTML export. Live: renders the current testnet (~1,100 channels from our vantage) with our node and channel marked.
6. **Channel manager** — connect/open/watch/update/close from CLI and web, operator-scoped tokens, temp-to-real channel-id resolution while watching, two-step confirms in the UI, and a stateful simulator for the hosted demo. Live: opened a real 500-CKB dt→Pi channel with it.

Plus the hosted PWA (installable, offline demo), 274 tests, and the gap-analysis document with the seven-trap catalog.

---

## 8. Future functionality

- **Payment execution**: extend diagnose → execute (send along the verified route via `send_payment`, invoice/keysend flows), turning the dry-run tool into a full payment debugger.
- **Fleet operations**: multi-node dashboards (the config already models profiles per node), historical time-series from saved snapshots, and alerting beyond webhooks — liquidity-skew and channel-state alerts feeding the health watch loop.
- **LSP-grade liquidity automation**: use the skew flags to drive automated rebalancing and fee-policy updates (`channel update` already exposes the levers).
- **Hardening for mainnet custody**: hardware-key support and token revocation lists in the biscuit manager; the gap analysis also proposes upstream asks (health endpoint, structured auth errors, documented pagination) that would simplify every downstream tool.
- **Cross-chain diagnostics**: extend failure attribution to CCH (BTC↔wBTC) hops as Fiber's cross-chain surface grows, and PTLC-era readiness as those land on the roadmap.
- **Library packaging**: publish `@fiber-route-doctor/core` and `/biscuit` to npm so wallets and dashboards can embed graph loading, diagnosis, and token minting directly.
