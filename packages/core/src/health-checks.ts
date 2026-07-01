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
