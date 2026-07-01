import { describe, it, expect } from "vitest";
import { CKB_ASSET, type ProbeRequest } from "../src/index.js";

describe("core types", () => {
  it("exports the native asset sentinel and accepts a ProbeRequest literal", () => {
    const probe: ProbeRequest = {
      source: "0xaa",
      target: "0xbb",
      amount: 1000n,
      asset: CKB_ASSET
    };
    expect(CKB_ASSET).toBe("CKB");
    expect(probe.amount).toBe(1000n);
  });
});
