# Tier B In-Browser Keystore GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring biscuit key custody + token minting into the browser (IndexedDB-persisted, encrypted at rest) so the web demo mints its own tokens and feeds them to the Health/Liquidity/Map panels — no CLI.

**Architecture:** New browser-only IndexedDB backends in `packages/biscuit/src/browser/`, exposed via a `./browser` package subpath so the web app can never transitively import `node:fs`. A pure `vault` orchestrator wraps the EXISTING audited crypto primitives (`newMnemonic`/`deriveFromMnemonic`/`importPrivateKeyString`/`encryptSecret`/`decryptSecret`/`mintToken`/`scopeFacts`/`inspectToken`) — no new cryptography. React `WalletPanel` + a wallet context drive the UI and hand a selected token to each panel.

**Tech Stack:** TypeScript ESM strict, Vitest (node env — `fake-indexeddb` provides `indexedDB` without jsdom), React 18, IndexedDB. New dev-dep: `fake-indexeddb`.

**Spec:** `docs/superpowers/specs/2026-07-03-tier-b-keystore-gui-design.md`

## Global Constraints

- Node >= 22; tests from repo root: `npx vitest run <files>`, `npm run typecheck`.
- Repo style: compact TS, semicolons, double quotes; tests in `<workspace>/test/*.test.ts`.
- Custody: passphrase-per-operation. NO session unlock, NO decrypted secret retained on any object between calls. Passphrase-derived `Uint8Array` intermediates zeroized in `finally`. (JS strings can't be zeroized — documented limitation, never persisted/logged.)
- Reuse only: never reimplement crypto. Import the existing pure functions from `@fiber-route-doctor/biscuit` root (they are browser-safe: keys.ts/keystore.ts/mint.ts/scopes.ts/inspect.ts use only `@noble`/`@scure`/`biscuit-wasm`).
- Browser modules MUST NOT import `node:*`. The `./browser` subpath is the enforcement boundary.
- Encrypted at rest reuses the existing `KeystoreFile` (scrypt N=2¹⁵ + XChaCha20-Poly1305). IndexedDB holds only ciphertext + token profiles.
- The mnemonic is shown exactly at create and explicit export, each behind a confirm, never auto-persisted in cleartext, never sent anywhere.
- Every task: run the task's tests + `npm run typecheck` before committing.

## Reused signatures (from `@fiber-route-doctor/biscuit`, verified)

```ts
newMnemonic(): string                                   // 24-word BIP39
deriveFromMnemonic(m: string): BiscuitKey               // throws "invalid mnemonic"
importPrivateKeyString(raw: string): BiscuitKey         // "ed25519-private/<64hex>" or bare 64-hex
interface BiscuitKey { privateKeyString: string; publicKeyString: string }
type KeystoreKind = "mnemonic" | "privatekey"
interface KeystoreFile { v: 1; kind: KeystoreKind; publicKeyString: string; kdf: "scrypt"; N: number; r: number; p: number; salt: string; nonce: string; ciphertext: string }
encryptSecret(secret, passphrase, kind, publicKeyString): KeystoreFile
decryptSecret(ks: KeystoreFile, passphrase): string     // throws on wrong passphrase (AEAD tag fail)
mintToken({ privateKeyString, facts, expiry }): string
scopeFacts(scope: "readonly"|"invoicing"|"full", extra?): string[]
inspectToken(tokenB64, publicKeyString): { text; facts: string[]; checks: string[] }
```

---

### Task 1: `./browser` subpath + IndexedDB wrapper

**Files:**
- Modify: `packages/biscuit/package.json` (add `./browser` export; add `fake-indexeddb` devDependency)
- Create: `packages/biscuit/src/browser/idb.ts`
- Create: `packages/biscuit/src/browser/index.ts` (barrel — re-exports browser modules as they land)
- Test: `packages/biscuit/test/browser/idb.test.ts`

**Interfaces:**
- Produces: `openStore(): Promise<IDBDatabase>` (DB `fiber-route-doctor` v1, stores `keystore` + `profiles`); `idbGet<T>(store: string, key: string): Promise<T | undefined>`; `idbPut(store: string, key: string, value: unknown): Promise<void>`; `idbGetAll<T>(store: string): Promise<T[]>`; `idbDelete(store: string, key: string): Promise<void>`.

- [ ] **Step 1: Add dependency + export**

`packages/biscuit/package.json`: add to `exports` and add the dev-dep:
```json
"exports": { ".": "./src/index.ts", "./browser": "./src/browser/index.ts" },
"devDependencies": { "fake-indexeddb": "^6.0.0" }
```
Run `npm install` (repo root). Expected exit 0.

- [ ] **Step 2: Write the failing test**

`packages/biscuit/test/browser/idb.test.ts`:

```typescript
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { idbGet, idbPut, idbGetAll, idbDelete } from "../../src/browser/idb.js";

describe("idb wrapper", () => {
  it("round-trips a value in the keystore store", async () => {
    await idbPut("keystore", "default", { hello: "world" });
    expect(await idbGet<{ hello: string }>("keystore", "default")).toEqual({ hello: "world" });
  });
  it("returns undefined for a missing key", async () => {
    expect(await idbGet("profiles", "nope")).toBeUndefined();
  });
  it("lists all values in a store and deletes by key", async () => {
    await idbPut("profiles", "a", { name: "a" });
    await idbPut("profiles", "b", { name: "b" });
    const all = await idbGetAll<{ name: string }>("profiles");
    expect(all.map((v) => v.name).sort()).toEqual(["a", "b"]);
    await idbDelete("profiles", "a");
    expect(await idbGet("profiles", "a")).toBeUndefined();
  });
  it("keeps the two stores isolated", async () => {
    await idbPut("keystore", "default", { k: 1 });
    await idbPut("profiles", "default", { p: 2 });
    expect(await idbGet("keystore", "default")).toEqual({ k: 1 });
    expect(await idbGet("profiles", "default")).toEqual({ p: 2 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/biscuit/test/browser/idb.test.ts`
Expected: FAIL — no `idb.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/biscuit/src/browser/idb.ts`:

```typescript
const DB_NAME = "fiber-route-doctor";
const DB_VERSION = 1;
const STORES = ["keystore", "profiles"] as const;

export function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openStore().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  }));
}

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return tx<T | undefined>(store, "readonly", (s) => s.get(key));
}
export function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return tx<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)).then(() => undefined);
}
export function idbGetAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll());
}
export function idbDelete(store: string, key: string): Promise<void> {
  return tx<undefined>(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}
```

`packages/biscuit/src/browser/index.ts`:

```typescript
export * from "./idb.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/biscuit/test/browser/idb.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/biscuit/package.json package-lock.json packages/biscuit/src/browser/idb.ts packages/biscuit/src/browser/index.ts packages/biscuit/test/browser/idb.test.ts
git commit -m "feat(biscuit): browser subpath export + promise-wrapped IndexedDB"
```

---

### Task 2: IndexedDB keystore + profile stores

**Files:**
- Create: `packages/biscuit/src/browser/keystore-idb.ts`
- Create: `packages/biscuit/src/browser/profile-idb.ts`
- Modify: `packages/biscuit/src/browser/index.ts` (add exports)
- Test: `packages/biscuit/test/browser/stores.test.ts`

**Interfaces:**
- Consumes: `idbGet`/`idbPut`/`idbGetAll`/`idbDelete` (Task 1); `KeystoreFile` from `@fiber-route-doctor/biscuit`.
- Produces:
  - `interface BrowserKeystore { load(): Promise<KeystoreFile | undefined>; save(ks: KeystoreFile): Promise<void>; clear(): Promise<void>; }`; `class IdbKeystore implements BrowserKeystore` (record key `"default"`).
  - `interface BrowserTokenProfile { name: string; url: string; token: string; scope: string; expiresAt: string; publicKeyString: string; }`
  - `interface BrowserProfileStore { list(): Promise<BrowserTokenProfile[]>; get(name: string): Promise<BrowserTokenProfile | undefined>; put(p: BrowserTokenProfile): Promise<void>; remove(name: string): Promise<void>; }`; `class IdbProfileStore implements BrowserProfileStore`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/browser/stores.test.ts`:

```typescript
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { IdbKeystore, IdbProfileStore, type BrowserTokenProfile } from "../../src/browser/index.js";
import { encryptSecret } from "../../src/index.js";

const KS = encryptSecret("test secret", "pw", "mnemonic", "ed25519/aa");
const profile = (name: string): BrowserTokenProfile => ({ name, url: "http://n", token: "tok", scope: "readonly", expiresAt: "2026-08-01T00:00:00.000Z", publicKeyString: "ed25519/aa" });

describe("IdbKeystore", () => {
  it("save→load→clear round-trips a keystore record", async () => {
    const store = new IdbKeystore();
    expect(await store.load()).toBeUndefined();
    await store.save(KS);
    expect(await store.load()).toEqual(KS);
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });
});

describe("IdbProfileStore", () => {
  it("put/get/list/remove", async () => {
    const store = new IdbProfileStore();
    await store.put(profile("dt"));
    await store.put(profile("prod"));
    expect((await store.list()).map((p) => p.name).sort()).toEqual(["dt", "prod"]);
    expect((await store.get("dt"))?.url).toBe("http://n");
    await store.remove("dt");
    expect(await store.get("dt")).toBeUndefined();
  });
  it("put overwrites a profile of the same name", async () => {
    const store = new IdbProfileStore();
    await store.put(profile("dt"));
    await store.put({ ...profile("dt"), url: "http://changed" });
    expect((await store.list()).filter((p) => p.name === "dt")).toHaveLength(1);
    expect((await store.get("dt"))?.url).toBe("http://changed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/biscuit/test/browser/stores.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

`packages/biscuit/src/browser/keystore-idb.ts`:

```typescript
import type { KeystoreFile } from "../keystore.js";
import { idbDelete, idbGet, idbPut } from "./idb.js";

const KEY = "default";

export interface BrowserKeystore {
  load(): Promise<KeystoreFile | undefined>;
  save(ks: KeystoreFile): Promise<void>;
  clear(): Promise<void>;
}

export class IdbKeystore implements BrowserKeystore {
  load(): Promise<KeystoreFile | undefined> { return idbGet<KeystoreFile>("keystore", KEY); }
  save(ks: KeystoreFile): Promise<void> { return idbPut("keystore", KEY, ks); }
  clear(): Promise<void> { return idbDelete("keystore", KEY); }
}
```

`packages/biscuit/src/browser/profile-idb.ts`:

```typescript
import { idbDelete, idbGet, idbGetAll, idbPut } from "./idb.js";

export interface BrowserTokenProfile {
  name: string;
  url: string;
  token: string;
  scope: string;
  expiresAt: string;
  publicKeyString: string;
}

export interface BrowserProfileStore {
  list(): Promise<BrowserTokenProfile[]>;
  get(name: string): Promise<BrowserTokenProfile | undefined>;
  put(p: BrowserTokenProfile): Promise<void>;
  remove(name: string): Promise<void>;
}

export class IdbProfileStore implements BrowserProfileStore {
  list(): Promise<BrowserTokenProfile[]> { return idbGetAll<BrowserTokenProfile>("profiles"); }
  get(name: string): Promise<BrowserTokenProfile | undefined> { return idbGet<BrowserTokenProfile>("profiles", name); }
  put(p: BrowserTokenProfile): Promise<void> { return idbPut("profiles", p.name, p); }
  remove(name: string): Promise<void> { return idbDelete("profiles", name); }
}
```

`packages/biscuit/src/browser/index.ts` — append:

```typescript
export * from "./keystore-idb.js";
export * from "./profile-idb.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/biscuit/test/browser/stores.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/biscuit/src/browser/keystore-idb.ts packages/biscuit/src/browser/profile-idb.ts packages/biscuit/src/browser/index.ts packages/biscuit/test/browser/stores.test.ts
git commit -m "feat(biscuit): IndexedDB keystore and token-profile stores"
```

---

### Task 3: Vault orchestrator (the custody crux)

**Files:**
- Create: `packages/biscuit/src/browser/vault.ts`
- Modify: `packages/biscuit/src/browser/index.ts` (add export)
- Test: `packages/biscuit/test/browser/vault.test.ts`

**Interfaces:**
- Consumes: `BrowserKeystore`, `BrowserProfileStore`, `BrowserTokenProfile` (Task 2); `newMnemonic`/`deriveFromMnemonic`/`importPrivateKeyString`/`encryptSecret`/`decryptSecret`/`mintToken`/`scopeFacts` + `KeystoreKind` from `@fiber-route-doctor/biscuit`.
- Produces (all pure functions taking stores as params — no module state):
  - `hasKeystore(ks: BrowserKeystore): Promise<boolean>`
  - `createWallet(ks: BrowserKeystore, passphrase: string): Promise<{ mnemonic: string; publicKeyString: string }>`
  - `importWallet(ks: BrowserKeystore, secret: string, kind: KeystoreKind, passphrase: string): Promise<{ publicKeyString: string }>`
  - `interface MintRequest { passphrase: string; scope: "readonly"|"invoicing"|"full"; expiryDays: number; url: string; profileName: string; }`
  - `mint(ks: BrowserKeystore, req: MintRequest, profiles: BrowserProfileStore): Promise<BrowserTokenProfile>`
  - `exportMnemonic(ks: BrowserKeystore, passphrase: string): Promise<string>`
- Error contract: wrong passphrase → `Error("incorrect passphrase")`; no keystore → `Error("no wallet — create or import one first")`; export on a privatekey keystore → `Error("this wallet has no seed phrase to export")`.

- [ ] **Step 1: Write the failing test**

`packages/biscuit/test/browser/vault.test.ts`:

```typescript
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { IdbKeystore, IdbProfileStore, createWallet, importWallet, mint, exportMnemonic, hasKeystore } from "../../src/browser/index.js";
import { inspectToken, newMnemonic } from "../../src/index.js";

describe("vault custody", () => {
  it("createWallet persists ciphertext (never cleartext) and returns a usable mnemonic", async () => {
    const ks = new IdbKeystore();
    expect(await hasKeystore(ks)).toBe(false);
    const { mnemonic, publicKeyString } = await createWallet(ks, "pw");
    expect(mnemonic.split(" ")).toHaveLength(24);
    expect(publicKeyString).toMatch(/^ed25519\//);
    expect(await hasKeystore(ks)).toBe(true);
    const stored = JSON.stringify(await ks.load());
    expect(stored).not.toContain(mnemonic);            // ciphertext only
    expect(stored).not.toContain(mnemonic.split(" ")[0]);
  });
  it("importWallet round-trips a mnemonic and a hex key", async () => {
    const m = newMnemonic();
    const ks1 = new IdbKeystore();
    const r1 = await importWallet(ks1, m, "mnemonic", "pw");
    expect(r1.publicKeyString).toMatch(/^ed25519\//);
    const ks2 = new IdbKeystore();
    await ks2.clear();
    const r2 = await importWallet(ks2, "ed25519-private/" + "ab".repeat(32), "privatekey", "pw");
    expect(r2.publicKeyString).toMatch(/^ed25519\//);
  });
  it("mint produces a node-shaped token that inspects to the requested scope", async () => {
    const ks = new IdbKeystore();
    const { publicKeyString } = await createWallet(ks, "pw");
    const profiles = new IdbProfileStore();
    const p = await mint(ks, { passphrase: "pw", scope: "readonly", expiryDays: 30, url: "http://n:8231", profileName: "dt" }, profiles);
    expect(p).toMatchObject({ name: "dt", url: "http://n:8231", scope: "readonly", publicKeyString });
    expect(await profiles.get("dt")).toBeTruthy();
    const facts = inspectToken(p.token, publicKeyString).facts;
    expect(facts).toContain('read("channels")');       // readonly template includes channels
  });
  it("exportMnemonic returns the original words behind the passphrase", async () => {
    const ks = new IdbKeystore();
    const { mnemonic } = await createWallet(ks, "pw");
    expect(await exportMnemonic(ks, "pw")).toBe(mnemonic);
  });
  it("wrong passphrase is reported as 'incorrect passphrase'", async () => {
    const ks = new IdbKeystore();
    await createWallet(ks, "right");
    await expect(exportMnemonic(ks, "wrong")).rejects.toThrow(/incorrect passphrase/);
    const profiles = new IdbProfileStore();
    await expect(mint(ks, { passphrase: "wrong", scope: "readonly", expiryDays: 30, url: "u", profileName: "x" }, profiles)).rejects.toThrow(/incorrect passphrase/);
  });
  it("operations on an empty keystore error with guidance", async () => {
    const ks = new IdbKeystore();
    await ks.clear();
    await expect(exportMnemonic(ks, "pw")).rejects.toThrow(/no wallet/);
  });
  it("export on a privatekey wallet is refused", async () => {
    const ks = new IdbKeystore();
    await ks.clear();
    await importWallet(ks, "ed25519-private/" + "cd".repeat(32), "privatekey", "pw");
    await expect(exportMnemonic(ks, "pw")).rejects.toThrow(/no seed phrase/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/biscuit/test/browser/vault.test.ts`
Expected: FAIL — `vault` exports missing.

- [ ] **Step 3: Write minimal implementation**

`packages/biscuit/src/browser/vault.ts`:

```typescript
import {
  deriveFromMnemonic, encryptSecret, decryptSecret, importPrivateKeyString,
  mintToken, newMnemonic, scopeFacts, type KeystoreKind
} from "../index.js";
import type { BrowserKeystore } from "./keystore-idb.js";
import type { BrowserProfileStore, BrowserTokenProfile } from "./profile-idb.js";

const MS_PER_DAY = 86_400_000;

export function hasKeystore(ks: BrowserKeystore): Promise<boolean> {
  return ks.load().then((k) => k !== undefined);
}

/** Decrypt the stored secret for the duration of ONE operation. Wrong passphrase → "incorrect passphrase". */
async function withSecret<T>(ks: BrowserKeystore, passphrase: string, run: (secret: string, kind: KeystoreKind) => T): Promise<T> {
  const file = await ks.load();
  if (!file) throw new Error("no wallet — create or import one first");
  let secret: string;
  try {
    secret = decryptSecret(file, passphrase);
  } catch {
    throw new Error("incorrect passphrase");
  }
  return run(secret, file.kind);
}

export async function createWallet(ks: BrowserKeystore, passphrase: string): Promise<{ mnemonic: string; publicKeyString: string }> {
  const mnemonic = newMnemonic();
  const { publicKeyString } = deriveFromMnemonic(mnemonic);
  await ks.save(encryptSecret(mnemonic, passphrase, "mnemonic", publicKeyString));
  return { mnemonic, publicKeyString };
}

export async function importWallet(ks: BrowserKeystore, secret: string, kind: KeystoreKind, passphrase: string): Promise<{ publicKeyString: string }> {
  const key = kind === "mnemonic" ? deriveFromMnemonic(secret.trim()) : importPrivateKeyString(secret);
  const stored = kind === "mnemonic" ? secret.trim() : key.privateKeyString;
  await ks.save(encryptSecret(stored, passphrase, kind, key.publicKeyString));
  return { publicKeyString: key.publicKeyString };
}

export interface MintRequest {
  passphrase: string;
  scope: "readonly" | "invoicing" | "full";
  expiryDays: number;
  url: string;
  profileName: string;
}

export async function mint(ks: BrowserKeystore, req: MintRequest, profiles: BrowserProfileStore): Promise<BrowserTokenProfile> {
  return withSecret(ks, req.passphrase, (secret, kind) => {
    const key = kind === "mnemonic" ? deriveFromMnemonic(secret) : importPrivateKeyString(secret);
    const expiry = new Date(Date.now() + req.expiryDays * MS_PER_DAY);
    const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts(req.scope), expiry });
    const profile: BrowserTokenProfile = {
      name: req.profileName, url: req.url, token, scope: req.scope,
      expiresAt: expiry.toISOString(), publicKeyString: key.publicKeyString
    };
    return profiles.put(profile).then(() => profile);
  });
}

export async function exportMnemonic(ks: BrowserKeystore, passphrase: string): Promise<string> {
  return withSecret(ks, passphrase, (secret, kind) => {
    if (kind !== "mnemonic") throw new Error("this wallet has no seed phrase to export");
    return secret;
  });
}
```

`packages/biscuit/src/browser/index.ts` — append `export * from "./vault.js";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/biscuit/test/browser/vault.test.ts && npm run typecheck`
Expected: PASS.

Note: `mint`/`exportMnemonic` return promises whose bodies run synchronously after decrypt; `withSecret`'s `run` may return a value or a promise (mint returns `profiles.put(...).then(...)`), and `withSecret<T>` resolves either — the `Promise<T>` return covers both because `T` unifies to the awaited type at each call site.

- [ ] **Step 5: Commit**

```bash
git add packages/biscuit/src/browser/vault.ts packages/biscuit/src/browser/index.ts packages/biscuit/test/browser/vault.test.ts
git commit -m "feat(biscuit): passphrase-per-operation vault orchestrator"
```

---

### Task 4: Wallet React context

**Files:**
- Create: `apps/web/src/wallet-context.tsx`
- Test: `apps/web/test/wallet-context.test.ts`

**Interfaces:**
- Consumes: `IdbProfileStore`, `BrowserTokenProfile` from `@fiber-route-doctor/biscuit/browser`.
- Produces:
  - a pure helper `selectActive(profiles: BrowserTokenProfile[], name: string | null): BrowserTokenProfile | null` (unit-tested).
  - `WalletProvider` React component + `useWallet(): { profiles: BrowserTokenProfile[]; activeProfileName: string | null; activeProfile: BrowserTokenProfile | null; setActiveProfile(name: string | null): void; refreshProfiles(): Promise<void>; }`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/wallet-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectActive } from "../src/wallet-context.js";
import type { BrowserTokenProfile } from "@fiber-route-doctor/biscuit/browser";

const p = (name: string): BrowserTokenProfile => ({ name, url: "u", token: "t", scope: "readonly", expiresAt: "", publicKeyString: "ed25519/aa" });

describe("selectActive", () => {
  it("returns the named profile", () => {
    expect(selectActive([p("a"), p("b")], "b")?.name).toBe("b");
  });
  it("returns null for null name or a missing name", () => {
    expect(selectActive([p("a")], null)).toBeNull();
    expect(selectActive([p("a")], "z")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/test/wallet-context.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/wallet-context.tsx`:

```tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { IdbProfileStore, type BrowserTokenProfile } from "@fiber-route-doctor/biscuit/browser";

export function selectActive(profiles: BrowserTokenProfile[], name: string | null): BrowserTokenProfile | null {
  if (name === null) return null;
  return profiles.find((p) => p.name === name) ?? null;
}

interface WalletContextValue {
  profiles: BrowserTokenProfile[];
  activeProfileName: string | null;
  activeProfile: BrowserTokenProfile | null;
  setActiveProfile: (name: string | null) => void;
  refreshProfiles: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const store = new IdbProfileStore();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<BrowserTokenProfile[]>([]);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await store.list());
  }, []);

  useEffect(() => { void refreshProfiles(); }, [refreshProfiles]);

  const value = useMemo<WalletContextValue>(() => ({
    profiles,
    activeProfileName,
    activeProfile: selectActive(profiles, activeProfileName),
    setActiveProfile: setActiveProfileName,
    refreshProfiles
  }), [profiles, activeProfileName, refreshProfiles]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/test/wallet-context.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/wallet-context.tsx apps/web/test/wallet-context.test.ts
git commit -m "feat(web): wallet context with active-profile selection"
```

---

### Task 5: WalletPanel component + App wiring

**Files:**
- Create: `apps/web/src/WalletPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: manual (React component; vault + context logic already tested) — gate is `npm run typecheck` + existing web tests green.

**Interfaces:**
- Consumes: `IdbKeystore`, `hasKeystore`/`createWallet`/`importWallet`/`mint`/`exportMnemonic` from `@fiber-route-doctor/biscuit/browser`; `inspectToken` from `@fiber-route-doctor/biscuit` (root is fine for the web app — inspect.ts is browser-safe); `useWallet` (Task 4).
- Produces: `<WalletPanel />`; `App` wraps everything in `<WalletProvider>` and renders `<WalletPanel />` first.

- [ ] **Step 1: Write the component**

`apps/web/src/WalletPanel.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import {
  IdbKeystore, IdbProfileStore, hasKeystore, createWallet, importWallet, mint, exportMnemonic,
  type BrowserTokenProfile
} from "@fiber-route-doctor/biscuit/browser";
import { inspectToken } from "@fiber-route-doctor/biscuit";
import { useWallet } from "./wallet-context.js";

const ks = new IdbKeystore();
const profileStore = new IdbProfileStore();

export function WalletPanel() {
  const { profiles, refreshProfiles, setActiveProfile } = useWallet();
  const [has, setHas] = useState<boolean | null>(null);
  const [pass, setPass] = useState("");
  const [reveal, setReveal] = useState<string | null>(null);   // one-time mnemonic display
  const [importText, setImportText] = useState("");
  const [importKind, setImportKind] = useState<"mnemonic" | "privatekey">("mnemonic");
  const [scope, setScope] = useState<"readonly" | "invoicing" | "full">("readonly");
  const [expiryDays, setExpiryDays] = useState("30");
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [profileName, setProfileName] = useState("dt");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void hasKeystore(ks).then(setHas); }, []);

  async function guard(run: () => Promise<void>) {
    setBusy(true); setError("");
    try { await run(); } catch (e) { setError(String(e)); } finally { setBusy(false); setPass(""); }
  }

  const doCreate = () => guard(async () => {
    const { mnemonic } = await createWallet(ks, pass);
    setReveal(mnemonic); setHas(true);
  });
  const doImport = () => guard(async () => {
    await importWallet(ks, importText, importKind, pass);
    setImportText(""); setHas(true);
  });
  const doMint = () => guard(async () => {
    await mint(ks, { passphrase: pass, scope, expiryDays: Number(expiryDays), url, profileName }, profileStore);
    await refreshProfiles();
  });
  const doExport = () => guard(async () => { setReveal(await exportMnemonic(ks, pass)); });
  const doRemove = () => guard(async () => {
    if (!confirm("Remove this wallet? The encrypted key is deleted from this browser.")) return;
    await ks.clear(); setHas(false);
  });
  const doInspect = (p: BrowserTokenProfile) => {
    try { alert(inspectToken(p.token, p.publicKeyString).facts.join("\n") || "(no facts)"); }
    catch (e) { alert(String(e)); }
  };
  const doDelete = (name: string) => guard(async () => { await profileStore.remove(name); await refreshProfiles(); });

  return (
    <section style={{ marginBottom: "2rem", border: "1px solid #444", padding: "1rem" }}>
      <h2>Wallet</h2>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {reveal && (
        <div style={{ border: "1px solid #f1c40f", padding: "0.6rem", margin: "0.6rem 0" }}>
          <strong>Back up these words — shown once:</strong>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{reveal}</pre>
          <button onClick={() => setReveal(null)}>I've saved it</button>
        </div>
      )}
      {has === false && !reveal && (
        <div>
          <label>passphrase: <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <div style={{ margin: "0.5rem 0" }}>
            <button onClick={doCreate} disabled={busy || !pass}>Create wallet</button>
          </div>
          <div style={{ margin: "0.5rem 0" }}>
            <select value={importKind} onChange={(e) => setImportKind(e.target.value as "mnemonic" | "privatekey")}>
              <option value="mnemonic">mnemonic</option>
              <option value="privatekey">hex key</option>
            </select>
            <input value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="24 words or ed25519-private/…" style={{ width: 360 }} />
            <button onClick={doImport} disabled={busy || !pass || !importText}>Import</button>
          </div>
        </div>
      )}
      {has === true && (
        <div>
          <h3>Mint token</h3>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="readonly">readonly</option><option value="invoicing">invoicing</option><option value="full">full</option>
            </select>
            <label>expiry days <input value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} style={{ width: 50 }} /></label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="node url" style={{ width: 220 }} />
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="profile name" style={{ width: 100 }} />
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="passphrase" />
            <button onClick={doMint} disabled={busy || !pass || !profileName}>Mint</button>
          </div>
          <h3 style={{ marginTop: "1rem" }}>Profiles</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {profiles.map((p) => (
              <li key={p.name} style={{ margin: "0.3rem 0" }}>
                <button onClick={() => setActiveProfile(p.name)}>use</button>{" "}
                <strong>{p.name}</strong> — {p.scope} · {p.url} · exp {p.expiresAt.slice(0, 10)} · {p.token.slice(0, 8)}…{" "}
                <button onClick={() => doInspect(p)}>inspect</button>{" "}
                <button onClick={() => doDelete(p.name)}>delete</button>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="passphrase" />
            <button onClick={doExport} disabled={busy || !pass}>Export seed phrase</button>
            <button onClick={doRemove} disabled={busy} style={{ color: "#e74c3c" }}>Remove wallet</button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire into App**

`apps/web/src/App.tsx`: import `WalletProvider` and `WalletPanel`, wrap the returned `<main>` in `<WalletProvider>`, and render `<WalletPanel />` as the first child inside `<main>` (before the Route Doctor form). Example shape:

```tsx
import { WalletProvider } from "./wallet-context.js";
import { WalletPanel } from "./WalletPanel.js";
// ... return:
//   <WalletProvider>
//     <main …>
//       <WalletPanel />
//       … existing content …
//     </main>
//   </WalletProvider>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run apps/web`
Expected: typecheck clean; existing web tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/WalletPanel.tsx apps/web/src/App.tsx
git commit -m "feat(web): WalletPanel — create/import/mint/export in-browser, App wired"
```

---

### Task 6: Profile picker in the tool panels

**Files:**
- Modify: `apps/web/src/HealthPanel.tsx`, `apps/web/src/LiquidityPanel.tsx`, `apps/web/src/NetworkMapPanel.tsx`
- Test: gate is `npm run typecheck` + existing web tests green.

**Interfaces:**
- Consumes: `useWallet()` (Task 4).
- Produces: each panel gains a `<ProfilePicker>`-style `<select>` at the top; selecting a profile sets that panel's `url` and `token` state from the active profile. Manual fields remain as the override/fallback path.

- [ ] **Step 1: Add the picker to HealthPanel**

In `apps/web/src/HealthPanel.tsx`, import `useWallet`, and near the top of the component add:

```tsx
  const { profiles } = useWallet();
  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }
```

Render, just above the existing url input:

```tsx
      {profiles.length > 0 && (
        <div style={{ margin: "0.4rem 0" }}>
          <label>profile: <select defaultValue="" onChange={(e) => applyProfile(e.target.value)}>
            <option value="" disabled>— pick a minted token —</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.scope})</option>)}
          </select></label>
        </div>
      )}
```

(HealthPanel already has `setUrl`/`setToken` state — this only fills them.)

- [ ] **Step 2: Repeat for LiquidityPanel and NetworkMapPanel**

Both already have `url`/`token` state with `setUrl`/`setToken` (verify the setter names in each file; NetworkMapPanel uses `setUrl`/`setToken`, LiquidityPanel uses `setUrl`/`setToken`). Add the identical `useWallet()` + `applyProfile` + the same `<select>` block above each panel's url input.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run apps/web`
Expected: typecheck clean; existing web tests pass (the panels' pure view-model tests are unaffected).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/HealthPanel.tsx apps/web/src/LiquidityPanel.tsx apps/web/src/NetworkMapPanel.tsx
git commit -m "feat(web): profile picker feeds minted tokens into health/liquidity/map panels"
```

---

### Task 7: Gated live smoke + README

**Files:**
- Create: `scripts/wallet-live-smoke.mjs`
- Modify: `package.json` (add `smoke:wallet`)
- Modify: `README.md` (add a Tier B / in-browser wallet note)

**Interfaces:**
- Consumes: `fake-indexeddb/auto`, `IdbKeystore`/`IdbProfileStore`/`createWallet`/`mint` from `@fiber-route-doctor/biscuit/browser`; a plain `fetch` to `graph_channels`.
- Produces: `npm run smoke:wallet` — SKIP exit 0 without env; live run creates a wallet, mints a readonly token, and uses it against the node, asserting acceptance.

- [ ] **Step 1: Write the smoke script**

`scripts/wallet-live-smoke.mjs`:

```javascript
// Prove the in-browser custody path end-to-end: create wallet → mint token → node accepts it.
// Usage: FIBER_RPC_URL=http://127.0.0.1:8231 node --import tsx scripts/wallet-live-smoke.mjs
import "fake-indexeddb/auto";
import { IdbKeystore, IdbProfileStore, createWallet, mint } from "../packages/biscuit/src/browser/index.ts";

const url = process.env.FIBER_RPC_URL;
if (!url) { console.log("SKIP wallet-live-smoke: set FIBER_RPC_URL"); process.exit(0); }

const ks = new IdbKeystore();
await createWallet(ks, "smoke-pass");
const profile = await mint(ks, { passphrase: "smoke-pass", scope: "readonly", expiryDays: 1, url, profileName: "smoke" }, new IdbProfileStore());

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "graph_channels", params: [{}] })
});
const json = await res.json();
if (json.error) { console.error(`FAIL: node rejected the browser-minted token: ${json.error.code} ${json.error.message}`); process.exit(1); }
const n = (json.result.channels ?? json.result).length;
console.log(`OK: browser-minted readonly token accepted — graph_channels returned ${n} channels (first page)`);
```

`package.json` scripts — add:

```json
    "smoke:wallet": "node --import tsx scripts/wallet-live-smoke.mjs"
```

Note: this smoke needs no `FRD_BISCUIT_KEY` — the wallet is created in-process, which is the whole point (the browser path stands alone). It uses a single unpaginated page deliberately (proof of acceptance, not a full crawl).

- [ ] **Step 2: Verify the gated skip path**

Run: `npm run smoke:wallet`
Expected: `SKIP wallet-live-smoke: set FIBER_RPC_URL`, exit 0.

- [ ] **Step 3: Update README**

Add after the Fiber Network Map section:

```markdown
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

Live validation: `FIBER_RPC_URL=http://127.0.0.1:8231 npm run smoke:wallet`
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all green (existing + new browser/vault/context tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/wallet-live-smoke.mjs package.json README.md
git commit -m "feat: gated in-browser wallet live-smoke and README docs"
```

---

## Verification checklist (post-plan)

- `npm test` green (209 existing + new), `npm run typecheck` exit 0.
- `npm run smoke:wallet` SKIPs cleanly; live run against driveThree creates a wallet, mints, and the node accepts the browser-minted token — the Tier B loop closed end-to-end.
- Manual web check: `npm run dev` in `apps/web` — create a wallet, back up the words, mint a readonly token, pick that profile in the Map panel, load the map with no CLI token entry.
- Grep guard: `grep -rn "node:" packages/biscuit/src/browser/` returns nothing (browser modules stay node-free).
