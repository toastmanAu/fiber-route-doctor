import { describe, it, expect } from "vitest";
import { demoFetch, pickDemoRoute, DEMO_SOURCE, DEMO_TARGET, DEMO_AMOUNT } from "../src/demo/demo-fetch.js";
import { GraphClient, loadGraph, buildNetworkMapModel, runDiagnosis, CKB_ASSET, type RpcChannelInfo } from "@fiber-route-doctor/core";

async function rpc(method: string): Promise<unknown> {
  const res = await demoFetch("http://demo", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: [{}] }) });
  return (await res.json()).result;
}

describe("demoFetch", () => {
  it("serves each RPC method's fixture in a JSON-RPC envelope", async () => {
    // Node floor is modest: fnn >= 0.9 with a fresh store only holds currently
    // re-broadcasting node announcements (~47 at capture), not weeks of stale ones.
    expect((await rpc("graph_nodes") as { nodes: unknown[] }).nodes.length).toBeGreaterThan(40);
    // Channel floor > 500 doubles as the pagination guard: a single-page
    // truncation at GRAPH_PAGE_LIMIT=500 would fail this.
    expect((await rpc("graph_channels") as { channels: unknown[] }).channels.length).toBeGreaterThan(600);
    expect((await rpc("node_info") as { version: string }).version).toBeTruthy();
    expect((await rpc("list_peers") as { peers: unknown[] }).peers).toBeInstanceOf(Array);
    expect((await rpc("list_channels") as { channels: unknown[] }).channels).toBeInstanceOf(Array);
  });
  it("echoes the request id", async () => {
    const res = await demoFetch("http://demo", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "node_info", params: [] }) });
    expect((await res.json()).id).toBe(42);
  });
  it("runs the REAL pipeline: model over demoFetch yields the full network", async () => {
    const client = new GraphClient({ url: "demo", fetchImpl: demoFetch });
    const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
    const m = buildNetworkMapModel(nodes, channels);
    expect(m.stats.channelCount).toBeGreaterThan(600);
    // Map nodes = channel endpoints (announced + unannounced), so > announced count.
    expect(m.stats.nodeCount).toBeGreaterThan(100);
    // demo route endpoints are real nodes in the model
    const keys = new Set(m.nodes.map((n) => n.pubkey));
    expect(keys.has(DEMO_SOURCE)).toBe(true);
    expect(keys.has(DEMO_TARGET)).toBe(true);
  });
  it("finds a real payable route between the demo endpoints", async () => {
    const model = await loadGraph(new GraphClient({ url: "demo", fetchImpl: demoFetch }));
    const report = await runDiagnosis(model, { source: DEMO_SOURCE, target: DEMO_TARGET, amount: BigInt(DEMO_AMOUNT), asset: CKB_ASSET });
    expect(report.path.length).toBeGreaterThanOrEqual(1);
    expect(report.verdict).toBe("payable");
  });
});

describe("pickDemoRoute", () => {
  it("returns the endpoints of the highest-capacity channel", () => {
    const chans = [
      { channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb", capacity: "0x64" },
      { channel_outpoint: "0x2", node1: "0xcc", node2: "0xdd", capacity: "0xc8" }
    ] as RpcChannelInfo[];
    const r = pickDemoRoute(chans);
    expect(r).toEqual({ source: "0xcc", target: "0xdd", amount: "1000" });
  });

  it("requires the node1->node2 direction specifically, not either direction", () => {
    const chans = [
      // higher capacity, but only node2->node1 is enabled: direct source->target route would NOT exist
      {
        channel_outpoint: "0x1",
        node1: "0xaa",
        node2: "0xbb",
        capacity: "0xc8",
        udt_type_script: null,
        update_info_of_node1: null,
        update_info_of_node2: { timestamp: "0x1", enabled: true, fee_rate: "0x0", tlc_expiry_delta: "0x0", tlc_minimum_value: "0x0" }
      },
      // lower capacity, but node1->node2 IS enabled: this is the only one that guarantees a direct payable route
      {
        channel_outpoint: "0x2",
        node1: "0xcc",
        node2: "0xdd",
        capacity: "0x64",
        udt_type_script: null,
        update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x0", tlc_expiry_delta: "0x0", tlc_minimum_value: "0x0" },
        update_info_of_node2: null
      }
    ] as RpcChannelInfo[];
    const r = pickDemoRoute(chans);
    expect(r).toEqual({ source: "0xcc", target: "0xdd", amount: "1000" });
  });

  it("falls back to the highest-capacity CKB channel when none has node1->node2 enabled", () => {
    const chans = [
      { channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb", capacity: "0x64", udt_type_script: null, update_info_of_node1: null, update_info_of_node2: null },
      { channel_outpoint: "0x2", node1: "0xcc", node2: "0xdd", capacity: "0xc8", udt_type_script: null, update_info_of_node1: null, update_info_of_node2: null }
    ] as RpcChannelInfo[];
    const r = pickDemoRoute(chans);
    expect(r).toEqual({ source: "0xcc", target: "0xdd", amount: "1000" });
  });

  it("falls back to the highest-capacity channel overall when there are no CKB channels", () => {
    const udt = { code_hash: "0x1", hash_type: "type", args: "0x2" };
    const chans = [
      { channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb", capacity: "0x64", udt_type_script: udt, update_info_of_node1: null, update_info_of_node2: null },
      { channel_outpoint: "0x2", node1: "0xcc", node2: "0xdd", capacity: "0xc8", udt_type_script: udt, update_info_of_node1: null, update_info_of_node2: null }
    ] as RpcChannelInfo[];
    const r = pickDemoRoute(chans);
    expect(r).toEqual({ source: "0xcc", target: "0xdd", amount: "1000" });
  });

  it("returns an empty route instead of throwing when given an empty channel list", () => {
    expect(() => pickDemoRoute([])).not.toThrow();
    expect(pickDemoRoute([])).toEqual({ source: "", target: "", amount: "1000" });
  });
});
