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
