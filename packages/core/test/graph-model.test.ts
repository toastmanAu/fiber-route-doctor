import { describe, it, expect } from "vitest";
import { GraphModel, assetIdOf, type RpcChannelInfo, type RpcGraphNode } from "../src/index.js";

const nodes: RpcGraphNode[] = [
  { pubkey: "0xA", addresses: [], timestamp: "0x1" },
  { pubkey: "0xB", addresses: [], timestamp: "0x1" }
];
const channels: RpcChannelInfo[] = [
  {
    channel_outpoint: "0xchan1",
    node1: "0xA",
    node2: "0xB",
    capacity: "0x64", // 100
    funding_udt_type_script: null,
    update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0xa", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" },
    update_info_of_node2: { timestamp: "0x1", enabled: false, fee_rate: "0x14", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" }
  }
];

describe("assetIdOf", () => {
  it("maps null funding script to native CKB", () => {
    expect(assetIdOf(null)).toBe("CKB");
  });
  it("derives a stable hex key for a UDT script", () => {
    const a = assetIdOf({ code_hash: "0x11", hash_type: "type", args: "0x22" });
    const b = assetIdOf({ code_hash: "0x11", hash_type: "type", args: "0x22" });
    expect(a).toBe(b);
    expect(a).not.toBe("CKB");
  });
});

describe("GraphModel.fromRpc", () => {
  it("expands each channel into up to two directed edges by update info", () => {
    const m = GraphModel.fromRpc(nodes, channels);
    const outA = m.edgesFrom("0xA");
    expect(outA).toHaveLength(1);
    expect(outA[0]).toMatchObject({ from: "0xA", to: "0xB", enabled: true, feeRate: 10n, capacity: 100n, asset: "CKB" });
    const outB = m.edgesFrom("0xB");
    expect(outB[0]).toMatchObject({ from: "0xB", to: "0xA", enabled: false, feeRate: 20n });
  });
  it("answers node and reachability queries", () => {
    const m = GraphModel.fromRpc(nodes, channels);
    expect(m.hasNode("0xA")).toBe(true);
    expect(m.hasNode("0xZ")).toBe(false);
    expect(m.edgesTo("0xB")).toHaveLength(1);
    expect(m.allEdges()).toHaveLength(2);
    expect([...m.assetsOf("0xA")]).toEqual(["CKB"]);
  });
});
