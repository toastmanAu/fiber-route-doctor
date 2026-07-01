# Fiber Biscuit Key & Token Manager — Design Spec

- **Date:** 2026-07-01
- **Status:** approved — ready for implementation planning
- **Hackathon:** "Gone in 60ms: Fiber Network Infrastructure Hackathon" (July 1–15, 2026 · $20k · CKBoost)
- **Category:** 1 — Wallet and Payment UX Infrastructure (with operator/diagnostics overlap into Category 2)
- **Part of:** the Fiber Route Doctor operator toolkit (this is the shared auth foundation every tool depends on)
- **Target Fiber version:** v0.9.x (grounded against `nervosnetwork/fiber` `crates/fiber-lib/src/rpc/biscuit.rs`, `fiber-cli/README.md`)

## 1. Problem & gap

Fiber nodes on any public (non-loopback) interface **must** enable biscuit authentication (`rpc/mod.rs` refuses to start a public listener without `rpc.biscuit_public_key`). But the Fiber tooling only *verifies* and *consumes* tokens:
- The node (`fnn`) verifies a bearer token against its `biscuit_public_key` using per-method datalog rules (`allow if read("channels")`, `write("cch")`, …).
- `fiber-cli` (`fnn-cli`) accepts a token via `--auth-token` / `--auth-token-file` / `FNN_AUTH_TOKEN`.

Nothing **mints** tokens, and nothing manages the biscuit **root key**. Operators hand-roll tokens with the raw biscuit library, and the root key is a bare hex Ed25519 blob — not something a human can safely hold, back up, or re-enter. No Fiber wallet manages this key. This tool fills that gap: **a key-and-token manager that makes biscuit auth usable by humans**, via CLI, SDK, and a local GUI, without deviating from Fiber's protocol.

## 2. Personas

- **Operator** — holds the biscuit **root key**; bootstraps auth on their node, mints scoped tokens, hands tokens to clients/tools. Needs safe key custody (seed phrase, encrypted at rest) and easy minting.
- **Client / tool** — never touches a key; receives a minted bearer token and uses it. Route Doctor and the other toolkit tools are clients.

## 3. Scope tiers

Beyond a bare MVP by explicit request. Three tiers; the plan builds them in order.

### Tier A — Core (SDK + CLI) — must ship
1. **Keystore** — generate a BIP39 mnemonic → derive the biscuit Ed25519 keypair (SLIP-0010) → encrypt the seed at rest (passphrase). Import an existing raw-hex key or a mnemonic. Export the public key (for node config). Pluggable backend (Node fs now; browser IndexedDB in Tier B).
2. **Mint** — unlock keystore → build an authority block (scope facts + expiry check) → sign via `@biscuit-auth/biscuit-wasm` → base64 bearer token.
3. **Token store** — save minted tokens as named profiles (`{url, token, scope, expiresAt}`), separate from the keystore.
4. **Inspect** — decode any token's facts / checks / expiry / revocation id.
5. **CLI** — `keys init|import|list|export-public`, `token generate|list|show|inspect`.
6. **Auth resolution for the toolkit** — every toolkit command resolves a token via `--profile <name>` (from the store) or the fnn-cli-compatible `--auth-token` / `--auth-token-file` / `FNN_AUTH_TOKEN`. Route Doctor's `--biscuit` is superseded by `--profile`.

### Tier B — GUI (web) — target
A first-class local web GUI (a new "Auth" area in the existing `apps/web`), **client-side custody**: the keystore lives in the browser (IndexedDB, encrypted), all crypto runs in-browser (biscuit-wasm + noble), and **no secret ever leaves the browser**. Flows: create/unlock keystore (passphrase modal), generate mnemonic with a one-time backup confirmation, import (hex/mnemonic), mint tokens (scope picker + expiry), manage profiles (list, copy, expiry warnings), inspect a token, and a one-click "use this token in Route Doctor." Mirrors the `quantum-purse` KeyVault pattern (`generateMasterSeed` / `importSeedPhrase` / `exportSeedPhrase` / unlock).

### Tier C — Reach — if time allows
- Token lifecycle: expiry countdown + one-click re-mint of an expiring profile.
- "Bootstrap wizard": generate key → show the exact `rpc.biscuit_public_key` config line → verify the node accepts a freshly minted token.
- Wire the minted token automatically into the other toolkit tools (health probe, liquidity snapshot, network map).
- Documented path toward the full "Fiber auth wallet" (hardware/passkey custody, revocation-list management) — roadmap, not built.

## 4. Architecture

```
                     @fiber-route-doctor/biscuit  (UI-free SDK)
   ┌───────────────────────────────────────────────────────────────┐
   │ keystore.ts   mnemonic(bip39) → ed25519(slip-0010) → key;      │
   │               encrypt seed (scrypt + xchacha20poly1305);       │
   │               KeystoreBackend: NodeFsBackend | BrowserIdbBackend│
   │ mint.ts       scope → datalog facts + expiry → biscuit-wasm    │
   │ token-store.ts named profiles {url, token, scope, expiresAt}   │
   │ inspect.ts    decode facts/checks/expiry (ported biscuitPolicy)│
   │ auth.ts       resolveToken(profile | flags | env)              │
   └───────────────┬───────────────────────────────┬───────────────┘
                   │                               │
        apps/cli (fiber-ops token/keys)   apps/web  Auth GUI (client-side keystore)
                   │                               │
                   └──────────► used by ◄──────────┘
             Route Doctor + (later) health probe, liquidity, network map
```

