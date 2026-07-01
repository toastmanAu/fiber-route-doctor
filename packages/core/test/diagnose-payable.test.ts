import { describe, it, expect } from "vitest";
import { GraphModel, diagnose, CKB_ASSET, type ProbeRequest, type RpcChannelInfo } from "../src/index.js";

function chan(op: string, a: string, b: string, fee: string): RpcChannelInfo {
  const u = { timestamp: "0x1", enabled: true, fee_rate: fee, tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" };
  return { channel_outpoint: op, node1: a, node2: b, capacity: "0xf4240", funding_udt_type_script: null, update_info_of_node1: u, update_info_of_node2: u };
}
const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };
const model = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa"), chan("0x2", "0xB", "0xC", "0xa")]);

describe("diagnose — found path", () => {
  it("returns payable with the path and totals when fee is within ceiling and router is skipped", () => {
    const r = diagnose(model, probe, { kind: "skipped" });
    expect(r.verdict).toBe("payable");
    expect(r.path.map(h => h.to)).toEqual(["0xB", "0xC"]);
    expect(r.totalFee).toBe(20n);
    expect(r.reasons).toEqual([]);
    expect(r.routerConfirmed).toBe(false);
  });
  it("marks payable + routerConfirmed when build_router returns the same channels", () => {
    const r = diagnose(model, probe, { kind: "router_path", channelOutpoints: ["0x1", "0x2"] });
    expect(r.verdict).toBe("payable");
    expect(r.routerConfirmed).toBe(true);
  });
  it("downgrades to risky when build_router errored despite a viable path", () => {
    const r = diagnose(model, probe, { kind: "router_error", message: "no path" });
    expect(r.verdict).toBe("risky");
    expect(r.reasons.map(x => x.cause)).toContain("router_declined");
  });
  it("downgrades to risky when the fee exceeds maxFeeRate", () => {
    const r = diagnose(model, { ...probe, maxFeeRate: 0n }, { kind: "skipped" });
    expect(r.verdict).toBe("risky");
    expect(r.reasons.map(x => x.cause)).toContain("fee_over_limit");
  });
});
