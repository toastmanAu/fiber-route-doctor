import type { CheckStatus, HealthReport } from "./health-types.js";

const ICON: Record<CheckStatus, string> = { pass: "✓", warn: "⚠", fail: "✗", skip: "−" };

export function formatHealthText(report: HealthReport): string {
  const lines: string[] = [`Fiber node health — verdict: ${report.verdict.toUpperCase()}`];
  if (report.node) {
    const n = report.node;
    lines.push(`node: fnn v${n.version}${n.nodeName ? ` "${n.nodeName}"` : ""} pubkey ${n.pubkey.slice(0, 12)}… chain ${n.chainHash.slice(0, 12)}… | ${n.channelCount} channels (${n.pendingChannelCount} pending) | ${n.peersCount} peers`);
  }
  for (const c of report.checks) {
    lines.push(` ${ICON[c.status]} ${c.title.padEnd(18)} ${c.reason}`);
    if (c.fix && c.status !== "pass") lines.push(`    fix: ${c.fix}`);
  }
  return lines.join("\n");
}