**Data flow (mint):** unlock keystore (passphrase → decrypt seed → derive key, in memory) → `mint(scope, expiry, key)` builds an authority block with the scope's `read(...)`/`write(...)` facts and a `check if time($time), $time <= <rfc3339>` → sign → base64 token → optionally save to a profile → **key material zeroized**.

## 5. Key management (grounded)

- **Mnemonic:** `@scure/bip39` (audited). 24 words default.
- **Derivation:** BIP39 seed → SLIP-0010 Ed25519 (`micro-key-producer`) at a single fixed hardened path, frozen as a constant `BISCUIT_DERIVATION_PATH = "m/44'/1'/0'"` (the number is an arbitrary app constant — this is a biscuit auth key, *not* a chain/address key; only determinism matters) → 32-byte private key → `biscuit-wasm` `PrivateKey.fromBytes`. Deterministic: the same mnemonic always reproduces the same key on any machine.
- **At-rest encryption:** passphrase → `scrypt` (`@noble/hashes`) → key → `XChaCha20-Poly1305` (`@noble/ciphers`) over the seed. Ciphertext + params (salt, nonce, kdf cost) stored; plaintext seed never persisted.
- **Import:** raw hex Ed25519 (existing nodes like driveThree) *or* a mnemonic (restore). Raw-hex imports are wrapped in the same encrypted keystore.
- **Compatibility:** biscuit uses plain Ed25519, matching Fiber's `PrivateKey::from_str`/`KeyPair::from`. For new setups the operator installs *our* derived public key hex into `rpc.biscuit_public_key`, so keys match by construction.

## 6. Scopes → datalog (grounded in `biscuit.rs` `build_rules`)

| Template | Facts | Covers |
|---|---|---|
| `readonly` | `read("node"); read("peers"); read("channels"); read("payments"); read("graph"); read("cch");` | `graph_nodes`, `graph_channels`, `list_channels`, `node_info` — everything the read-only toolkit tools need |
| `invoicing` | readonly + `write("invoices");` | receiving payments |
| `full` | readonly + `write("channels"); write("cch"); write("invoices");` | channel/CCH management |
| custom | `--fact 'read("channels")'` (repeatable) | anything |

Every token carries `check if time($time), $time <= <expiry-rfc3339>` (default 30 days), matching the `time` fact Fiber injects (`Term::Date(ms/1000)`).

## 7. Compatibility & validation gates

1. **Offline authorizer test (the crux):** in a unit test, replicate Fiber's authorizer — `AuthorizerBuilder.code('allow if read("channels")').fact(time).build(token).authorize()` via biscuit-wasm with the derived public key — proving a minted `readonly` token passes Fiber's exact per-method check **without a live node**. Repeat for a `write` rule with a `readonly` token to assert it is *rejected*.
2. **Live gate:** mint from the real `~/.fiber-dt/biscuit_private_key` (import path) → call `graph_channels` on `http://127.0.0.1:8231` → success. This closes the original "point Route Doctor at the live node" loop.

## 8. Security (auth + key-custody code — mandatory review)

- **Client-side / local custody only.** Node keystore is a `600` file under `~/.config/fiber-route-doctor/`; browser keystore is IndexedDB. No secret is ever sent over the network. The web GUI performs all crypto in-browser.
- **Never persist plaintext** key or seed; only passphrase-encrypted ciphertext. Never store the root key in a token profile.
- **Zeroize** derived key material after minting; keep it in memory only as long as needed.
- **Never log** keys, seeds, or full tokens; mask tokens in list output.
- Wrong passphrase → clean auth error, no partial decrypt leak.
- A `security-reviewer` pass is **required before merge** (in addition to the standard task reviews).

## 9. Testing

- **Pure units (golden/deterministic):** scope→facts builder; mnemonic→key→public-hex determinism (fixed test vector); keystore encrypt→decrypt round-trip; wrong-passphrase rejection; token-store add/list/get/remove (temp dir); inspect decode against fixtures.
- **Compatibility:** the offline authorizer test in §7.1 (accept + reject).
- **CLI:** arg parsing + command wiring; masked output.
- **GUI:** the pure `KeyVault`/profile view-model logic is unit-tested; React shell is a thin consumer (buildProbe-style).
- **Gated live test:** §7.2, skip-on-missing-key.
- 80% coverage on the SDK core.

## 10. Deliverables → hackathon checklist

Open-source (MIT, in the existing repo) · the CLI + SDK + the hosted web GUI (client-side, safe to host since it holds no server secrets) · video (create keystore → mint token → authenticate Route Doctor live) · infra-gap analysis (Fiber mandates biscuit auth but ships no minting/key tooling) · roadmap (Tier C + the auth-wallet vision) · Category 1.

## 11. Non-goals (this spec)

- Not a general CKB wallet; scope is the biscuit root key + RPC tokens only.
- No hardware-wallet/passkey custody yet (roadmap).
- No token revocation-list management (node-side state; documented).
- No HD account tree — one root key per keystore (single fixed derivation path).
- Not changing Fiber's protocol or auth rules — we mint tokens the existing node already accepts.
