import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, chmodSync } from "node:fs";
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

  it("re-enforces 600 when overwriting a pre-existing looser-perm file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ks-"));
    const path = join(dir, "keystore.json");
    const store = new NodeFsKeystore(path);
    store.save(encryptSecret("seed", "pass", "mnemonic", "ed25519/x"));
    chmodSync(path, 0o644);
    expect((statSync(path).mode & 0o777)).toBe(0o644);
    store.save(encryptSecret("seed2", "pass", "mnemonic", "ed25519/y"));
    expect((statSync(path).mode & 0o777)).toBe(0o600);
    expect(store.load()?.publicKeyString).toBe("ed25519/y");
  });
});
