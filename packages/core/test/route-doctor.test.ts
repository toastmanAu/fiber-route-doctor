import { describe, it, expect, vi } from "vitest";
import { GraphClient, loadGraph, runDiagnosis, CKB_ASSET, type ProbeRequest } from "../src/index.js";

function client(nodes: unknown, channels: unknown) {
  const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const result = body.method === "graph_nodes" ? nodes : channels;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
  return new GraphClient({ url: "http://n/rpc", fetchImpl });
}
const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1_000_000n, asset: CKB_ASSET };
const chans = [
  { channel_outpoint: "0x1", node1: "0xA", node2: "0xB", capacity: "0x3b9aca00", udt_type_script: null, update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" }, update_info_of_node2: null },
  { channel_outpoint: "0x2", node1: "0xB", node2: "0xC", capacity: "0x3b9aca00", udt_type_script: null, update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x3e8", tlc_minimum_value: "0x1" }, update_info_of_node2: null }
];

describe("orchestrator", () => {
  it("loads the graph and diagnoses a payable route (router skipped)", async () => {
    const model = await loadGraph(client([], chans));
    const report = await runDiagnosis(model, probe);
    expect(report.verdict).toBe("payable");
    expect(report.routerConfirmed).toBe(false);
  });
  it("uses the router cross-check when supplied", async () => {
    const model = await loadGraph(client([], chans));
    const router = { buildRouter: vi.fn(async () => ({ router_hops: [{ channel_outpoint: "0x1" }, { channel_outpoint: "0x2" }] })) };
    const report = await runDiagnosis(model, probe, router);
    expect(report.verdict).toBe("payable");
    expect(report.routerConfirmed).toBe(true);
  });
});
