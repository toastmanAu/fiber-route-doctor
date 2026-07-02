import { assetIdOf } from "./asset.js";
import type { RpcChannel } from "./health-types.js";
import type { ChannelLiquidity, LiquiditySnapshot } from "./liquidity-types.js";

const dec = (hex: string): string => BigInt(hex).toString();

export function buildLiquiditySnapshot(channels: RpcChannel[], nodeUrl: string, ts: string): LiquiditySnapshot {
  const normalized: ChannelLiquidity[] = channels.map((c) => ({
    channelId: c.channel_id,
    peer: c.pubkey,
    asset: assetIdOf(c.funding_udt_type_script ?? null),
    state: c.state.state_name,
    enabled: c.enabled,
    isPublic: c.is_public,
    local: dec(c.local_balance),
    remote: dec(c.remote_balance),
    offeredHold: dec(c.offered_tlc_balance),
    receivedHold: dec(c.received_tlc_balance),
    createdAt: dec(c.created_at)
  }));
  return { ts, nodeUrl, channels: normalized };
}
