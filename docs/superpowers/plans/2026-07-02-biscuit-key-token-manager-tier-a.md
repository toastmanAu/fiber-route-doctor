# Biscuit Key & Token Manager — Tier A (SDK + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the SDK + CLI that mints, stores, recalls, and inspects Fiber biscuit RPC tokens, with human-friendly seed-phrase key custody (encrypted at rest) — the shared auth foundation for the Fiber Route Doctor toolkit.

**Architecture:** A new UI-free package `@fiber-route-doctor/biscuit` (keys, mint, keystore, token-store, inspect, auth-resolution) consumed by the existing `apps/cli`, restructured into subcommands (`diagnose`, `keys`, `token`). Minting uses `@biscuit-auth/biscuit-wasm`; keys derive from BIP39 mnemonics via SLIP-0010 Ed25519; the seed/mnemonic is encrypted at rest with scrypt + XChaCha20-Poly1305.

**Tech Stack:** TypeScript (Node ≥22, ESM, strict), Vitest, `@biscuit-auth/biscuit-wasm@^0.6.0`, `@scure/bip39`, `micro-key-producer`, `@noble/hashes`, `@noble/ciphers`.

## Global Constraints

- Node ≥22, npm ≥11. TypeScript, ESM (`"type":"module"`), strict. MIT. Package name `@fiber-route-doctor/biscuit`.
- Internal relative imports use `.js` suffix (resolves to `.ts` under moduleResolution Bundler).
- **Verified external API (use exactly — confirmed by spike):**
  - Import paths: `@scure/bip39`, `@scure/bip39/wordlists/english.js`, `micro-key-producer/slip10.js`, `@noble/hashes/utils.js` (`bytesToHex`, `hexToBytes`, `randomBytes`), `@noble/hashes/scrypt.js` (`scrypt`), `@noble/ciphers/chacha.js` (`xchacha20poly1305`), `@biscuit-auth/biscuit-wasm`.
  - Private key string format is `ed25519-private/<64 hex>`; public is `ed25519/<64 hex>`. `PrivateKey.fromString` accepts the prefixed private form; `PrivateKey.fromBytes(Uint8Array32)` accepts raw bytes. `KeyPair.fromPrivateKey(pk).getPublicKey().toString()` yields `ed25519/<hex>`. **`PublicKey.fromString` requires RAW hex — strip the `ed25519/` prefix first.**
  - Mint: `` biscuit`check if time($time), $time <= ${expiryDate};` `` then `.addCode('read("channels"); …;')` then `.build(privateKey).toBase64()`.
  - Authorize: `` authorizer`time(${nowDate});` `` then `.addCode('allow if read("channels");')` then `.buildAuthenticated(Biscuit.fromBase64(b64, publicKey)).authorize()` — throws on deny.
  - scrypt params: `{ N: 2**15, r: 8, p: 1, dkLen: 32 }`.
- **Security (mandatory):** never persist plaintext key/seed/mnemonic (only passphrase-encrypted ciphertext); never log keys/seeds/full tokens; keystore + token-store files are `chmod 600`; wrong passphrase → clean error. A `security-reviewer` pass is REQUIRED before this branch merges (in addition to per-task reviews).
- **Type-check gate:** Vitest (esbuild) does NOT type-check. Every task runs `npm run typecheck` AND `npm test`; both must pass before commit.

---

### Task 1: Scaffold `packages/biscuit` + biscuit-wasm Vitest smoke

**Files:**
- Create: `packages/biscuit/package.json`, `packages/biscuit/tsconfig.json`, `packages/biscuit/src/index.ts`, `packages/biscuit/test/smoke.test.ts`
- Modify: root `package.json` (add `typecheck:biscuit` to the aggregate)

**Interfaces:**
- Consumes: nothing.
- Produces: `@fiber-route-doctor/biscuit` resolves; `VERSION`; proves biscuit-wasm mints under Vitest.

- [ ] **Step 1: Write the failing/smoke test**

`packages/biscuit/test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { KeyPair, PrivateKey, biscuit } from "@biscuit-auth/biscuit-wasm";
import { VERSION } from "../src/index.js";

describe("biscuit package", () => {
  it("exposes a version", () => { expect(VERSION).toBe("0.1.0"); });
  it("mints a biscuit token under vitest (wasm loads)", () => {
    const kp = new KeyPair();
    const pk = PrivateKey.fromString(kp.getPrivateKey().toString());
    const b = biscuit`check if time($time), $time <= ${new Date(Date.now() + 3600e3)};`;
    b.addCode('read("channels");');
    const token = b.build(pk).toBase64();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Create package files**

`packages/biscuit/package.json`:
```json
{
  "name": "@fiber-route-doctor/biscuit",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "license": "MIT",
  "dependencies": {
    "@biscuit-auth/biscuit-wasm": "^0.6.0",
    "@scure/bip39": "^1.3.0",
    "micro-key-producer": "^0.7.0",
    "@noble/hashes": "^2.0.0",
    "@noble/ciphers": "^2.0.0"
  }
}
```

`packages/biscuit/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/biscuit/src/index.ts`:
```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 3: Add biscuit to the root typecheck aggregate**

