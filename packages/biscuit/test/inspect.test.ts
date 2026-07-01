import { describe, it, expect } from "vitest";
import { inspectToken, mintToken, scopeFacts, deriveFromMnemonic } from "../src/index.js";

const FIXED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const key = deriveFromMnemonic(FIXED);

describe("inspectToken", () => {
  it("extracts facts and checks from a minted token", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
    const r = inspectToken(t, key.publicKeyString);
    expect(r.facts).toContain('read("channels")');
    expect(r.checks.some(c => c.startsWith("check if time"))).toBe(true);
  });
});
