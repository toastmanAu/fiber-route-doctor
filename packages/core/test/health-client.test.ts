import { describe, it, expect, vi } from "vitest";
import { HealthClient, RpcMethodError } from "../src/index.js";

function mockFetch(result: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

const NODE_INFO = {
  version: "0.9.0-rc5", commit_hash: "abcdef1234567890", pubkey: "0x03aa", node_name: "dt",
  addresses: ["/ip4/1.2.3.4/tcp/8228"], chain_hash: "0x11", channel_count: "0x2", pending_channel_count: "0x0", peers_count: "0x3"
};

describe("HealthClient", () => {
  it("calls node_info and returns the result", async () => {
    const fetchImpl = mockFetch(NODE_INFO);
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const info = await c.nodeInfo();
    expect(info.version).toBe("0.9.0-rc5");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body)).method).toBe("node_info");
  });
  it("calls list_peers and unwraps the peers array", async () => {
    const fetchImpl = mockFetch({ peers: [{ pubkey: "0x02bb", address: "/ip4/1.2.3.4/tcp/8228" }] });
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const peers = await c.listPeers();
    expect(peers).toHaveLength(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body)).method).toBe("list_peers");
  });
  it("calls list_channels with empty params and unwraps channels", async () => {
    const fetchImpl = mockFetch({ channels: [] });
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const channels = await c.listChannels();
    expect(channels).toEqual([]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]!.body));
    expect(body.method).toBe("list_channels");
    expect(body.params).toEqual([{}]);
  });
  it("throws RpcMethodError carrying the JSON-RPC error code", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32999, message: "Unauthorized" } }), { status: 200 }));
    const c = new HealthClient({ url: "http://n/", fetchImpl });
    const err = await c.nodeInfo().catch((e) => e);
    expect(err).toBeInstanceOf(RpcMethodError);
    expect((err as RpcMethodError).code).toBe(-32999);
    expect(String(err)).toMatch(/Unauthorized/);
  });
});