In root `package.json` scripts, add `"typecheck:biscuit": "tsc -p packages/biscuit/tsconfig.json --noEmit"` and append ` && npm run typecheck:biscuit` to the aggregate `typecheck` script.

- [ ] **Step 4: Install and run**

Run: `npm install && npm test -- smoke && npm run typecheck`
Expected: smoke tests PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(biscuit): scaffold package; prove biscuit-wasm mints under vitest"
```

---

### Task 2: Scope templates → datalog facts

**Files:**
- Create: `packages/biscuit/src/scopes.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/scopes.test.ts`

**Interfaces:**
- Produces: `type ScopeTemplate = "readonly" | "invoicing" | "full"`; `function scopeFacts(scope: ScopeTemplate, extra?: string[]): string[]`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/scopes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scopeFacts } from "../src/index.js";

describe("scopeFacts", () => {
  it("readonly covers all read scopes the toolkit needs", () => {
    const f = scopeFacts("readonly");
    for (const s of ["node","peers","channels","payments","graph","cch"]) {
      expect(f).toContain(`read("${s}")`);
    }
    expect(f.some(x => x.startsWith("write("))).toBe(false);
  });
  it("full adds write scopes", () => {
    const f = scopeFacts("full");
    expect(f).toContain('write("channels")');
    expect(f).toContain('write("cch")');
    expect(f).toContain('write("invoices")');
  });
  it("appends extra custom facts", () => {
    expect(scopeFacts("readonly", ['read("custom")'])).toContain('read("custom")');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- scopes` → FAIL (`scopeFacts` not exported).

- [ ] **Step 3: Implement**

`packages/biscuit/src/scopes.ts`:
```ts
export type ScopeTemplate = "readonly" | "invoicing" | "full";

const READONLY = [
  'read("node")', 'read("peers")', 'read("channels")',
  'read("payments")', 'read("graph")', 'read("cch")'
];

export function scopeFacts(scope: ScopeTemplate, extra: string[] = []): string[] {
  switch (scope) {
    case "readonly": return [...READONLY, ...extra];
    case "invoicing": return [...READONLY, 'write("invoices")', ...extra];
    case "full": return [...READONLY, 'write("channels")', 'write("cch")', 'write("invoices")', ...extra];
  }
}
```
Append to `index.ts`: `export * from "./scopes.js";`

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- scopes && npm run typecheck` → PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): scope templates to datalog facts"
```

---

### Task 3: Key derivation (mnemonic / import → Ed25519 biscuit key)

**Files:**
- Create: `packages/biscuit/src/keys.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/keys.test.ts`

**Interfaces:**
- Produces: `BISCUIT_DERIVATION_PATH = "m/44'/1'/0'"`; `interface BiscuitKey { privateKeyString: string; publicKeyString: string }`; `newMnemonic(): string`; `fromPrivateBytes(priv: Uint8Array): BiscuitKey`; `deriveFromMnemonic(mnemonic: string): BiscuitKey`; `importPrivateKeyString(raw: string): BiscuitKey`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/keys.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newMnemonic, deriveFromMnemonic, importPrivateKeyString } from "../src/index.js";

// Fixed BIP39 test vector (all "abandon…about") for determinism.
const FIXED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

