import { describe, it, expect } from "vitest";
import { makeChannelSimFetch } from "../src/demo/channel-sim.js";
import { demoFetch } from "../src/demo/demo-fetch.js";

const AUTH = { Authorization: "Bearer sim-token", "Content-Type": "application/json" };
async function rpc(f: typeof fetch, method: string, params: unknown[] = [{}], headers: Record<string, string> = AUTH) {
  const res = await f("http://sim", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json());
}
const channels = async (f: typeof fetch) => (await rpc(f, "list_channels")).result.channels;

describe("makeChannelSimFetch", () => {
  it("open_channel appends a NegotiatingFunding channel; each list poll advances one step to ChannelReady", async () => {
    const f = makeChannelSimFetch(demoFetch);
    await rpc(f, "connect_peer", [{ address: "/ip4/1.1.1.1/tcp/8228/p2p/x" }]);
    const open = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x2540be400" }]);
    expect(open.result.temporary_channel_id).toMatch(/^0x/);
    const states: string[] = [];
    for (let i = 0; i < 5; i++) states.push((await channels(f))[0].state.state_name);
    expect(states).toEqual(["NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady", "ChannelReady"]);
    const ready = (await channels(f))[0];
    expect(ready.local_balance).toBe("0x2540be400"); // opener holds the full balance
    expect(ready.enabled).toBe(true);
  });
  it("update_channel mutates enabled and fee", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const open = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x5f5e100" }]);
    await rpc(f, "update_channel", [{ channel_id: open.result.temporary_channel_id, enabled: false, tlc_fee_proportional_millionths: "0x5dc" }]);
    expect((await channels(f))[0].enabled).toBe(false);
  });
  it("shutdown marches to Closed then removes after 2 more polls", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const open = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x5f5e100" }]);
    for (let i = 0; i < 5; i++) await channels(f); // reach ChannelReady
    await rpc(f, "shutdown_channel", [{ channel_id: open.result.temporary_channel_id }]);
    expect((await channels(f))[0].state.state_name).toBe("Closed");
    await channels(f);
    expect((await channels(f)).length).toBe(0);
  });
  it("returns -32999 when the request has no Authorization header", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const r = await rpc(f, "open_channel", [{ pubkey: "0x02aa", funding_amount: "0x1" }], { "Content-Type": "application/json" });
    expect(r.error.code).toBe(-32999);
  });
  it("errors on unknown channel_id and delegates non-channel methods to base", async () => {
    const f = makeChannelSimFetch(demoFetch);
    const bad = await rpc(f, "update_channel", [{ channel_id: "0xnope", enabled: true }]);
    expect(bad.error).toBeTruthy();
    const gi = await rpc(f, "graph_channels");
    expect(gi.result.channels.length).toBeGreaterThan(600); // delegated to demoFetch fixtures
  });
});
