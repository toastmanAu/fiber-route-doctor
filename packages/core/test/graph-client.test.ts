import { describe, it, expect, vi } from "vitest";
import { GraphClient, RpcHttpError } from "../src/index.js";

function mockFetch(result: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

describe("GraphClient", () => {
  it("posts a graph_channels JSON-RPC call and returns the result array", async () => {
    const fetchImpl = mockFetch([{ channel_outpoint: "0x1", node1: "0xA", node2: "0xB", capacity: "0x64", funding_udt_type_script: null, update_info_of_node1: null, update_info_of_node2: null }]);
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    const channels = await client.graphChannels();
    expect(channels).toHaveLength(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(init!.body)).method).toBe("graph_channels");
  });
  it("adds an Authorization header when a biscuit is provided", async () => {
    const fetchImpl = mockFetch([]);
    const client = new GraphClient({ url: "http://node.local/rpc", biscuit: "tok123", fetchImpl });
    await client.graphNodes();
    const [, init] = fetchImpl.mock.calls[0];
    expect((init!.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok123");
  });
  it("throws when the RPC returns an error object", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "boom" } }), { status: 200 }));
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    await expect(client.graphNodes()).rejects.toThrow(/boom/);
  });
  it("throws a typed RpcHttpError carrying the status when the response is not ok", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    await expect(client.graphNodes()).rejects.toThrow(/RPC graph_nodes HTTP 401/);
    try {
      await client.graphNodes();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RpcHttpError);
      expect((e as RpcHttpError).status).toBe(401);
    }
  });
});
