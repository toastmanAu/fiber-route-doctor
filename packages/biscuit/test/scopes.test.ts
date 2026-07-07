import { describe, it, expect } from "vitest";
import { scopeFacts, mintToken, authorizeLocally, deriveFromMnemonic, newMnemonic } from "../src/index.js";

describe("scopeFacts", () => {
  it("readonly covers all read scopes the toolkit needs", () => {
    const f = scopeFacts("readonly");
    for (const s of ["node","peers","channels","payments","graph","cch"]) {
      expect(f).toContain(`read("${s}")`);
    }
    expect(f.some(x => x.startsWith("write("))).toBe(false);
  });
  it("full adds write scopes", () => {
    const f = scopeFacts("full");
    expect(f).toContain('write("channels")');
    expect(f).toContain('write("cch")');
    expect(f).toContain('write("invoices")');
  });
  it("appends extra custom facts", () => {
    expect(scopeFacts("readonly", ['read("custom")'])).toContain('read("custom")');
  });
});

describe("operator scope", () => {
  it("grants exactly readonly + write(channels) + write(peers)", () => {
    const f = scopeFacts("operator");
    for (const s of ["node","peers","channels","payments","graph","cch"]) expect(f).toContain(`read("${s}")`);
    expect(f).toContain('write("channels")');
    expect(f).toContain('write("peers")');
    expect(f.filter(x => x.startsWith("write(")).length).toBe(2);
  });
  it("full now includes peers and payments writes", () => {
    const f = scopeFacts("full");
    for (const s of ["channels","cch","invoices","peers","payments"]) expect(f).toContain(`write("${s}")`);
  });
  it("GROUND TRUTH: operator passes the node's connect_peer rule; the OLD full fact-set fails", () => {
    // Node rule for connect_peer (rpc/biscuit.rs:127): allow if write("peers");
    const RULE = 'allow if write("peers");';
    const key = deriveFromMnemonic(newMnemonic());
    const expiry = new Date(Date.now() + 3600e3);
    const operatorToken = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("operator"), expiry });
    expect(authorizeLocally(operatorToken, key.publicKeyString, RULE)).toBe(true);
    // The pre-B "full" facts (no write("peers")) — pinned literally so this test
    // keeps proving WHY operator exists even after full was widened:
    const OLD_FULL = [
      'read("node")','read("peers")','read("channels")','read("payments")','read("graph")','read("cch")',
      'write("channels")','write("cch")','write("invoices")'
    ];
    const oldFullToken = mintToken({ privateKeyString: key.privateKeyString, facts: OLD_FULL, expiry });
    expect(authorizeLocally(oldFullToken, key.publicKeyString, RULE)).toBe(false);
  });
});
