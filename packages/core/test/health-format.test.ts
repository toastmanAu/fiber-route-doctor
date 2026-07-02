import { describe, it, expect } from "vitest";
import { formatHealthText, type HealthReport } from "../src/index.js";

const REPORT: HealthReport = {
  verdict: "warn",
  node: { version: "0.9.0-rc5", pubkey: "0x03aabbccdd", nodeName: "dt", addresses: ["/ip4/1.2.3.4/tcp/8228"], chainHash: "0x1122334455", channelCount: 500, pendingChannelCount: 0, peersCount: 8 },
  checks: [
    { id: "reachability", title: "Node reachability", status: "pass", reason: "node responded to RPC" },
    { id: "auth", title: "Authentication", status: "pass", reason: "all calls authorized" },
    { id: "channels", title: "Channel health", status: "warn", reason: "0xabcdef1234… disabled", fix: "re-enable via update_channel" },
    { id: "peers", title: "Peer connectivity", status: "skip", reason: "unavailable" }
  ]
};

describe("formatHealthText", () => {
  it("renders verdict header, node summary, and one line per check with icons", () => {
    const out = formatHealthText(REPORT);
    expect(out).toContain("verdict: WARN");
    expect(out).toContain("fnn v0.9.0-rc5");
    expect(out).toContain("500 channels");
    expect(out).toContain("✓ Node reachability");
    expect(out).toContain("⚠ Channel health");
    expect(out).toContain("− Peer connectivity");
    expect(out).toContain("fix: re-enable via update_channel");
  });
  it("omits the node summary line when node info is absent", () => {
    const out = formatHealthText({ ...REPORT, node: undefined });
    expect(out).not.toContain("fnn v");
  });
  it("report JSON-serializes cleanly", () => {
    expect(() => JSON.stringify(REPORT)).not.toThrow();
  });
});
