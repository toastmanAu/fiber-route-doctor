import type { ChannelLiquidity, LiquiditySnapshot, RpcChannel } from "../src/index.js";

export function rpcChan(over: Partial<RpcChannel> = {}): RpcChannel {
  return {
    channel_id: "0x" + "ab".repeat(32), pubkey: "0x02aa", state: { state_name: "ChannelReady" },
    local_balance: "0x3e8", remote_balance: "0x7d0", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
    enabled: true, is_public: true, pending_tlcs: [], created_at: "0x1",
    funding_udt_type_script: null, failure_detail: null, ...over
  };
}

export function liq(over: Partial<ChannelLiquidity> = {}): ChannelLiquidity {
  return {
    channelId: "0x01", peer: "0x02aa", asset: "CKB", state: "ChannelReady",
    enabled: true, isPublic: true, local: "1000", remote: "2000",
    offeredHold: "0", receivedHold: "0", createdAt: "1", ...over
  };
}

export function snapOf(channels: ChannelLiquidity[]): LiquiditySnapshot {
  return { ts: "2026-07-03T00:00:00.000Z", nodeUrl: "http://n:8231", channels };
}
