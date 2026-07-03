import { describe, it, expect, vi } from "vitest";
import { GraphClient, RpcHttpError } from "../src/index.js";

function mockFetch(result: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

/** Sequenced mock: returns one result per call, in order, matching the JSON-RPC id from the request. */
function mockFetchSequence(results: unknown[]) {
  let call = 0;
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const result = results[Math.min(call, results.length - 1)];
    call++;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

function stubChannel(i: number) {
  return { channel_outpoint: `0x${i}`, node1: "0xA", node2: "0xB", capacity: "0x64", funding_udt_type_script: null, update_info_of_node1: null, update_info_of_node2: null };
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

  it("paginates graph_channels across a full page + last_cursor, combining results from both calls", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => stubChannel(i));
    const page2 = Array.from({ length: 150 }, (_, i) => stubChannel(500 + i));
    const fetchImpl = mockFetchSequence([
      { channels: page1, last_cursor: "0xc1" },
      { channels: page2 },
    ]);
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    const channels = await client.graphChannels();
    expect(channels).toHaveLength(650);
    expect(fetchImpl.mock.calls).toHaveLength(2);
    const secondCallBody = JSON.parse(String(fetchImpl.mock.calls[1][1]!.body));
    expect(secondCallBody.params).toEqual([{ after: "0xc1" }]);
  });

  it("stops after one page when the first page is not full, even if last_cursor is present", async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => stubChannel(i));
    const fetchImpl = mockFetchSequence([{ channels: page1, last_cursor: "0xc1" }]);
    const client = new GraphClient({ url: "http://node.local/rpc", fetchImpl });
    const channels = await client.graphChannels();
    expect(channels).toHaveLength(200);
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });
});
