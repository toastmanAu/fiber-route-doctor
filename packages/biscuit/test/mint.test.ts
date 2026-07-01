import { describe, it, expect } from "vitest";
import { mintToken, authorizeLocally, scopeFacts, deriveFromMnemonic } from "../src/index.js";

const FIXED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const key = deriveFromMnemonic(FIXED);
const future = new Date(Date.now() + 3600e3);

describe("mint + authorize compatibility gate", () => {
  it("mints a base64 token", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: future });
    expect(typeof t).toBe("string");
    expect(t.length).toBeGreaterThan(50);
  });
  it("a readonly token is ALLOWED for read scopes (replicates Fiber's list_channels/graph rules)", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: future });
    expect(authorizeLocally(t, key.publicKeyString, 'allow if read("channels");')).toBe(true);
    expect(authorizeLocally(t, key.publicKeyString, 'allow if read("graph");')).toBe(true);
  });
  it("a readonly token is DENIED for write scopes (replicates Fiber's open_channel rule)", () => {
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: future });
    expect(authorizeLocally(t, key.publicKeyString, 'allow if write("channels");')).toBe(false);
  });
  it("an expired token is DENIED", () => {
    const past = new Date(Date.now() - 1000);
    const t = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: past });
    expect(authorizeLocally(t, key.publicKeyString, 'allow if read("channels");', new Date())).toBe(false);
  });
});
