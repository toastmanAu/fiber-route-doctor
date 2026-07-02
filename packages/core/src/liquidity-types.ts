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

/**
 * `balanceDeltas` and `assetDeltas` are NOT measuring the same thing, and can diverge:
 *
 * - `balanceDeltas` compares raw local/remote balances across ALL matched channels (present in
 *   both snapshots by channelId), regardless of state or enabled flag.
 * - `assetDeltas` compares `outbound`/`inbound` from `computeLiquidityReport`, which only sums
 *   USABLE liquidity — channels that are ChannelReady AND enabled — per the same `isActive` filter
 *   used for `LiquidityReport.assets`.
 *
 * A channel whose balances are unchanged but flips enabled -> disabled (or ready -> non-ready)
 * between snapshots will therefore move `assetDeltas` (its capacity drops out of the usable total)
 * while contributing NOTHING to `balanceDeltas` (no local/remote change to report). Don't treat
 * `assetDeltas` as a sum of `balanceDeltas` — they're independently derived.
 */
export interface LiquidityDiff {
  fromTs: string;
  toTs: string;
  opened: ChannelLiquidity[];
  closed: ChannelLiquidity[];
  balanceDeltas: Array<{ channelId: Hex; asset: AssetId; localDelta: string; remoteDelta: string }>;
  assetDeltas: Array<{ asset: AssetId; outboundDelta: string; inboundDelta: string }>;
}
