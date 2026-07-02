import type { AssetId, Hex } from "./types.js";

/** One channel's liquidity as observed at snapshot time. Balances are decimal strings. */
export interface ChannelLiquidity {
  channelId: Hex;
  peer: Hex;
  asset: AssetId;
  state: string;
  enabled: boolean;
  isPublic: boolean;
  local: string;
  remote: string;
  offeredHold: string;
  receivedHold: string;
  createdAt: string; // ms since epoch, decimal string
}

/** Raw-first persisted artifact: plain JSON-safe, analytics computed at read time. */
export interface LiquiditySnapshot { ts: string; nodeUrl: string; channels: ChannelLiquidity[]; }

export interface SnapshotStore {
  list(): string[];
  get(name: string): LiquiditySnapshot | undefined;
  put(s: LiquiditySnapshot): string;
  latest(): LiquiditySnapshot | undefined;
}

export interface AssetLiquidity {
  asset: AssetId;
  channelCount: number;
  readyCount: number;
  outbound: string;
  inbound: string;
  maxSend: string;    // largest single ready+enabled channel's local balance
  maxReceive: string; // largest single ready+enabled channel's remote balance
  inFlightOut: string;
  inFlightIn: string;
}
export interface SkewFlag { channelId: Hex; asset: AssetId; localRatioPct: number; flag: "drained" | "full"; }
export interface PeerGroup { peer: Hex; channelCount: number; outbound: string; inbound: string; }
export interface LiquidityReport {
  ts: string;
  assets: AssetLiquidity[];
  skews: SkewFlag[];
  peers: PeerGroup[];
  totalChannels: number;
  excludedChannels: number;
}

export interface LiquidityDiff {
  fromTs: string;
  toTs: string;
  opened: ChannelLiquidity[];
  closed: ChannelLiquidity[];
  balanceDeltas: Array<{ channelId: Hex; asset: AssetId; localDelta: string; remoteDelta: string }>;
  assetDeltas: Array<{ asset: AssetId; outboundDelta: string; inboundDelta: string }>;
}
