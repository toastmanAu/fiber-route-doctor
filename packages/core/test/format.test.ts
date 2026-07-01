import { describe, it, expect } from "vitest";
import { formatReportText, CKB_ASSET, type RouteReport } from "../src/index.js";

const base: RouteReport = {
  verdict: "blocked", probe: { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET },
  path: [], totalFee: 0n, totalExpiry: 0n,
  reasons: [{ cause: "below_min_value", detail: "1 final-hop channel(s) failed on below_min_value." }],
  fixes: [{ detail: "Increase the amount." }], routerConfirmed: false
};

describe("formatReportText", () => {
  it("renders the verdict, reasons, and fixes deterministically", () => {
    const text = formatReportText(base);
    expect(text).toContain("VERDICT: blocked");
    expect(text).toContain("below_min_value");
    expect(text).toContain("Increase the amount.");
  });
});
