import { describe, it, expect } from "vitest";
import { buildRouteView } from "../src/route-view.js";
import type { RouteReport } from "@fiber-route-doctor/core";

describe("buildRouteView", () => {
  it("converts a payable report with a 2-hop path to RouteView with correct structure", () => {
    const report: RouteReport = {
      verdict: "payable",
      probe: {
        source: "0x0123456789abcdef",
        target: "0xfedcba9876543210",
        amount: 1000n,
        asset: "CKB",
      },
      path: [
        {
          index: 0,
          from: "0x0123456789abcdef",
          to: "0xaabbccddeeff0011",
          channelOutpoint: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          asset: "CKB",
          fee: 100n,
          expiryDelta: 1000n,
        },
        {
          index: 1,
          from: "0xaabbccddeeff0011",
          to: "0xfedcba9876543210",
          channelOutpoint: "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
          asset: "CKB",
          fee: 50n,
          expiryDelta: 500n,
        },
      ],
      totalFee: 150n,
      totalExpiry: 1500n,
      reasons: [],
      fixes: [],
      routerConfirmed: true,
    };

    const view = buildRouteView(report);

    expect(view.verdict).toBe("payable");
    expect(view.color).toBe("#2e7d32");
    expect(view.nodes).toHaveLength(3);
    expect(view.nodes[0].role).toBe("source");
    expect(view.nodes[1].role).toBe("hop");
    expect(view.nodes[2].role).toBe("target");
    expect(view.edges).toHaveLength(2);
    expect(view.edges[0].label).toContain("fee");
    expect(view.edges[1].label).toContain("fee");
    expect(view.reasons).toHaveLength(0);
  });

  it("converts a blocked report with empty path to RouteView with source and target nodes only", () => {
    const report: RouteReport = {
      verdict: "blocked",
      probe: {
        source: "0x0123456789abcdef",
        target: "0xfedcba9876543210",
        amount: 1000n,
        asset: "CKB",
      },
      path: [],
      totalFee: 0n,
      totalExpiry: 0n,
      reasons: [
        {
          cause: "target_absent",
          detail: "target node not found in graph",
        },
      ],
      fixes: [],
      routerConfirmed: false,
    };

    const view = buildRouteView(report);

    expect(view.verdict).toBe("blocked");
    expect(view.color).toBe("#c62828");
    expect(view.nodes).toHaveLength(2);
    expect(view.nodes[0].id).toBe(report.probe.source);
    expect(view.nodes[1].id).toBe(report.probe.target);
    expect(view.edges).toHaveLength(0);
    expect(view.reasons).toHaveLength(1);
    expect(view.reasons[0]).toContain("[target_absent]");
    expect(view.reasons[0]).toContain("target node not found in graph");
  });

  it("uses risky color for risky verdict", () => {
    const report: RouteReport = {
      verdict: "risky",
      probe: {
        source: "0x0123456789abcdef",
        target: "0xfedcba9876543210",
        amount: 1000n,
        asset: "CKB",
      },
      path: [],
      totalFee: 0n,
      totalExpiry: 0n,
      reasons: [
        {
          cause: "fee_over_limit",
          detail: "fee would exceed limit",
        },
      ],
      fixes: [],
      routerConfirmed: false,
    };

    const view = buildRouteView(report);

    expect(view.verdict).toBe("risky");
    expect(view.color).toBe("#f9a825");
  });
});
