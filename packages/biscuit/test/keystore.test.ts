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
