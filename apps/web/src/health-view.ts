import type { CheckStatus, HealthReport } from "@fiber-route-doctor/core";

const ICON: Record<CheckStatus, string> = { pass: "✓", warn: "⚠", fail: "✗", skip: "−" };
const COLOR: Record<CheckStatus, string> = { pass: "#2ecc71", warn: "#f1c40f", fail: "#e74c3c", skip: "#7f8c8d" };

export interface HealthRow { id: string; icon: string; color: string; title: string; reason: string; fix?: string; }
export interface HealthView { verdict: CheckStatus; verdictColor: string; rows: HealthRow[]; summary?: string; }

export function buildHealthView(report: HealthReport): HealthView {
  const rows = report.checks.map((c) => ({ id: c.id, icon: ICON[c.status], color: COLOR[c.status], title: c.title, reason: c.reason, fix: c.fix }));
  const n = report.node;
  const summary = n ? `fnn v${n.version} | ${n.channelCount} channels (${n.pendingChannelCount} pending) | ${n.peersCount} peers` : undefined;
  return { verdict: report.verdict, verdictColor: COLOR[report.verdict], rows, summary };
}
