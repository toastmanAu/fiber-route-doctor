# Tier B: In-Browser Biscuit Keystore GUI — Design

**Date:** 2026-07-03
**Status:** Approved (custody model, scope, placement all approved by Phill)
**Piece:** Tier B of the Fiber Ops toolkit — brings the CLI's key/token custody into the web app so the browser demo is self-contained (no CLI needed to get a token into the panels).

## Purpose

Today the web panels (Health, Liquidity, Map) take a biscuit token via a manual `type="password"` field — the operator must mint one at the CLI first. Tier B closes that: create or import a mnemonic in the browser, encrypt it at rest in IndexedDB, mint scoped tokens on demand, save them as named profiles, and let every panel consume a profile from a picker. The whole demo becomes browser-only.

## Custody model (approved: passphrase-per-operation)

The quantum-purse KeyVault discipline, adapted: **no session unlock, no decrypted secret held between operations.** The mnemonic/key is decrypted only inside a single mint or export call, and the passphrase bytes are zeroized in a `finally` block. There is no "unlocked" state to manage, expire, or leak. Minting is rare enough that a passphrase prompt per mint is acceptable UX, and it removes the entire key-lifetime attack surface.

## Reuse (the crypto core already exists and is browser-safe)

`packages/biscuit/src` already contains pure, browser-safe primitives — verified: only `token-store.ts` and `keystore-backend.ts` import `node:fs`; everything else uses `@noble/*`, `@scure/bip39`, `@biscuit-auth/biscuit-wasm`:
- `newMnemonic()`, `deriveFromMnemonic(m)`, `importPrivateKeyString(raw)` → `BiscuitKey {privateKeyString, publicKeyString}` (keys.ts)
- `encryptSecret(secret, passphrase, kind, publicKeyString): KeystoreFile` / `decryptSecret(ks, passphrase): string` (keystore.ts — scrypt N=2¹⁵ + XChaCha20-Poly1305)
- `mintToken({privateKeyString, facts, expiry}): string` (mint.ts); `scopeFacts(scope, extra?)` (scopes.ts); `inspectToken(tokenB64, publicKeyString)` (inspect.ts)

Tier B adds only **IndexedDB persistence + React UI** around these. No new crypto.

## Architecture (approved: biscuit `/browser` subpath)

Browser-only IndexedDB backends live in `packages/biscuit/src/browser/` and are exposed via a package.json subpath export so the web app imports `@fiber-route-doctor/biscuit/browser` and can never transitively pull `node:fs`. Custody logic stays inside the audited crypto package.

