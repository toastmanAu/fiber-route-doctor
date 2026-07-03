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
  it("a put resolves only after the write transaction commits — a fresh connection can read it back immediately", async () => {
    await idbPut("profiles", "committed", { name: "committed" });
    // A brand-new connection/transaction can only see committed data, never
    // data that is merely "request succeeded but transaction not yet committed."
    expect(await idbGet<{ name: string }>("profiles", "committed")).toEqual({ name: "committed" });
  });
});
