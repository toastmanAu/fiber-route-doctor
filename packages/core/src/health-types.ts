import type { Hex, UdtScript } from "./types.js";

// ---- Raw RPC shapes (Fiber v0.9, snake_case; uN values are hex strings) ----
export interface RpcNodeInfo {
  version: string;
  commit_hash: string;
  pubkey: Hex;
  node_name?: string | null;
  addresses: string[];
  chain_hash: Hex;
  channel_count: Hex;         // u32 hex
  pending_channel_count: Hex; // u32 hex
  peers_count: Hex;           // u32 hex
}
export interface RpcPeerInfo { pubkey: Hex; address: string; }
/** serde adjacently-tagged: { state_name: "ChannelReady" | "NegotiatingFunding" | ..., state_flags?: string } */
export interface RpcChannelState { state_name: string; state_flags?: unknown; }
export interface RpcChannel {
  channel_id: Hex;
  state: RpcChannelState;
  local_balance: Hex;         // u128 hex
  remote_balance: Hex;        // u128 hex
  offered_tlc_balance: Hex;   // u128 hex
  received_tlc_balance: Hex;  // u128 hex
  enabled: boolean;
  is_public: boolean;
  pending_tlcs: unknown[];
  created_at: Hex;            // u64 hex ms
  funding_udt_type_script?: UdtScript | null;
  failure_detail?: string | null;
}

// ---- Snapshot & report ----
export type RpcOutcomeKind = "auth-denied" | "transport-error";
export type RpcOutcome = { ok: true } | { ok: false; kind: RpcOutcomeKind; detail: string };
export interface HealthSnapshot {
  nodeInfo?: RpcNodeInfo;
  peers?: RpcPeerInfo[];
  channels?: RpcChannel[];
  outcomes: { nodeInfo: RpcOutcome; listPeers: RpcOutcome; listChannels: RpcOutcome };
}
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export interface CheckResult { id: string; title: string; status: CheckStatus; reason: string; fix?: string; }
export interface NodeSummary {
  version: string; pubkey: Hex; nodeName: string | null; addresses: readonly string[];
  chainHash: Hex; channelCount: number; pendingChannelCount: number; peersCount: number;
}
export interface HealthReport { checks: readonly CheckResult[]; verdict: CheckStatus; node?: NodeSummary; }
