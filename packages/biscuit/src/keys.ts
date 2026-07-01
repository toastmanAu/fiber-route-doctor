import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "micro-key-producer/slip10.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { KeyPair, PrivateKey, SignatureAlgorithm } from "@biscuit-auth/biscuit-wasm";

export const BISCUIT_DERIVATION_PATH = "m/44'/1'/0'";

export interface BiscuitKey { privateKeyString: string; publicKeyString: string; }

export function newMnemonic(): string { return generateMnemonic(wordlist, 256); }

export function fromPrivateBytes(priv: Uint8Array): BiscuitKey {
  const privateKeyString = `ed25519-private/${bytesToHex(priv)}`;
  const publicKeyString = KeyPair.fromPrivateKey(PrivateKey.fromBytes(priv, SignatureAlgorithm.Ed25519)).getPublicKey().toString();
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
  const hex = raw.trim().replace(/^ed25519-private\//, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("expected an Ed25519 private key: 'ed25519-private/<64 hex>' or bare 64-hex");
  }
  return fromPrivateBytes(hexToBytes(hex));
}
