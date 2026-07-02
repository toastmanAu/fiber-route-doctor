import { describe, it, expect } from "vitest";
import { buildHealthView } from "../src/health-view.js";
import type { HealthReport } from "@fiber-route-doctor/core";

const REPORT: HealthReport = {
  verdict: "warn",
  node: { version: "0.9.0-rc5", pubkey: "0x03aabbccdd", nodeName: null, addresses: [], chainHash: "0x11", channelCount: 500, pendingChannelCount: 0, peersCount: 8 },
  checks: [
    { id: "reachability", title: "Node reachability", status: "pass", reason: "node responded to RPC" },
    { id: "channels", title: "Channel health", status: "warn", reason: "0xab… disabled", fix: "re-enable via update_channel" },
    { id: "peers", title: "Peer connectivity", status: "skip", reason: "unavailable" }
  ]
};

describe("buildHealthView", () => {
  it("maps statuses to icons and colors", () => {
    const v = buildHealthView(REPORT);
    expect(v.verdict).toBe("warn");
    expect(v.verdictColor).toBe("#f1c40f");
    expect(v.rows).toHaveLength(3);
    expect(v.rows[0]).toMatchObject({ icon: "✓", color: "#2ecc71" });
    expect(v.rows[1]).toMatchObject({ icon: "⚠", color: "#f1c40f", fix: "re-enable via update_channel" });
    expect(v.rows[2]).toMatchObject({ icon: "−", color: "#7f8c8d" });
  });
  it("builds a node summary line when node info is present, omits it otherwise", () => {
    expect(buildHealthView(REPORT).summary).toContain("fnn v0.9.0-rc5");
    expect(buildHealthView({ ...REPORT, node: undefined }).summary).toBeUndefined();
  });
});
