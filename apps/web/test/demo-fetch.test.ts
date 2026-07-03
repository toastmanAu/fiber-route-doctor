import { describe, it, expect } from "vitest";
import { demoFetch, pickDemoRoute, DEMO_SOURCE, DEMO_TARGET, DEMO_AMOUNT } from "../src/demo/demo-fetch.js";
import { GraphClient, loadGraph, buildNetworkMapModel, runDiagnosis, CKB_ASSET, type RpcChannelInfo } from "@fiber-route-doctor/core";

async function rpc(method: string): Promise<unknown> {
  const res = await demoFetch("http://demo", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: [{}] }) });
  return (await res.json()).result;
}

describe("demoFetch", () => {
  it("serves each RPC method's fixture in a JSON-RPC envelope", async () => {
    expect((await rpc("graph_nodes") as { nodes: unknown[] }).nodes.length).toBeGreaterThan(200);
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
    expect(m.stats.nodeCount).toBeGreaterThan(200);
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
});
