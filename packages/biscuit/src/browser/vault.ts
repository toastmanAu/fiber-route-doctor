import { newMnemonic, deriveFromMnemonic, importPrivateKeyString } from "../keys.js";
import { encryptSecret, decryptSecret, type KeystoreKind } from "../keystore.js";
import { mintToken } from "../mint.js";
import { scopeFacts } from "../scopes.js";
import type { BrowserKeystore } from "./keystore-idb.js";
import type { BrowserProfileStore, BrowserTokenProfile } from "./profile-idb.js";

const MS_PER_DAY = 86_400_000;

export function hasKeystore(ks: BrowserKeystore): Promise<boolean> {
  return ks.load().then((k) => k !== undefined);
}

/** Structural keystore failures (bad kdf, out-of-range scrypt params) are corruption, not a wrong passphrase. */
const STRUCTURAL_KEYSTORE_ERROR = /keystore (kdf|scrypt)/;

/** Decrypt the stored secret for the duration of ONE operation. Wrong passphrase → "incorrect passphrase". */
async function withSecret<T>(ks: BrowserKeystore, passphrase: string, run: (secret: string, kind: KeystoreKind) => T): Promise<T> {
  const file = await ks.load();
  if (!file) throw new Error("no wallet — create or import one first");
  let secret: string;
  try {
    secret = decryptSecret(file, passphrase);
  } catch (err) {
    if (err instanceof Error && STRUCTURAL_KEYSTORE_ERROR.test(err.message)) throw err;
    throw new Error("incorrect passphrase");
  }
  return run(secret, file.kind);
}

const MINT_SCOPES: ReadonlyArray<MintRequest["scope"]> = ["readonly", "invoicing", "operator", "full"];

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
  scope: "readonly" | "invoicing" | "operator" | "full";
  expiryDays: number;
  url: string;
  profileName: string;
}

export async function mint(ks: BrowserKeystore, req: MintRequest, profiles: BrowserProfileStore): Promise<BrowserTokenProfile> {
  if (!Number.isInteger(req.expiryDays) || req.expiryDays < 1) throw new Error("expiryDays must be a positive integer");
  if (!MINT_SCOPES.includes(req.scope)) throw new Error("invalid scope");
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
