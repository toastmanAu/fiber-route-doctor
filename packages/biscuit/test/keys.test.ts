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
  it("imports a bare 64-hex private key (no prefix) identically to the prefixed form", () => {
    const derived = deriveFromMnemonic(FIXED);
    const bareHex = derived.privateKeyString.replace(/^ed25519-private\//, "");
    expect(importPrivateKeyString(bareHex).publicKeyString).toBe(derived.publicKeyString);
  });
});
