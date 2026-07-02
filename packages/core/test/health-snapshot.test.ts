import { describe, it, expect, vi } from "vitest";
import { HealthClient, collectHealthSnapshot } from "../src/index.js";

const NODE_INFO = {
  version: "0.9.0-rc5", commit_hash: "abcdef12", pubkey: "0x03aa", node_name: null,
  addresses: [], chain_hash: "0x11", channel_count: "0x1", pending_channel_count: "0x0", peers_count: "0x1"
};

/** Route each JSON-RPC method to a per-method responder. */
function routedFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return routes[body.method]();
  });
}
const ok = (id: number, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 });
const unauthorized = (id: number) => new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32999, message: "Unauthorized" } }), { status: 200 });

describe("collectHealthSnapshot", () => {
  it("captures data and ok outcomes when all calls succeed", async () => {
    const fetchImpl = routedFetch({
      node_info: () => ok(1, NODE_INFO),
      list_peers: () => ok(2, { peers: [{ pubkey: "0x02bb", address: "/ip4/1.1.1.1/tcp/1" }] }),
      list_channels: () => ok(3, { channels: [] })
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.nodeInfo?.version).toBe("0.9.0-rc5");
    expect(s.peers).toHaveLength(1);
    expect(s.channels).toEqual([]);
    expect(s.outcomes).toEqual({ nodeInfo: { ok: true }, listPeers: { ok: true }, listChannels: { ok: true } });
  });
  it("classifies -32999 Unauthorized as auth-denied, leaves data undefined", async () => {
    const fetchImpl = routedFetch({
      node_info: () => ok(1, NODE_INFO),
      list_peers: () => unauthorized(2),
      list_channels: () => unauthorized(3)
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.peers).toBeUndefined();
    expect(s.outcomes.listPeers).toMatchObject({ ok: false, kind: "auth-denied" });
    expect(s.outcomes.nodeInfo).toEqual({ ok: true });
  });
  it("classifies network throws and HTTP errors as transport-error", async () => {
    const fetchImpl = routedFetch({
      node_info: () => { throw new Error("ECONNREFUSED"); },
      list_peers: () => new Response("bad gateway", { status: 502 }),
      list_channels: () => { throw new Error("ECONNREFUSED"); }
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.outcomes.nodeInfo).toMatchObject({ ok: false, kind: "transport-error", detail: expect.stringContaining("ECONNREFUSED") });
    expect(s.outcomes.listPeers).toMatchObject({ ok: false, kind: "transport-error", detail: expect.stringContaining("502") });
  });
  it("classifies HTTP 401 (reverse-proxy auth) as auth-denied, not transport-error", async () => {
    const fetchImpl = routedFetch({
      node_info: () => new Response("unauthorized", { status: 401 }),
      list_peers: () => new Response("unauthorized", { status: 401 }),
      list_channels: () => new Response("unauthorized", { status: 401 })
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.outcomes.nodeInfo).toMatchObject({ ok: false, kind: "auth-denied" });
    expect(s.outcomes.listPeers).toMatchObject({ ok: false, kind: "auth-denied" });
    expect(s.outcomes.listChannels).toMatchObject({ ok: false, kind: "auth-denied" });
  });
  it("classifies HTTP 403 as auth-denied and HTTP 500 as transport-error", async () => {
    const fetchImpl = routedFetch({
      node_info: () => new Response("forbidden", { status: 403 }),
      list_peers: () => new Response("server error", { status: 500 }),
      list_channels: () => new Response("forbidden", { status: 403 })
    });
    const s = await collectHealthSnapshot(new HealthClient({ url: "http://n/", fetchImpl }));
    expect(s.outcomes.nodeInfo).toMatchObject({ ok: false, kind: "auth-denied" });
    expect(s.outcomes.listPeers).toMatchObject({ ok: false, kind: "transport-error" });
    expect(s.outcomes.listChannels).toMatchObject({ ok: false, kind: "auth-denied" });
  });
});