### `packages/biscuit/package.json`
Add to `exports`:
```json
"./browser": "./src/browser/index.ts"
```
(`.` continues to point at the node-inclusive index; the web app uses only `./browser` + the root's pure re-exports it already consumes.)

### `packages/biscuit/src/browser/idb.ts` — tiny promise-wrapped IndexedDB
- `openStore(): Promise<IDBDatabase>` — DB `fiber-route-doctor`, version 1, two object stores: `keystore` (single record, key `"default"`) and `profiles` (keyed by profile name).
- `idbGet<T>(store, key): Promise<T | undefined>`, `idbPut(store, key, value): Promise<void>`, `idbGetAll<T>(store): Promise<T[]>`, `idbDelete(store, key): Promise<void>`. Each wraps the request in a Promise; rejects on `onerror`.
- Pure structural-clone-safe values only (KeystoreFile and TokenProfile are plain JSON).

### `packages/biscuit/src/browser/keystore-idb.ts`
- `interface BrowserKeystore { load(): Promise<KeystoreFile | undefined>; save(ks: KeystoreFile): Promise<void>; clear(): Promise<void>; }`
- `class IdbKeystore implements BrowserKeystore` over the `keystore` store, record key `"default"` (single wallet — matches the CLI's single-keystore model).

### `packages/biscuit/src/browser/profile-idb.ts`
- `interface BrowserTokenProfile { name: string; url: string; token: string; scope: string; expiresAt: string; publicKeyString: string; }` (adds `publicKeyString` vs the CLI's `TokenProfile`, so in-browser `inspect` needs no re-entry — resolves a known CLI friction point).
- `interface BrowserProfileStore { list(): Promise<BrowserTokenProfile[]>; get(name): Promise<BrowserTokenProfile | undefined>; put(p): Promise<void>; remove(name): Promise<void>; }`
- `class IdbProfileStore implements BrowserProfileStore` over the `profiles` store.

### `packages/biscuit/src/browser/vault.ts` — the custody orchestrator (pure logic, DI'd stores)
The one place that touches decrypted secrets. All methods take the passphrase as a **string** (from a controlled input) and zeroize any derived `Uint8Array`/intermediate they create; the stored secret string is never retained on `this`.
- `hasKeystore(ks: BrowserKeystore): Promise<boolean>`
- `createWallet(ks, passphrase): Promise<{ mnemonic: string; publicKeyString: string }>` — `newMnemonic()` → `deriveFromMnemonic` → `encryptSecret(mnemonic, passphrase, "mnemonic", pub)` → `ks.save`. Returns the mnemonic ONCE for the user to back up (never persisted in cleartext); caller must display-then-discard.
- `importWallet(ks, secret, kind, passphrase): Promise<{ publicKeyString: string }>` — `kind: "mnemonic" | "privatekey"`; validates via derive/import, encrypts, saves.
- `mint(ks, { passphrase, scope, expiryDays, url, profileName }, profiles): Promise<BrowserTokenProfile>` — load KeystoreFile → `decryptSecret` → derive key → `mintToken({facts: scopeFacts(scope), expiry})` → build profile (with `publicKeyString`) → `profiles.put` → return it. Decrypted secret is scoped to this call.
- `exportMnemonic(ks, passphrase): Promise<string>` — password-gated reveal (`decryptSecret`); returns the mnemonic string for one-time display; caller displays-then-discards. Only valid when `kind === "mnemonic"`.
- Errors: wrong passphrase surfaces the decrypt failure as `Error("incorrect passphrase")` (never logs the passphrase); no keystore → `Error("no wallet — create or import one first")`.

### Web UI (`apps/web/src`)
- `WalletPanel.tsx` — the keystore surface, rendered FIRST in `App.tsx` (above the tool panels). States driven by `hasKeystore`:
  - **No wallet:** "Create wallet" (generates, shows the 24-word mnemonic in a copy-once backup box with an explicit "I've saved it" confirm before the box clears) and "Import" (mnemonic or hex, + passphrase).
  - **Wallet exists:** shows `publicKeyString`; a **Mint token** form (scope select readonly/invoicing/full, expiry days, node url, profile name, passphrase) → on success the profile appears in the list; a **profiles list** (name, scope, url, expiry, truncated token) with inspect (uses stored `publicKeyString`) and delete; an **Export seed phrase** action (passphrase-gated reveal, same copy-once box); and a **Remove wallet** action (confirm) that clears the keystore store.
- `wallet-context.tsx` — a small React context exposing `{ profiles, activeProfileName, setActiveProfile, refreshProfiles }` so the tool panels can read the selected token without prop-drilling. Backed by `IdbProfileStore`.
- **Panel integration:** Health/Liquidity/Map panels gain an optional profile picker at the top: "Token: [profile ▾] or paste". Selecting a profile fills `url` + `token` from the profile (the manual fields remain as fallback/override). Minimal change to each panel: read `useWallet()`, prepend a `<select>`; keep existing state as the override path.
- `crypto.ts` note: `passphrase` inputs are React-controlled `type="password"` strings; we cannot forcibly zero a JS string, but we never persist it, never log it, and never place it in the DOM beyond the masked input — documented as a known browser limitation (the CLI has the same one).

## Data flow

```
create/import → encryptSecret → IdbKeystore.save (IndexedDB `keystore`/"default")
mint → IdbKeystore.load → decryptSecret(passphrase) → deriveKey → mintToken → IdbProfileStore.put
panel → useWallet().activeProfile → {url, token} → HealthClient/GraphClient (unchanged)
export → IdbKeystore.load → decryptSecret(passphrase) → one-time mnemonic display
```

## Security posture

- Decrypted secret exists only within a single vault method's scope; passphrase-derived `Uint8Array`s zeroized in `finally`; no session key, no `this.decrypted`.
- Encrypted-at-rest reuses the CLI's audited `KeystoreFile` (scrypt N=2¹⁵ bounded KDF params, XChaCha20-Poly1305). IndexedDB holds only the ciphertext record and token profiles.
- Tokens are capability-scoped and expiring; profiles store the token (a bearer credential) — same trust level as the CLI's `profiles.json`, documented.
- The mnemonic is shown exactly at create and at explicit export, each behind a confirm, never auto-persisted in cleartext, never sent anywhere (no network in the vault).
- Known limitation (documented in-code and in README): JS strings can't be securely zeroized; a determined local attacker with heap access during a mint is out of scope, as for the CLI.

## Testing

- **idb**: fake-indexeddb (dev-dep) round-trips for get/put/getAll/delete; two-store isolation.
- **keystore-idb / profile-idb**: save→load→clear; list ordering; missing-record undefined.
- **vault** (the crux, pure logic with injected fake stores): createWallet returns a valid 24-word mnemonic + persists ciphertext (never cleartext — assert the stored record contains no mnemonic substring); importWallet (mnemonic + hex) round-trips; mint produces a token that `inspectToken` validates against the returned `publicKeyString` with the expected scope facts; wrong passphrase → `Error("incorrect passphrase")`; export returns the original mnemonic; no-keystore mint/export errors.
- **wallet-context**: profile list refresh; active-profile selection.
- Web components verified by `npm run typecheck` + existing web tests staying green (consistent with the panels' testing posture; view/logic is in the tested vault + context).
- **Gated live smoke** `npm run smoke:wallet` (node, reuses fake-indexeddb): create wallet → mint readonly → use the minted token against a live node's `graph_channels`, asserting acceptance — proves the browser custody path produces node-accepted tokens end-to-end (env-gated like the others).

## Out of scope / backlog

- Multiple simultaneous wallets (single-keystore model, as CLI).
- Hardware/passkey custody, WebAuthn.
- Timed session unlock (deliberately rejected for this tier).
- Cross-device sync / cloud backup.
- PQ (SPHINCS+) keys — quantum-purse's variant machinery is inspiration for the pattern only; Fiber biscuit auth is Ed25519.

## Composition story (demo — now fully in-browser)

```
open the web app → Create wallet (back up the 24 words) →
Mint token (readonly, driveThree url) → pick that profile in the Map panel →
Load map → 246 nodes render, no CLI touched
```
