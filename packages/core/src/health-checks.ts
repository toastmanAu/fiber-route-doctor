import type { CheckResult, HealthSnapshot, RpcOutcome } from "./health-types.js";

const TOKEN_FIX = "mint a readonly token: fiber-route-doctor token generate --scope readonly --profile <name> --url <node-url>";
const SCOPE_BY_CALL = { nodeInfo: 'read("node")', listPeers: 'read("peers")', listChannels: 'read("channels")' } as const;
type CallName = keyof typeof SCOPE_BY_CALL;

export function skipReason(o: RpcOutcome): string {
  return o.ok ? "unavailable" : o.detail;
}

function outcomeEntries(s: HealthSnapshot): Array<[CallName, RpcOutcome]> {
  return Object.entries(s.outcomes) as Array<[CallName, RpcOutcome]>;
}

export function checkReachability(s: HealthSnapshot): CheckResult {
  const id = "reachability", title = "Node reachability";
  const outcomes = outcomeEntries(s).map(([, o]) => o);
  const allTransport = outcomes.every((o) => !o.ok && o.kind === "transport-error");
  if (allTransport) {
    const first = outcomes.find((o) => !o.ok);
    const detail = first && !first.ok ? first.detail : "unknown";
    return { id, title, status: "fail", reason: `no RPC call reached the node: ${detail}`, fix: "check the node is running and the URL/port are correct" };
  }
  return { id, title, status: "pass", reason: "node responded to RPC" };
}

export function checkAuth(s: HealthSnapshot): CheckResult {
  const id = "auth", title = "Authentication";
  const entries = outcomeEntries(s);
  const denied = entries.filter(([, o]) => !o.ok && o.kind === "auth-denied");
  const transport = entries.filter(([, o]) => !o.ok && o.kind === "transport-error");
  if (transport.length === entries.length) return { id, title, status: "skip", reason: "no call reached the node" };
  if (denied.length === entries.length) return { id, title, status: "fail", reason: "token rejected (Unauthorized) for all calls", fix: TOKEN_FIX };
  if (denied.length > 0) {
    const scopes = denied.map(([name]) => SCOPE_BY_CALL[name]).join(", ");
    return { id, title, status: "warn", reason: `token valid but missing scopes: ${scopes}`, fix: TOKEN_FIX };
  }
  return { id, title, status: "pass", reason: "all calls authorized" };
}

export function checkNodeInfo(s: HealthSnapshot): CheckResult {
  const id = "node-info", title = "Node info";
  if (!s.nodeInfo) return { id, title, status: "skip", reason: skipReason(s.outcomes.nodeInfo) };
  const n = s.nodeInfo;
  const reason = `fnn v${n.version} (${n.commit_hash.slice(0, 8)}), ${Number(n.channel_count)} channel(s) (${Number(n.pending_channel_count)} pending), ${Number(n.peers_count)} peer(s)`;
  return { id, title, status: "pass", reason };
}

export function checkPeers(s: HealthSnapshot): CheckResult {
  const id = "peers", title = "Peer connectivity";
  if (!s.peers) return { id, title, status: "skip", reason: skipReason(s.outcomes.listPeers) };
  if (s.peers.length === 0) {
    return { id, title, status: "fail", reason: "0 peers — node is isolated (no gossip, no routing)", fix: "connect to a peer: fiber-cli connect_peer --address <multiaddr>" };
  }
  return { id, title, status: "pass", reason: `${s.peers.length} peer(s) connected` };
}

const shortId = (h: string): string => `${h.slice(0, 10)}…`;

export function checkChannels(s: HealthSnapshot): CheckResult {
  const id = "channels", title = "Channel health";
  if (!s.channels) return { id, title, status: "skip", reason: skipReason(s.outcomes.listChannels) };
  if (s.channels.length === 0) {
    return { id, title, status: "warn", reason: "no channels — node has no liquidity", fix: "open a channel to a well-connected peer" };
  }
  const issues: string[] = [];
  const fixes: string[] = [];
  const notReady = s.channels.filter((c) => c.state.state_name !== "ChannelReady");
  for (const c of notReady) issues.push(`${shortId(c.channel_id)} in ${c.state.state_name}${c.failure_detail ? ` (${c.failure_detail})` : ""}`);
  if (notReady.length) fixes.push("wait for funding confirmation or investigate failure_detail");
  const disabled = s.channels.filter((c) => c.state.state_name === "ChannelReady" && !c.enabled);
  for (const c of disabled) issues.push(`${shortId(c.channel_id)} disabled`);
  if (disabled.length) fixes.push("re-enable via update_channel");
  const stuck = s.channels.filter((c) => c.pending_tlcs.length > 0);
  for (const c of stuck) issues.push(`${shortId(c.channel_id)} has ${c.pending_tlcs.length} pending TLC(s)`);
  if (stuck.length) fixes.push("pending TLCs may be in-flight payments; investigate if persistent");
  const ready = s.channels.filter((c) => c.state.state_name === "ChannelReady");
  const localTotal = ready.reduce((acc, c) => acc + BigInt(c.local_balance), 0n);
  if (ready.length > 0 && localTotal === 0n) {
    issues.push("zero outbound liquidity — cannot send");
    fixes.push("rebalance or fund a channel from this side");
  }
  if (issues.length) return { id, title, status: "warn", reason: issues.join("; "), fix: fixes.join("; ") };
  return { id, title, status: "pass", reason: `${ready.length} channel(s) ready, local balance ${localTotal} (smallest unit)` };
}