describe("keys", () => {
  it("newMnemonic returns 24 words", () => {
    expect(newMnemonic().split(" ").length).toBe(24);
  });
  it("deriveFromMnemonic is deterministic and yields the right key formats", () => {
    const a = deriveFromMnemonic(FIXED);
    const b = deriveFromMnemonic(FIXED);
    expect(a.privateKeyString).toBe(b.privateKeyString);
    expect(a.privateKeyString).toMatch(/^ed25519-private\/[0-9a-f]{64}$/);
    expect(a.publicKeyString).toMatch(/^ed25519\/[0-9a-f]{64}$/);
  });
  it("rejects an invalid mnemonic", () => {
    expect(() => deriveFromMnemonic("not a real mnemonic")).toThrow(/invalid mnemonic/);
  });
  it("imports an ed25519-private/<hex> string and derives its public key", () => {
    const { privateKeyString, publicKeyString } = deriveFromMnemonic(FIXED);
    const imported = importPrivateKeyString(privateKeyString);
    expect(imported.publicKeyString).toBe(publicKeyString);
  });
  it("rejects a malformed private key string", () => {
    expect(() => importPrivateKeyString("deadbeef")).toThrow(/ed25519-private/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- keys` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/keys.ts`:
```ts
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "micro-key-producer/slip10.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { KeyPair, PrivateKey } from "@biscuit-auth/biscuit-wasm";

export const BISCUIT_DERIVATION_PATH = "m/44'/1'/0'";

export interface BiscuitKey { privateKeyString: string; publicKeyString: string; }

export function newMnemonic(): string { return generateMnemonic(wordlist, 256); }

export function fromPrivateBytes(priv: Uint8Array): BiscuitKey {
  const privateKeyString = `ed25519-private/${bytesToHex(priv)}`;
  const publicKeyString = KeyPair.fromPrivateKey(PrivateKey.fromBytes(priv)).getPublicKey().toString();
  return { privateKeyString, publicKeyString };
}

export function deriveFromMnemonic(mnemonic: string): BiscuitKey {
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error("invalid mnemonic");
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive(BISCUIT_DERIVATION_PATH);
  if (!child.privateKey) throw new Error("derivation produced no private key");
  return fromPrivateBytes(child.privateKey);
}

export function importPrivateKeyString(raw: string): BiscuitKey {
  const m = raw.trim().match(/^ed25519-private\/([0-9a-fA-F]{64})$/);
  if (!m) throw new Error("expected an 'ed25519-private/<64 hex>' key string");
  return fromPrivateBytes(hexToBytes(m[1]));
}
```
Append to `index.ts`: `export * from "./keys.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- keys && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): BIP39/SLIP-0010 Ed25519 key derivation and import"
```

---

### Task 4: Mint + local authorize (the compatibility gate)

**Files:**
- Create: `packages/biscuit/src/mint.ts`, `packages/biscuit/src/authorize.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/mint.test.ts`

**Interfaces:**
- Consumes: `scopeFacts` (T2), `deriveFromMnemonic` (T3).
- Produces:
  - `interface MintOptions { privateKeyString: string; facts: string[]; expiry: Date }`; `mintToken(o: MintOptions): string`.
  - `publicKeyHex(publicKeyString: string): string`; `authorizeLocally(tokenB64: string, publicKeyString: string, policyCode: string, now?: Date): boolean`.

- [ ] **Step 1: Write the failing test (this proves a minted token passes Fiber's exact authorizer)**

`packages/biscuit/test/mint.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mintToken, authorizeLocally, scopeFacts, deriveFromMnemonic } from "../src/index.js";

const FIXED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const key = deriveFromMnemonic(FIXED);
const future = new Date(Date.now() + 3600e3);

describe("mint + authorize compatibility gate", () => {
  it("mints a base64 token", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: future });
    expect(typeof t).toBe("string");
    expect(t.length).toBeGreaterThan(50);
  });
  it("a readonly token is ALLOWED for read scopes (replicates Fiber's list_channels/graph rules)", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: future });
    expect(authorizeLocally(t, key.publicKeyString, 'allow if read("channels");')).toBe(true);
    expect(authorizeLocally(t, key.publicKeyString, 'allow if read("graph");')).toBe(true);
  });
  it("a readonly token is DENIED for write scopes (replicates Fiber's open_channel rule)", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: future });
    expect(authorizeLocally(t, key.publicKeyString, 'allow if write("channels");')).toBe(false);
  });
  it("an expired token is DENIED", () => {
    const past = new Date(Date.now() - 1000);
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: past });
    expect(authorizeLocally(t, key.publicKeyString, 'allow if read("channels");', new Date())).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- mint` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/mint.ts`:
```ts
import { biscuit, PrivateKey } from "@biscuit-auth/biscuit-wasm";

export interface MintOptions { privateKeyString: string; facts: string[]; expiry: Date; }

export function mintToken(opts: MintOptions): string {
  const pk = PrivateKey.fromString(opts.privateKeyString);
  const builder = biscuit`check if time($time), $time <= ${opts.expiry};`;
  builder.addCode(opts.facts.map((f) => `${f};`).join(" "));
  return builder.build(pk).toBase64();
}
```

`packages/biscuit/src/authorize.ts`:
```ts
import { Biscuit, PublicKey, authorizer } from "@biscuit-auth/biscuit-wasm";

/** biscuit-wasm's PublicKey.fromString wants RAW hex; the stored form is "ed25519/<hex>". */
export function publicKeyHex(publicKeyString: string): string {
  return publicKeyString.replace(/^ed25519\//, "");
}

/** Replicates Fiber's per-method authorizer offline: true if the token satisfies policyCode at `now`. */
export function authorizeLocally(
  tokenB64: string, publicKeyString: string, policyCode: string, now: Date = new Date()
): boolean {
  try {
    const token = Biscuit.fromBase64(tokenB64, PublicKey.fromString(publicKeyHex(publicKeyString)));
    const ab = authorizer`time(${now});`;
    ab.addCode(policyCode);
    ab.buildAuthenticated(token).authorize();
    return true;
  } catch {
    return false;
  }
}
```
Append to `index.ts`: `export * from "./mint.js";` and `export * from "./authorize.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- mint && npm run typecheck` → PASS (accept + reject + expiry).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): mint scoped tokens; offline authorizer compatibility gate"
```

---

### Task 5: Keystore encryption (scrypt + XChaCha20-Poly1305)

**Files:**
- Create: `packages/biscuit/src/keystore.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/keystore.test.ts`

**Interfaces:**
- Produces:
  - `type KeystoreKind = "mnemonic" | "privatekey"`
  - `interface KeystoreFile { v: 1; kind: KeystoreKind; publicKeyString: string; kdf: "scrypt"; N: number; r: number; p: number; salt: string; nonce: string; ciphertext: string }`
  - `encryptSecret(secret: string, passphrase: string, kind: KeystoreKind, publicKeyString: string): KeystoreFile`
  - `decryptSecret(ks: KeystoreFile, passphrase: string): string`

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/keystore.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../src/index.js";

describe("keystore", () => {
  it("round-trips a secret with the right passphrase", () => {
    const ks = encryptSecret("my seed words", "correct horse", "mnemonic", "ed25519/abc");
    expect(ks.kind).toBe("mnemonic");
    expect(ks.publicKeyString).toBe("ed25519/abc");
    expect(ks.ciphertext).not.toContain("my seed"); // ciphertext is not plaintext
    expect(decryptSecret(ks, "correct horse")).toBe("my seed words");
  });
  it("rejects a wrong passphrase", () => {
    const ks = encryptSecret("s", "right", "privatekey", "ed25519/x");
    expect(() => decryptSecret(ks, "wrong")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- keystore` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/keystore.ts`:
```ts
import { scrypt } from "@noble/hashes/scrypt.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

const N = 2 ** 15, r = 8, p = 1, DK = 32;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type KeystoreKind = "mnemonic" | "privatekey";
export interface KeystoreFile {
  v: 1; kind: KeystoreKind; publicKeyString: string;
  kdf: "scrypt"; N: number; r: number; p: number;
  salt: string; nonce: string; ciphertext: string;
}

export function encryptSecret(secret: string, passphrase: string, kind: KeystoreKind, publicKeyString: string): KeystoreFile {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = scrypt(enc.encode(passphrase), salt, { N, r, p, dkLen: DK });
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(enc.encode(secret));
  return { v: 1, kind, publicKeyString, kdf: "scrypt", N, r, p,
    salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
}

export function decryptSecret(ks: KeystoreFile, passphrase: string): string {
  const key = scrypt(enc.encode(passphrase), hexToBytes(ks.salt), { N: ks.N, r: ks.r, p: ks.p, dkLen: DK });
  const pt = xchacha20poly1305(key, hexToBytes(ks.nonce)).decrypt(hexToBytes(ks.ciphertext));
  return dec.decode(pt);
}
```
Append to `index.ts`: `export * from "./keystore.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- keystore && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): passphrase-encrypted keystore (scrypt + xchacha20poly1305)"
```

---

### Task 6: Node keystore backend (persist/load, chmod 600)

**Files:**
- Create: `packages/biscuit/src/keystore-backend.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/keystore-backend.test.ts`

**Interfaces:**
- Consumes: `KeystoreFile` (T5).
- Produces:
  - `interface KeystoreBackend { load(): KeystoreFile | null; save(ks: KeystoreFile): void; exists(): boolean }`
  - `class NodeFsKeystore implements KeystoreBackend` with constructor `(filePath: string)`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/keystore-backend.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFsKeystore, encryptSecret } from "../src/index.js";

describe("NodeFsKeystore", () => {
  it("saves 600-perm and loads back; exists() reflects state", () => {
    const dir = mkdtempSync(join(tmpdir(), "ks-"));
    const path = join(dir, "keystore.json");
    const store = new NodeFsKeystore(path);
    expect(store.exists()).toBe(false);
    expect(store.load()).toBeNull();
    const ks = encryptSecret("seed", "pass", "mnemonic", "ed25519/x");
    store.save(ks);
    expect(store.exists()).toBe(true);
    expect((statSync(path).mode & 0o777)).toBe(0o600);
    expect(store.load()?.publicKeyString).toBe("ed25519/x");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- keystore-backend` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/keystore-backend.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { KeystoreFile } from "./keystore.js";

export interface KeystoreBackend {
  load(): KeystoreFile | null;
  save(ks: KeystoreFile): void;
  exists(): boolean;
}

export class NodeFsKeystore implements KeystoreBackend {
  constructor(private readonly filePath: string) {}
  exists(): boolean { return existsSync(this.filePath); }
  load(): KeystoreFile | null {
    if (!existsSync(this.filePath)) return null;
    return JSON.parse(readFileSync(this.filePath, "utf8")) as KeystoreFile;
  }
  save(ks: KeystoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(ks, null, 2), { mode: 0o600 });
  }
}
```
Append to `index.ts`: `export * from "./keystore-backend.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- keystore-backend && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): node fs keystore backend with 600 perms"
```

---

### Task 7: Token store (named profiles)

**Files:**
- Create: `packages/biscuit/src/token-store.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/token-store.test.ts`

**Interfaces:**
- Produces:
  - `interface TokenProfile { name: string; url: string; token: string; scope: string; expiresAt: string }`
  - `class NodeFsTokenStore` constructor `(filePath: string)` with `list(): TokenProfile[]`, `get(name: string): TokenProfile | undefined`, `put(p: TokenProfile): void`, `remove(name: string): void`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/token-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFsTokenStore, type TokenProfile } from "../src/index.js";

const p = (name: string): TokenProfile => ({ name, url: "http://n", token: "tok-" + name, scope: "readonly", expiresAt: "2026-08-01T00:00:00Z" });

describe("NodeFsTokenStore", () => {
  it("puts, lists, gets, removes; upsert replaces by name; file is 600", () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-"));
    const path = join(dir, "profiles.json");
    const s = new NodeFsTokenStore(path);
    expect(s.list()).toEqual([]);
    s.put(p("a")); s.put(p("b"));
    expect(s.list().map(x => x.name).sort()).toEqual(["a", "b"]);
    expect(s.get("a")?.token).toBe("tok-a");
    s.put({ ...p("a"), token: "tok-a2" });
    expect(s.get("a")?.token).toBe("tok-a2");
    expect(s.list().length).toBe(2);
    expect((statSync(path).mode & 0o777)).toBe(0o600);
    s.remove("a");
    expect(s.get("a")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- token-store` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/token-store.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface TokenProfile { name: string; url: string; token: string; scope: string; expiresAt: string; }

export class NodeFsTokenStore {
  constructor(private readonly filePath: string) {}
  private read(): TokenProfile[] {
    if (!existsSync(this.filePath)) return [];
    return JSON.parse(readFileSync(this.filePath, "utf8")) as TokenProfile[];
  }
  private write(profiles: TokenProfile[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(profiles, null, 2), { mode: 0o600 });
  }
  list(): TokenProfile[] { return this.read(); }
  get(name: string): TokenProfile | undefined { return this.read().find((p) => p.name === name); }
  put(profile: TokenProfile): void {
    const next = this.read().filter((p) => p.name !== profile.name);
    next.push(profile);
    this.write(next);
  }
  remove(name: string): void { this.write(this.read().filter((p) => p.name !== name)); }
}
```
Append to `index.ts`: `export * from "./token-store.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- token-store && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): node fs token-profile store (600 perms, upsert by name)"
```

---

### Task 8: Inspect a token

**Files:**
- Create: `packages/biscuit/src/inspect.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/inspect.test.ts`

**Interfaces:**
- Consumes: `publicKeyHex` (T4), `mintToken`/`scopeFacts`/`deriveFromMnemonic`.
- Produces: `interface TokenInspection { text: string; facts: string[]; checks: string[] }`; `inspectToken(tokenB64: string, publicKeyString: string): TokenInspection`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/inspect.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { inspectToken, mintToken, scopeFacts, deriveFromMnemonic } from "../src/index.js";

const FIXED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const key = deriveFromMnemonic(FIXED);

describe("inspectToken", () => {
  it("extracts facts and checks from a minted token", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
    const r = inspectToken(t, key.publicKeyString);
    expect(r.facts).toContain('read("channels")');
    expect(r.checks.some(c => c.startsWith("check if time"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- inspect` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/inspect.ts`:
```ts
import { Biscuit, PublicKey } from "@biscuit-auth/biscuit-wasm";
import { publicKeyHex } from "./authorize.js";

export interface TokenInspection { text: string; facts: string[]; checks: string[]; }

export function inspectToken(tokenB64: string, publicKeyString: string): TokenInspection {
  const token = Biscuit.fromBase64(tokenB64, PublicKey.fromString(publicKeyHex(publicKeyString)));
  const text = token.toString();
  const facts: string[] = [];
  const checks: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (/^(read|write)\("[^"]+"\)$/.test(line)) facts.push(line);
    else if (line.startsWith("check if ")) checks.push(line);
  }
  return { text, facts, checks };
}
```
Append to `index.ts`: `export * from "./inspect.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- inspect && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): inspect a token's facts and checks"
```

---

### Task 9: Auth resolution (profile / flag / file / env)

**Files:**
- Create: `packages/biscuit/src/auth.ts`
- Modify: `packages/biscuit/src/index.ts`
- Test: `packages/biscuit/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `interface AuthResolveOptions { profile?: string; authToken?: string; authTokenFile?: string; env?: Record<string, string | undefined>; getProfileToken?: (name: string) => string | undefined; readFile?: (path: string) => string }`
  - `resolveToken(o: AuthResolveOptions): string | undefined` — precedence: explicit token → token file → profile → `FNN_AUTH_TOKEN` env.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveToken } from "../src/index.js";

describe("resolveToken", () => {
  it("prefers explicit token, then file, then profile, then env", () => {
    expect(resolveToken({ authToken: " tok ", env: { FNN_AUTH_TOKEN: "envtok" } })).toBe("tok");
    expect(resolveToken({ authTokenFile: "/f", readFile: () => " filetok\n" })).toBe("filetok");
    expect(resolveToken({ profile: "p", getProfileToken: (n) => (n === "p" ? "ptok" : undefined) })).toBe("ptok");
    expect(resolveToken({ env: { FNN_AUTH_TOKEN: "envtok" } })).toBe("envtok");
    expect(resolveToken({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- auth` → FAIL.

- [ ] **Step 3: Implement**

`packages/biscuit/src/auth.ts`:
```ts
export interface AuthResolveOptions {
  profile?: string;
  authToken?: string;
  authTokenFile?: string;
  env?: Record<string, string | undefined>;
  getProfileToken?: (name: string) => string | undefined;
  readFile?: (path: string) => string;
}

export function resolveToken(o: AuthResolveOptions): string | undefined {
  if (o.authToken) return o.authToken.trim();
  if (o.authTokenFile && o.readFile) return o.readFile(o.authTokenFile).trim();
  if (o.profile && o.getProfileToken) {
    const t = o.getProfileToken(o.profile);
    if (t) return t.trim();
  }
  const envTok = (o.env ?? {})["FNN_AUTH_TOKEN"];
  return envTok ? envTok.trim() : undefined;
}
```
Append to `index.ts`: `export * from "./auth.js";`

- [ ] **Step 4: Run to verify pass** — `npm test -- auth && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(biscuit): fnn-cli-compatible auth token resolution"
```

---

### Task 10: CLI subcommand dispatcher (move diagnose under it)

**Files:**
- Create: `apps/cli/src/dispatch.ts`
- Modify: `apps/cli/src/main.ts` (delegate to dispatch), `apps/cli/package.json` (add `@fiber-route-doctor/biscuit` dependency)
- Test: `apps/cli/test/dispatch.test.ts`

**Interfaces:**
- Consumes: existing `parseArgs` (Route Doctor CLI).
- Produces: `type Command = "diagnose" | "keys" | "token"`; `parseCommand(argv: string[]): { command: Command; rest: string[] }` (defaults to `diagnose` when the first arg is a flag or absent).

- [ ] **Step 1: Write the failing test**

`apps/cli/test/dispatch.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/dispatch.js";

describe("parseCommand", () => {
  it("routes a leading subcommand and strips it", () => {
    expect(parseCommand(["token", "generate", "--scope", "readonly"]))
      .toEqual({ command: "token", rest: ["generate", "--scope", "readonly"] });
    expect(parseCommand(["keys", "init"])).toEqual({ command: "keys", rest: ["init"] });
  });
  it("defaults to diagnose when the first arg is a flag or missing", () => {
    expect(parseCommand(["--url", "u"])).toEqual({ command: "diagnose", rest: ["--url", "u"] });
    expect(parseCommand([])).toEqual({ command: "diagnose", rest: [] });
  });
  it("throws on an unknown subcommand", () => {
    expect(() => parseCommand(["frobnicate"])).toThrow(/unknown command/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- dispatch` → FAIL.

- [ ] **Step 3: Implement**

`apps/cli/src/dispatch.ts`:
```ts
export type Command = "diagnose" | "keys" | "token";
const COMMANDS: Command[] = ["diagnose", "keys", "token"];

export function parseCommand(argv: string[]): { command: Command; rest: string[] } {
  const first = argv[0];
  if (first === undefined || first.startsWith("--")) return { command: "diagnose", rest: argv };
  if ((COMMANDS as string[]).includes(first)) return { command: first as Command, rest: argv.slice(1) };
  throw new Error(`unknown command '${first}' (expected: ${COMMANDS.join(", ")})`);
}
```

Add `"@fiber-route-doctor/biscuit": "0.1.0"` to `apps/cli/package.json` dependencies. In `apps/cli/src/main.ts`, wrap the existing flow: import `parseCommand`; at the top of `main()`, compute `const { command, rest } = parseCommand(process.argv.slice(2));` and branch — `diagnose` runs the existing logic on `rest` (replace `process.argv.slice(2)` with `rest` in the existing `parseArgs` call); `keys`/`token` call the handlers added in Task 11 (import lazily). Run `npm install` after editing package.json.

- [ ] **Step 4: Run to verify pass** — `npm install && npm test -- dispatch && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(cli): subcommand dispatcher; route diagnose through it"
```

---

### Task 11: `keys` and `token` CLI commands

**Files:**
- Create: `apps/cli/src/commands/keys.ts`, `apps/cli/src/commands/token.ts`
- Modify: `apps/cli/src/main.ts` (wire the two handlers into the dispatch branch)
- Test: `apps/cli/test/token-args.test.ts`

**Interfaces:**
- Consumes: `@fiber-route-doctor/biscuit` (`newMnemonic`, `deriveFromMnemonic`, `importPrivateKeyString`, `mintToken`, `scopeFacts`, `inspectToken`, `NodeFsKeystore`, `NodeFsTokenStore`, `encryptSecret`, `decryptSecret`, `type ScopeTemplate`), `parseArgs`-style flag parsing.
- Produces:
  - `parseExpiry(s: string): Date` — accepts `<n>d` / `<n>h` (e.g. `30d`).
  - `runKeys(rest: string[]): Promise<number>` and `runToken(rest: string[]): Promise<number>` (exit codes).

Only the pure `parseExpiry` is unit-tested; the command handlers are exercised by the live smoke (Task 12) and are thin wiring.

- [ ] **Step 1: Write the failing test**

`apps/cli/test/token-args.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseExpiry } from "../src/commands/token.js";

describe("parseExpiry", () => {
  it("parses days and hours into a future Date", () => {
    const now = Date.now();
    expect(parseExpiry("30d").getTime()).toBeGreaterThan(now + 29 * 864e5);
    expect(parseExpiry("2h").getTime()).toBeGreaterThan(now + 1.9 * 36e5);
  });
  it("throws on a bad format", () => {
    expect(() => parseExpiry("soon")).toThrow(/expiry/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- token-args` → FAIL.

- [ ] **Step 3: Implement**

`apps/cli/src/commands/token.ts` (includes `parseExpiry` + the `runToken` handler):
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  mintToken, scopeFacts, inspectToken, deriveFromMnemonic, importPrivateKeyString,
  NodeFsKeystore, NodeFsTokenStore, decryptSecret, type ScopeTemplate
} from "@fiber-route-doctor/biscuit";

const CFG = join(homedir(), ".config", "fiber-route-doctor");
const KS = join(CFG, "keystore.json");
const PROFILES = join(CFG, "profiles.json");

export function parseExpiry(s: string): Date {
  const m = s.trim().match(/^(\d+)([dh])$/);
  if (!m) throw new Error("expiry must look like '30d' or '12h'");
  const n = Number(m[1]);
  const ms = m[2] === "d" ? n * 864e5 : n * 36e5;
  return new Date(Date.now() + ms);
}

function flags(rest: string[]): Map<string, string> {
  const f = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { const v = rest[i + 1]; if (v && !v.startsWith("--")) { f.set(rest[i].slice(2), v); i++; } else f.set(rest[i].slice(2), "true"); }
  }
  return f;
}

function unlockKey(passphrase: string): { privateKeyString: string; publicKeyString: string } {
  const ks = new NodeFsKeystore(KS).load();
  if (!ks) throw new Error(`no keystore at ${KS} — run 'keys init' or 'keys import' first`);
  const secret = decryptSecret(ks, passphrase);
  return ks.kind === "mnemonic" ? deriveFromMnemonic(secret) : importPrivateKeyString(secret);
}

export async function runToken(rest: string[]): Promise<number> {
  const sub = rest[0];
  const f = flags(rest.slice(1));
  const store = new NodeFsTokenStore(PROFILES);
  if (sub === "generate") {
    const pass = f.get("passphrase") ?? process.env.FRD_PASSPHRASE ?? "";
    const key = unlockKey(pass);
    const scope = (f.get("scope") ?? "readonly") as ScopeTemplate;
    const expiry = parseExpiry(f.get("expiry") ?? "30d");
    const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts(scope), expiry });
    const name = f.get("profile");
    if (name) store.put({ name, url: f.get("url") ?? "", token, scope, expiresAt: expiry.toISOString() });
    console.log(token);
    return 0;
  }
  if (sub === "list") {
    for (const p of store.list()) console.log(`${p.name}\t${p.url}\t${p.scope}\texpires ${p.expiresAt}\t${p.token.slice(0, 8)}…`);
    return 0;
  }
  if (sub === "show") { const p = store.get(rest[1] ?? ""); if (!p) { console.error("no such profile"); return 1; } console.log(p.token); return 0; }
  if (sub === "inspect") {
    const arg = rest[1] ?? "";
    const tokenB64 = arg.startsWith("@") ? (store.get(arg.slice(1))?.token ?? "") : (arg.startsWith("/") ? readFileSync(arg, "utf8").trim() : arg);
    const pub = f.get("pubkey");
    if (!pub) { console.error("--pubkey <ed25519/…> required to inspect"); return 1; }
    const r = inspectToken(tokenB64, pub);
    console.log(JSON.stringify({ facts: r.facts, checks: r.checks }, null, 2));
    return 0;
  }
  console.error("usage: token generate|list|show|inspect");
  return 2;
}
```

`apps/cli/src/commands/keys.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { newMnemonic, deriveFromMnemonic, importPrivateKeyString, NodeFsKeystore, encryptSecret } from "@fiber-route-doctor/biscuit";

const CFG = join(homedir(), ".config", "fiber-route-doctor");
const KS = join(CFG, "keystore.json");

function flags(rest: string[]): Map<string, string> {
  const f = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { const v = rest[i + 1]; if (v && !v.startsWith("--")) { f.set(rest[i].slice(2), v); i++; } else f.set(rest[i].slice(2), "true"); }
  }
  return f;
}

export async function runKeys(rest: string[]): Promise<number> {
  const sub = rest[0];
  const f = flags(rest.slice(1));
  const backend = new NodeFsKeystore(KS);
  const pass = f.get("passphrase") ?? process.env.FRD_PASSPHRASE ?? "";
  if (!pass) { console.error("--passphrase (or FRD_PASSPHRASE) required"); return 1; }

  if (sub === "init") {
    const mnemonic = newMnemonic();
    const key = deriveFromMnemonic(mnemonic);
    backend.save(encryptSecret(mnemonic, pass, "mnemonic", key.publicKeyString));
    console.log("BACK UP THIS RECOVERY PHRASE (shown once):\n" + mnemonic);
    console.log("\nPaste this into your node config rpc.biscuit_public_key:\n" + key.publicKeyString);
    return 0;
  }
  if (sub === "import") {
    if (f.has("mnemonic")) {
      const mnemonic = f.get("mnemonic")!;
      const key = deriveFromMnemonic(mnemonic);
      backend.save(encryptSecret(mnemonic, pass, "mnemonic", key.publicKeyString));
      console.log(key.publicKeyString); return 0;
    }
    const hexArg = f.get("hex");
    if (!hexArg) { console.error("keys import --hex <path|ed25519-private/…> | --mnemonic '<words>'"); return 1; }
    const raw = hexArg.startsWith("/") ? readFileSync(hexArg, "utf8").trim() : hexArg;
    const key = importPrivateKeyString(raw);
    backend.save(encryptSecret(raw, pass, "privatekey", key.publicKeyString));
    console.log(key.publicKeyString); return 0;
  }
  if (sub === "export-public") {
    const ks = backend.load(); if (!ks) { console.error("no keystore"); return 1; }
    console.log(ks.publicKeyString); return 0;
  }
  console.error("usage: keys init|import|export-public");
  return 2;
}
```

Wire into `apps/cli/src/main.ts`: in the dispatch branch, `if (command === "keys") process.exit(await runKeys(rest)); if (command === "token") process.exit(await runToken(rest));` (import both handlers).

- [ ] **Step 4: Run to verify pass** — `npm test -- token-args && npm test && npm run typecheck` → PASS (full suite green).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(cli): keys and token subcommands backed by the biscuit SDK"
```

---

### Task 12: Gated live validation + README

**Files:**
- Create: `scripts/biscuit-live-smoke.mjs`, `packages/biscuit/README.md`
- Modify: root `package.json` (add `smoke:biscuit` script)

**Interfaces:**
- Consumes: `@fiber-route-doctor/biscuit`, `@fiber-route-doctor/core` (`GraphClient`).
- Produces: a skip-unless-`FRD_BISCUIT_KEY` live test that mints from a real key and calls `graph_channels`.

- [ ] **Step 1: Write `scripts/biscuit-live-smoke.mjs`**

```js
// Mint a readonly token from a real biscuit private key and hit a live Fiber node.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/biscuit-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { GraphClient } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP biscuit-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const client = new GraphClient({ url, biscuit: token });
const channels = await client.graphChannels();
console.log(`OK: minted readonly token, authenticated, graph_channels returned ${channels.length} channels`);
```

- [ ] **Step 2: Add the script** — in root `package.json` add `"smoke:biscuit": "node --import tsx scripts/biscuit-live-smoke.mjs"`.

- [ ] **Step 3: Run skip-mode** — `npm run smoke:biscuit` → prints SKIP, exit 0.

- [ ] **Step 4: Write `packages/biscuit/README.md`**

```markdown
# @fiber-route-doctor/biscuit

Mint, recall, and inspect Fiber biscuit RPC tokens with human-friendly seed-phrase key custody. Fills the gap Fiber leaves: `fnn` mandates biscuit auth on public nodes but ships no minting or key tooling.

## Keys (operator)
```
fiber-route-doctor keys init --passphrase '<pass>'        # new mnemonic → prints public key for node config
fiber-route-doctor keys import --hex ~/.fiber-dt/biscuit_private_key --passphrase '<pass>'
fiber-route-doctor keys export-public
```

## Tokens
```
fiber-route-doctor token generate --scope readonly --expiry 30d --profile mynode --url http://127.0.0.1:8231 --passphrase '<pass>'
fiber-route-doctor token list
fiber-route-doctor token show mynode
fiber-route-doctor token inspect @mynode --pubkey ed25519/<hex>
```
Scopes: `readonly` (all reads — enough for Route Doctor), `invoicing`, `full`.

## Security
Keys/seeds are encrypted at rest (scrypt + XChaCha20-Poly1305) under your passphrase; nothing is stored in plaintext and nothing leaves your machine. Keystore + profiles live in `~/.config/fiber-route-doctor/` (mode 600).

MIT.
```

- [ ] **Step 5: Full verify + commit**

Run: `npm test && npm run typecheck` → all green.
```bash
git add -A && git commit -m "feat(biscuit): gated live validation smoke + README"
```

---

## Post-plan: mandatory security review

After Task 12, before merge, dispatch a **security-reviewer** pass over `packages/biscuit/**` + the CLI command handlers, checking: no plaintext key/seed/mnemonic persisted; no key/seed/full-token in logs; 600 perms on keystore + profiles; wrong-passphrase yields a clean AEAD failure with no partial-plaintext leak; scrypt cost is adequate; the mnemonic is displayed only once and never written unencrypted. Fix any Critical/High before merge.

## Notes for the implementer
- **All external APIs in this plan were verified by a working spike** — use them exactly (esp. `PublicKey.fromString` needs the `ed25519/` prefix stripped; authorize uses `buildAuthenticated(token)`; noble imports need the `.js` subpath).
- TDD every task; run `npm run typecheck` AND `npm test` before each commit.
- Never weaken a crypto test to make it pass — if the compatibility gate (Task 4) fails, stop and report.
- Tier B (web GUI, client-side keystore) is a separate later plan; keep this SDK UI-free and backend-agnostic so the browser backend can be added without touching the core.
