import { describe, it, expect, vi } from "vitest";
import { HealthClient, runHealthProbe, runHealthChecks, worstStatus, summarizeNode, type CheckResult, type HealthSnapshot } from "../src/index.js";

const check = (status: CheckResult["status"]): CheckResult => ({ id: "x", title: "x", status, reason: "" });

describe("worstStatus", () => {
  it("ranks fail > warn > pass and ignores skip", () => {
    expect(worstStatus([check("pass"), check("warn"), check("fail"), check("skip")])).toBe("fail");
    expect(worstStatus([check("pass"), check("warn"), check("skip")])).toBe("warn");
    expect(worstStatus([check("pass"), check("skip")])).toBe("pass");
  });
});

describe("summarizeNode", () => {
  it("converts hex counts to numbers", () => {
    const s = summarizeNode({
      version: "0.9.0-rc5", commit_hash: "abc", pubkey: "0x03aa", node_name: null, addresses: ["/a"],
      chain_hash: "0x11", channel_count: "0x1f4", pending_channel_count: "0x2", peers_count: "0x8"
    });
    expect(s).toMatchObject({ channelCount: 500, pendingChannelCount: 2, peersCount: 8, nodeName: null });
  });
  it("returns undefined without node info", () => { expect(summarizeNode(undefined)).toBeUndefined(); });
});

describe("runHealthProbe", () => {
  it("produces a full-fail report against an unreachable node", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const report = await runHealthProbe(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(report.verdict).toBe("fail");
    expect(report.checks.map((c) => c.id)).toEqual(["reachability", "auth", "node-info", "peers", "channels"]);
    expect(report.checks[0].status).toBe("fail");
    expect(report.checks.slice(1).every((c) => c.status === "skip")).toBe(true);
    expect(report.node).toBeUndefined();
  });
});

describe("runHealthChecks", () => {
  it("runs all five checks over a snapshot", () => {
    const s: HealthSnapshot = { outcomes: { nodeInfo: { ok: false, kind: "transport-error", detail: "x" }, listPeers: { ok: false, kind: "transport-error", detail: "x" }, listChannels: { ok: false, kind: "transport-error", detail: "x" } } };
    expect(runHealthChecks(s)).toHaveLength(5);
  });
});
