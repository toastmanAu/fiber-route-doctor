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
  it("a corrupt keystore (bad scrypt N) is reported distinctly from a wrong passphrase", async () => {
    const ks = new IdbKeystore();
    await ks.clear();
    await createWallet(ks, "pw");
    const file = await ks.load();
    if (!file) throw new Error("test setup failed: no keystore file");
    await ks.save({ ...file, N: 3 });
    await expect(exportMnemonic(ks, "pw")).rejects.toThrow(/keystore scrypt N/);
  });
  it("mint rejects a non-positive-integer expiryDays", async () => {
    const ks = new IdbKeystore();
    await ks.clear();
    await createWallet(ks, "pw");
    const profiles = new IdbProfileStore();
    await expect(mint(ks, { passphrase: "pw", scope: "readonly", expiryDays: 0, url: "u", profileName: "x" }, profiles)).rejects.toThrow(/expiryDays/);
  });
  it("mint rejects an invalid scope", async () => {
    const ks = new IdbKeystore();
    await ks.clear();
    await createWallet(ks, "pw");
    const profiles = new IdbProfileStore();
    await expect(mint(ks, { passphrase: "pw", scope: "bogus" as any, expiryDays: 30, url: "u", profileName: "x" }, profiles)).rejects.toThrow(/scope/);
  });
});
