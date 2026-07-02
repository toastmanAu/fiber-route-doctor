import { assetIdOf } from "./asset.js";
import type { RpcChannel } from "./health-types.js";
import type { AssetLiquidity, ChannelLiquidity, LiquidityReport, LiquiditySnapshot, PeerGroup, SkewFlag } from "./liquidity-types.js";

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

const READY_STATE = "ChannelReady";

function isActive(c: ChannelLiquidity): boolean {
  return c.state === READY_STATE && c.enabled;
}

const maxBig = (values: bigint[]): bigint => values.reduce((m, v) => (v > m ? v : m), 0n);
const sumBig = (values: bigint[]): bigint => values.reduce((s, v) => s + v, 0n);

export const SKEW_DRAINED_PCT = 10;
export const SKEW_FULL_PCT = 90;

function buildSkews(channels: ChannelLiquidity[]): SkewFlag[] {
  const out: SkewFlag[] = [];
  for (const c of channels.filter(isActive)) {
    const local = BigInt(c.local), total = BigInt(c.local) + BigInt(c.remote);
    if (total === 0n) continue;
    // localRatioPct is the floored display value; flag decisions use exact bigint
    // cross-multiplication so e.g. 90.7% local isn't lost to flooring to 90 and missed.
    const pct = Number((local * 100n) / total);
    if (local * 100n < total * BigInt(SKEW_DRAINED_PCT)) out.push({ channelId: c.channelId, asset: c.asset, localRatioPct: pct, flag: "drained" });
    else if (local * 100n > total * BigInt(SKEW_FULL_PCT)) out.push({ channelId: c.channelId, asset: c.asset, localRatioPct: pct, flag: "full" });
  }
  return out;
}

function buildPeerGroups(channels: ChannelLiquidity[]): PeerGroup[] {
  const byPeer = new Map<string, ChannelLiquidity[]>();
  for (const c of channels.filter(isActive)) {
    const group = byPeer.get(c.peer) ?? [];
    group.push(c);
    byPeer.set(c.peer, group);
  }
  return [...byPeer.entries()]
    .map(([peer, group]) => ({
      peer,
      channelCount: group.length,
      outbound: sumBig(group.map((c) => BigInt(c.local))).toString(),
      inbound: sumBig(group.map((c) => BigInt(c.remote))).toString()
    }))
    .sort((a, b) => {
      const d = BigInt(b.outbound) - BigInt(a.outbound);
      return d > 0n ? 1 : d < 0n ? -1 : a.peer < b.peer ? -1 : 1;
    });
}

function sortAssetKeys(keys: string[]): string[] {
  return keys.sort((a, b) => (a === "CKB" ? -1 : b === "CKB" ? 1 : a < b ? -1 : 1));
}

export function computeLiquidityReport(snapshot: LiquiditySnapshot): LiquidityReport {
  const byAsset = new Map<string, ChannelLiquidity[]>();
  for (const c of snapshot.channels) {
    const group = byAsset.get(c.asset) ?? [];
    group.push(c);
    byAsset.set(c.asset, group);
  }
  const assets: AssetLiquidity[] = sortAssetKeys([...byAsset.keys()]).map((asset) => {
    const all = byAsset.get(asset)!;
    const active = all.filter(isActive);
    return {
      asset,
      channelCount: all.length,
      readyCount: active.length,
      outbound: sumBig(active.map((c) => BigInt(c.local))).toString(),
      inbound: sumBig(active.map((c) => BigInt(c.remote))).toString(),
      maxSend: maxBig(active.map((c) => BigInt(c.local))).toString(),
      maxReceive: maxBig(active.map((c) => BigInt(c.remote))).toString(),
      inFlightOut: sumBig(active.map((c) => BigInt(c.offeredHold))).toString(),
      inFlightIn: sumBig(active.map((c) => BigInt(c.receivedHold))).toString()
    };
  });
  const activeCount = snapshot.channels.filter(isActive).length;
  return {
    ts: snapshot.ts,
    assets,
    skews: buildSkews(snapshot.channels),
    peers: buildPeerGroups(snapshot.channels),
    totalChannels: snapshot.channels.length,
    excludedChannels: snapshot.channels.length - activeCount
  };
}
