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
  tlc_maximum_value?: Hex; // u128 hex; pre-0.9 nodes only — absent on fnn >= 0.9
  outbound_liquidity?: Hex | null; // u128 hex; fnn >= 0.9 (replaces tlc_maximum_value)
}
export interface RpcChannelInfo {
  channel_outpoint: Hex;
  node1: Hex;
  node2: Hex;
  capacity: Hex;                       // u128 hex
  udt_type_script: UdtScript | null;
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
  readonly channelOutpoint: Hex;
  readonly from: Hex;
  readonly to: Hex;
  readonly asset: AssetId;
  readonly capacity: bigint;
  readonly enabled: boolean;
  readonly feeRate: bigint;         // per the channel's advertised forwarding fee rate
  readonly tlcExpiryDelta: bigint;  // milliseconds
  readonly tlcMinimumValue: bigint;
  readonly tlcMaximumValue: bigint | null;
}
export interface GraphNodeInfo { readonly pubkey: Hex; readonly name: string | null; readonly addresses: readonly string[]; }

// ---- Probe & report ----
export interface ProbeRequest {
  readonly source: Hex;
  readonly target: Hex;
  readonly amount: bigint;
  readonly asset: AssetId;
  readonly maxFeeRate?: bigint;      // per-thousand ceiling, default 5 (0.5%)
  readonly maxTotalExpiry?: bigint;  // ms ceiling, optional
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
  readonly cause: ReasonCause;
  readonly channelOutpoint?: Hex;
  readonly detail: string;
}
export interface Fix { readonly detail: string; }

export interface ReportHop {
  readonly index: number;
  readonly from: Hex;
  readonly to: Hex;
  readonly channelOutpoint: Hex;
  readonly asset: AssetId;
  readonly fee: bigint;
  readonly expiryDelta: bigint;
}

export interface RouteReport {
  readonly verdict: Verdict;
  readonly probe: ProbeRequest;
  readonly path: readonly ReportHop[];
  readonly totalFee: bigint;
  readonly totalExpiry: bigint;
  readonly reasons: readonly Reason[];
  readonly fixes: readonly Fix[];
  readonly routerConfirmed: boolean;
}

/** Result of the optional build_router cross-check. */
export type ProbeResult =
  | { kind: "router_path"; readonly channelOutpoints: readonly Hex[] }
  | { kind: "router_error"; readonly message: string }
  | { kind: "skipped" };
