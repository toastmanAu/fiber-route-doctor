import type { RouteReport } from "./types.js";

export function formatReportText(report: RouteReport): string {
  const lines: string[] = [];
  lines.push(`VERDICT: ${report.verdict}`);
  lines.push(`probe: ${report.probe.source} -> ${report.probe.target}  amount=${report.probe.amount}  asset=${report.probe.asset}`);
  if (report.path.length > 0) {
    lines.push(`path (${report.path.length} hop(s)), totalFee=${report.totalFee}, totalExpiry=${report.totalExpiry}ms, routerConfirmed=${report.routerConfirmed}`);
    for (const h of report.path) lines.push(`  ${h.index + 1}. ${h.from} -> ${h.to}  fee=${h.fee}  expiry=${h.expiryDelta}ms  chan=${h.channelOutpoint}`);
  }
  if (report.reasons.length > 0) {
    lines.push("reasons:");
    for (const r of report.reasons) lines.push(`  - [${r.cause}] ${r.detail}`);
  }
  if (report.fixes.length > 0) {
    lines.push("fixes:");
    for (const f of report.fixes) lines.push(`  - ${f.detail}`);
  }
  return lines.join("\n");
}
