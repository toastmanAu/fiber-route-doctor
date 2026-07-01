import { describe, it, expect } from "vitest";
import { GraphModel, diagnose, CKB_ASSET, type ProbeRequest, type RpcChannelInfo } from "../src/index.js";

function chan(op: string, a: string, b: string, o: Partial<{ enabled: boolean; cap: string; min: string; udt: boolean }> = {}): RpcChannelInfo {
  const u = { timestamp: "0x1", enabled: o.enabled ?? true, fee_rate: "0xa", tlc_expiry_delta: "0x3e8", tlc_minimum_value: o.min ?? "0x1" };
  return {
    channel_outpoint: op, node1: a, node2: b, capacity: o.cap ?? "0xf4240",
    funding_udt_type_script: o.udt ? { code_hash: "0x11", hash_type: "type", args: "0x22" } : null,
    update_info_of_node1: u, update_info_of_node2: u
  };
}
const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };

describe("diagnose — blocked attribution", () => {
  it("reports target_absent when target has no presence", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB")]);
    const r = diagnose(m, probe, { kind: "skipped" });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons[0].cause).toBe("target_absent");
    expect(r.fixes.length).toBeGreaterThan(0);
  });
  it("reports asset_mismatch when target is only reachable on a different asset", () => {
    // Path A->B->C exists but only as a UDT channel into C; probe asks for CKB
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", { udt: true }), chan("0x2", "0xB", "0xC", { udt: true })]);
    const r = diagnose(m, probe, { kind: "skipped" });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons.map(x => x.cause)).toContain("asset_mismatch");
  });
  it("reports below_min_value as the dominant cause on the final hop", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB"), chan("0x2", "0xB", "0xC", { min: "0x100000" })]);
    const r = diagnose(m, probe, { kind: "skipped" });
    expect(r.verdict).toBe("blocked");
    expect(r.reasons[0].cause).toBe("below_min_value");
  });
});
