export type Hex = string; // 0x-prefixed

/** "CKB" = native asset; otherwise a stable hex key derived from the UDT type script. */
export type AssetId = "CKB" | Hex;
export const CKB_ASSET: AssetId = "CKB";

export interface UdtScript { code_hash: Hex; hash_type: string; args: Hex; }

// ---- Raw RPC shapes (Fiber v0.9, snake_case) ----
export interface RpcChannelUpdateInfo {
  timestamp: Hex;
  enabled: boolean;
  fee_rate: Hex;           // u64 hex
  tlc_expiry_delta: Hex;   // u64 hex, milliseconds
  tlc_minimum_value: Hex;  // u128 hex
  tlc_maximum_value?: Hex; // u128 hex, optional
}
export interface RpcChannelInfo {
  channel_outpoint: Hex;
  node1: Hex;
  node2: Hex;
  capacity: Hex;                       // u128 hex
  funding_udt_type_script: UdtScript | null;
  update_info_of_node1: RpcChannelUpdateInfo | null; // node1 -> node2
  update_info_of_node2: RpcChannelUpdateInfo | null; // node2 -> node1
}
export interface RpcGraphNode {
  pubkey: Hex;
  node_name?: string | null;
  addresses: string[];
  timestamp: Hex;
}

// ---- Normalized model ----
export interface DirectedEdge {
  channelOutpoint: Hex;
  from: Hex;
  to: Hex;
  asset: AssetId;
  capacity: bigint;
  enabled: boolean;
  feeRate: bigint;         // per the channel's advertised forwarding fee rate
  tlcExpiryDelta: bigint;  // milliseconds
  tlcMinimumValue: bigint;
  tlcMaximumValue: bigint | null;
}
export interface GraphNodeInfo { pubkey: Hex; name: string | null; addresses: string[]; }

// ---- Probe & report ----
export interface ProbeRequest {
  source: Hex;
  target: Hex;
  amount: bigint;
  asset: AssetId;
  maxFeeRate?: bigint;      // per-thousand ceiling, default 5 (0.5%)
  maxTotalExpiry?: bigint;  // ms ceiling, optional
}

export type Verdict = "payable" | "risky" | "blocked";

export type ReasonCause =
  | "target_absent"
  | "no_asset_channel"
  | "asset_mismatch"
  | "channel_disabled"
  | "below_min_value"
  | "above_max_value"
  | "insufficient_capacity"
  | "expiry_over_limit"
  | "fee_over_limit"
  | "router_declined";

export interface Reason {
  cause: ReasonCause;
  channelOutpoint?: Hex;
  detail: string;
}
export interface Fix { detail: string; }

export interface ReportHop {
  index: number;
  from: Hex;
  to: Hex;
  channelOutpoint: Hex;
  asset: AssetId;
  fee: bigint;
  expiryDelta: bigint;
}

export interface RouteReport {
  verdict: Verdict;
  probe: ProbeRequest;
  path: ReportHop[];
  totalFee: bigint;
  totalExpiry: bigint;
  reasons: Reason[];
  fixes: Fix[];
  routerConfirmed: boolean;
}

/** Result of the optional build_router cross-check. */
export type ProbeResult =
  | { kind: "router_path"; channelOutpoints: Hex[] }
  | { kind: "router_error"; message: string }
  | { kind: "skipped" };
