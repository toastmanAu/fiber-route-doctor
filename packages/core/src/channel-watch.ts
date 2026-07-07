import type { Hex } from "./types.js";
import type { RpcChannel } from "./health-types.js";

export interface ChannelListSource { listChannels(): Promise<RpcChannel[]>; }
export interface WatchOptions {
  maxPolls?: number;                 // default 60
  delayMs?: number;                  // default 5000
  counterpartyPubkey?: Hex;          // enables temporary-id resolution
  onTick?: (polls: number, stateName?: string) => void;
  delayFn?: (ms: number) => Promise<void>;
}
export interface WatchResult {
  outcome: "ready" | "failed" | "timeout";
  channel?: RpcChannel;
  polls: number;
  failureDetail?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls list_channels until the channel is ChannelReady, terminally failed, or the budget runs out.
 * open_channel returns a TEMPORARY id; when `counterpartyPubkey` is given and the id is not found,
 * the newest (highest created_at) channel with that counterparty is watched instead.
 * Limitation (documented in the spec): concurrent opens to the same peer can ambiguate — open serially.
 */
export async function watchChannelState(source: ChannelListSource, channelId: Hex, opts: WatchOptions = {}): Promise<WatchResult> {
  const { maxPolls = 60, delayMs = 5000, counterpartyPubkey, onTick, delayFn = sleep } = opts;
  let resolvedId: Hex | undefined;
  let seen = false;
  for (let polls = 1; polls <= maxPolls; polls++) {
    const channels = await source.listChannels();
    let target = channels.find((c) => c.channel_id === (resolvedId ?? channelId));
    if (!target && !resolvedId && counterpartyPubkey) {
      const candidates = channels.filter((c) => c.pubkey === counterpartyPubkey);
      if (candidates.length > 0) {
        target = candidates.reduce((a, b) => (BigInt(a.created_at) >= BigInt(b.created_at) ? a : b));
        resolvedId = target.channel_id;
      }
    }
    onTick?.(polls, target?.state.state_name);
    if (target) {
      seen = true;
      if (target.failure_detail) return { outcome: "failed", channel: target, polls, failureDetail: target.failure_detail };
      if (target.state.state_name === "ChannelReady") return { outcome: "ready", channel: target, polls };
    } else if (seen) {
      return { outcome: "failed", polls, failureDetail: "channel disappeared from list_channels before becoming ready" };
    }
    if (polls < maxPolls) await delayFn(delayMs);
  }
  return { outcome: "timeout", polls: maxPolls };
}
