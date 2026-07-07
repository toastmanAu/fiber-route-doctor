import { describe, it, expect } from "vitest";
import { watchChannelState, type RpcChannel } from "../src/index.js";

const ch = (over: Partial<RpcChannel>): RpcChannel => ({
  channel_id: "0xc1", pubkey: "0x02aa", state: { state_name: "NegotiatingFunding" },
  local_balance: "0x0", remote_balance: "0x0", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
  enabled: false, is_public: true, pending_tlcs: [], created_at: "0x1", ...over
});
const seq = (...pages: RpcChannel[][]) => {
  let i = 0;
  return { listChannels: async () => pages[Math.min(i++, pages.length - 1)] };
};
const opts = { delayFn: async () => {}, delayMs: 0 };

describe("watchChannelState", () => {
  it("resolves ready when the channel reaches ChannelReady", async () => {
    const src = seq([ch({})], [ch({ state: { state_name: "AwaitingChannelReady" } })], [ch({ state: { state_name: "ChannelReady" }, enabled: true })]);
    const r = await watchChannelState(src, "0xc1", opts);
    expect(r.outcome).toBe("ready");
    expect(r.channel?.state.state_name).toBe("ChannelReady");
    expect(r.polls).toBe(3);
  });
  it("reports failure_detail as a terminal failure", async () => {
    const src = seq([ch({ failure_detail: "funding tx rejected" })]);
    const r = await watchChannelState(src, "0xc1", opts);
    expect(r.outcome).toBe("failed");
    expect(r.failureDetail).toBe("funding tx rejected");
  });
  it("treats a previously-seen channel disappearing as failure", async () => {
    const src = seq([ch({})], []);
    const r = await watchChannelState(src, "0xc1", opts);
    expect(r.outcome).toBe("failed");
    expect(r.failureDetail).toMatch(/disappeared/);
  });
  it("times out when the poll budget is exhausted", async () => {
    const src = seq([ch({})]);
    const r = await watchChannelState(src, "0xc1", { ...opts, maxPolls: 2 });
    expect(r.outcome).toBe("timeout");
    expect(r.polls).toBe(2);
  });
  it("resolves a temporary id to the newest channel with the counterparty pubkey", async () => {
    const real = ch({ channel_id: "0xREAL", created_at: "0x9", state: { state_name: "ChannelReady" } });
    const older = ch({ channel_id: "0xOLD", created_at: "0x2", state: { state_name: "ChannelReady" } });
    const source = { listChannels: async () => [older, real] };
    const r = await watchChannelState(source, "0xTEMP", { ...opts, counterpartyPubkey: "0x02aa" });
    expect(r.outcome).toBe("ready");
    expect(r.channel?.channel_id).toBe("0xREAL");
  });
  it("does NOT fall back to pubkey matching without counterpartyPubkey (unknown temp id times out)", async () => {
    const source = { listChannels: async () => [ch({ channel_id: "0xOTHER" })] };
    const r = await watchChannelState(source, "0xTEMP", { ...opts, maxPolls: 2 });
    expect(r.outcome).toBe("timeout");
  });
});
