import { describe, it, expect } from "vitest";
import { scopeFacts } from "../src/index.js";

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
