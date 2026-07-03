import type { RpcChannelInfo, RpcGraphNode } from "../src/index.js";

export function gnode(pubkey: string, name: string | null = null): RpcGraphNode {
  return { pubkey, node_name: name, addresses: [`/ip4/1.1.1.1/tcp/1`], timestamp: "0x1" };
}
export function gchan(over: Partial<RpcChannelInfo> = {}): RpcChannelInfo {
  return {
    channel_outpoint: "0x01", node1: "0xaa", node2: "0xbb", capacity: "0x64",
    udt_type_script: null,
    update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" },
    update_info_of_node2: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" },
    ...over
  };
}
