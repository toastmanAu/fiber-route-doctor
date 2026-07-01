import { describe, it, expect } from "vitest";
import { GraphModel, findBestPath, edgeUsable, CKB_ASSET, type ProbeRequest, type RpcChannelInfo } from "../src/index.js";

function chan(op: string, a: string, b: string, feeAB: string, opts: Partial<{ enabled: boolean; cap: string; min: string }> = {}): RpcChannelInfo {
  const u = { timestamp: "0x1", enabled: opts.enabled ?? true, fee_rate: feeAB, tlc_expiry_delta: "0x3e8", tlc_minimum_value: opts.min ?? "0x1" };
  return {
    channel_outpoint: op, node1: a, node2: b, capacity: opts.cap ?? "0xf4240", // 1_000_000
    funding_udt_type_script: null,
    update_info_of_node1: u,
    update_info_of_node2: { ...u, fee_rate: feeAB }
  };
}

const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET };

describe("edgeUsable", () => {
  it("rejects a disabled edge", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa", { enabled: false })]);
    expect(edgeUsable(m.edgesFrom("0xA")[0], probe)).toBe(false);
  });
  it("rejects when amount is below the min value", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa", { min: "0x100000" })]);
    expect(edgeUsable(m.edgesFrom("0xA")[0], probe)).toBe(false);
  });
  it("rejects when amount exceeds capacity", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa", { cap: "0x1" })]);
    expect(edgeUsable(m.edgesFrom("0xA")[0], probe)).toBe(false);
  });
});

describe("findBestPath", () => {
  it("returns the least-fee path across multiple hops", () => {
    // A->B (fee 10/k), B->C (fee 10/k): total fee = 1000*10/1000 * 2 = 20
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa"), chan("0x2", "0xB", "0xC", "0xa")]);
    const r = findBestPath(m, probe);
    expect(r).not.toBeNull();
    expect(r!.hops.map(h => h.to)).toEqual(["0xB", "0xC"]);
    expect(r!.totalFee).toBe(20n);
    expect(r!.totalExpiry).toBe(2000n);
  });
  it("prefers the cheaper of two candidate paths", () => {
    // Direct-ish expensive A->B(100)->C vs cheaper A->D(1)->C
    const m = GraphModel.fromRpc([], [
      chan("0x1", "0xA", "0xB", "0x64"), chan("0x2", "0xB", "0xC", "0x64"),
      chan("0x3", "0xA", "0xD", "0x1"),  chan("0x4", "0xD", "0xC", "0x1")
    ]);
    const r = findBestPath(m, probe);
    expect(r!.hops.map(h => h.to)).toEqual(["0xD", "0xC"]);
  });
  it("returns null when the target is unreachable", () => {
    const m = GraphModel.fromRpc([], [chan("0x1", "0xA", "0xB", "0xa")]);
    expect(findBestPath(m, probe)).toBeNull();
  });
});
