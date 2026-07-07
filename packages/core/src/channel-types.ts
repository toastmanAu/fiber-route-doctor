import type { Hex, UdtScript } from "./types.js";

// ---- fnn v0.9 channel-management wire shapes (crates/fiber-json-types/src/{peer,channel}.rs) ----
/** connect_peer — at least one of address/pubkey must be set (node contract). */
export interface RpcConnectPeerParams { address?: string; pubkey?: Hex; save?: boolean; }
export interface RpcOpenChannelParams {
  pubkey: Hex;
  funding_amount: Hex;                    // u128 hex, shannons
  public?: boolean;                       // node default: true
  funding_fee_rate?: Hex;                 // u64 hex
  commitment_fee_rate?: Hex;              // u64 hex
  tlc_fee_proportional_millionths?: Hex;  // u128 hex
}
export interface RpcOpenChannelResult { temporary_channel_id: Hex; }
export interface RpcUpdateChannelParams {
  channel_id: Hex;
  enabled?: boolean;
  tlc_expiry_delta?: Hex;                 // u64 hex, ms
  tlc_minimum_value?: Hex;                // u128 hex
  tlc_fee_proportional_millionths?: Hex;  // u128 hex
}
export interface RpcShutdownChannelParams {
  channel_id: Hex;
  close_script?: UdtScript;
  fee_rate?: Hex;                         // u64 hex, shannons/KB
  force?: boolean;
}
