import { collectHealthSnapshot, type HealthClient } from "./health-client.js";
import { checkAuth, checkChannels, checkNodeInfo, checkPeers, checkReachability } from "./health-checks.js";
import type { CheckResult, CheckStatus, HealthReport, HealthSnapshot, NodeSummary, RpcNodeInfo } from "./health-types.js";

const CHECKS: Array<(s: HealthSnapshot) => CheckResult> = [checkReachability, checkAuth, checkNodeInfo, checkPeers, checkChannels];

export function runHealthChecks(s: HealthSnapshot): CheckResult[] {
  return CHECKS.map((c) => c(s));
}

const RANK: Record<CheckStatus, number> = { fail: 3, warn: 2, pass: 1, skip: 0 };

export function worstStatus(checks: readonly CheckResult[]): CheckStatus {
  const ranked = checks.filter((c) => c.status !== "skip");
  if (ranked.length === 0) return "fail";
  return ranked.reduce((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), "pass" as CheckStatus);
}

export function summarizeNode(n?: RpcNodeInfo): NodeSummary | undefined {
  if (!n) return undefined;
  return {
    version: n.version, pubkey: n.pubkey, nodeName: n.node_name ?? null, addresses: n.addresses,
    chainHash: n.chain_hash, channelCount: Number(n.channel_count),
    pendingChannelCount: Number(n.pending_channel_count), peersCount: Number(n.peers_count)
  };
}

export async function runHealthProbe(client: HealthClient): Promise<HealthReport> {
  const snapshot = await collectHealthSnapshot(client);
  const checks = runHealthChecks(snapshot);
  return { checks, verdict: worstStatus(checks), node: summarizeNode(snapshot.nodeInfo) };
}
