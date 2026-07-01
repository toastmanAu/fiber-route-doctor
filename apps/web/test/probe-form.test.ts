import { describe, it, expect } from "vitest";
import { buildProbe } from "../src/probe-form.js";

describe("buildProbe", () => {
  it("converts a decimal amount string to bigint and defaults empty asset to CKB", () => {
    const p = buildProbe({ source: "0xA", target: "0xC", amount: "1000", asset: "" });
    expect(p.amount).toBe(1000n);
    expect(p.asset).toBe("CKB");
  });
  it("throws on a non-numeric amount", () => {
    expect(() => buildProbe({ source: "0xA", target: "0xC", amount: "abc", asset: "" })).toThrow(/amount/);
  });
});
