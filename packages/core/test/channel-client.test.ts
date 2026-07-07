import { describe, it, expect } from "vitest";
import { ChannelClient, RpcMethodError } from "../src/index.js";

function capture(result: unknown = null) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body));
const header = (c: { init: RequestInit }, k: string) => (c.init.headers as Record<string, string>)[k];

describe("ChannelClient", () => {
  it("connect_peer sends params and the Authorization header", async () => {
    const { calls, fetchImpl } = capture();
    const c = new ChannelClient({ url: "http://n", biscuit: "tok", fetchImpl });
    await c.connectPeer({ address: "/ip4/1.2.3.4/tcp/8228/p2p/Qm..", save: true });
    expect(body(calls[0]).method).toBe("connect_peer");
    expect(body(calls[0]).params).toEqual([{ address: "/ip4/1.2.3.4/tcp/8228/p2p/Qm..", save: true }]);
    expect(header(calls[0], "Authorization")).toBe("Bearer tok");
  });
  it("open_channel returns the temporary_channel_id", async () => {
    const { fetchImpl } = capture({ temporary_channel_id: "0xabc" });
    const c = new ChannelClient({ url: "http://n", fetchImpl });
    const r = await c.openChannel({ pubkey: "0x02aa", funding_amount: "0x174876e800" });
    expect(r.temporary_channel_id).toBe("0xabc");
  });
  it("update_channel and shutdown_channel send their params", async () => {
    const { calls, fetchImpl } = capture();
    const c = new ChannelClient({ url: "http://n", fetchImpl });
    await c.updateChannel({ channel_id: "0xc1", enabled: false, tlc_fee_proportional_millionths: "0x3e8" });
    await c.shutdownChannel({ channel_id: "0xc1", force: true });
    expect(body(calls[0]).method).toBe("update_channel");
    expect(body(calls[0]).params[0].enabled).toBe(false);
    expect(body(calls[1]).method).toBe("shutdown_channel");
    expect(body(calls[1]).params[0].force).toBe(true);
  });
  it("surfaces node method errors via the existing RpcMethodError taxonomy", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32999, message: "Unauthorized" } }), { status: 200 })) as unknown as typeof fetch;
    const c = new ChannelClient({ url: "http://n", fetchImpl });
    await expect(c.connectPeer({ pubkey: "0x02aa" })).rejects.toBeInstanceOf(RpcMethodError);
  });
});
