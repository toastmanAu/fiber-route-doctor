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

function assertKdfParams(ks: KeystoreFile): void {
  if (ks.kdf !== "scrypt") throw new Error("unsupported keystore kdf");
  const isPow2 = (n: number) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
  if (!isPow2(ks.N) || ks.N < 2 ** 14 || ks.N > 2 ** 20) throw new Error("invalid keystore scrypt N");
  if (!Number.isInteger(ks.r) || ks.r < 1 || ks.r > 32) throw new Error("invalid keystore scrypt r");
  if (!Number.isInteger(ks.p) || ks.p < 1 || ks.p > 16) throw new Error("invalid keystore scrypt p");
}

export function decryptSecret(ks: KeystoreFile, passphrase: string): string {
  assertKdfParams(ks);
  const key = scrypt(enc.encode(passphrase), hexToBytes(ks.salt), { N: ks.N, r: ks.r, p: ks.p, dkLen: DK });
  const pt = xchacha20poly1305(key, hexToBytes(ks.nonce)).decrypt(hexToBytes(ks.ciphertext));
  return dec.decode(pt);
}
