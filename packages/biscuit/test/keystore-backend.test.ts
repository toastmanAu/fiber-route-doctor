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
