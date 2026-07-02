import type { CheckStatus, HealthReport } from "./health-types.js";

export interface Transition { check: string; from: CheckStatus; to: CheckStatus; reason: string; }

export function detectTransitions(prev: HealthReport, next: HealthReport): Transition[] {
  const prevById = new Map(prev.checks.map((c) => [c.id, c]));
  const out: Transition[] = [];
  for (const c of next.checks) {
    const p = prevById.get(c.id);
    if (p && p.status !== c.status) out.push({ check: c.id, from: p.status, to: c.status, reason: c.reason });
  }
  return out;
}

export type WebhookFormat = "generic" | "slack" | "discord";
export const WEBHOOK_FORMATS: WebhookFormat[] = ["generic", "slack", "discord"];

export interface HealthAlert {
  ts: string;
  nodeUrl: string;
  verdict: CheckStatus;
  previousVerdict: CheckStatus;
  transitions: Transition[];
  report: HealthReport;
}

function summaryLine(alert: HealthAlert): string {
  const changes = alert.transitions.map((t) => `${t.check}: ${t.from} → ${t.to} (${t.reason})`).join("; ");
  return `Fiber node ${alert.nodeUrl}: ${alert.verdict.toUpperCase()} — ${changes}`;
}

export function buildAlertBody(format: WebhookFormat, alert: HealthAlert): string {
  if (format === "slack") return JSON.stringify({ text: summaryLine(alert) });
  if (format === "discord") return JSON.stringify({ content: summaryLine(alert) });
  return JSON.stringify(alert);
}

const WEBHOOK_TIMEOUT_MS = 5000;

/** Fire-and-forget webhook delivery: one retry, never throws. */
export async function postAlert(url: string, format: WebhookFormat, alert: HealthAlert, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
  const body = buildAlertBody(format, alert);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
      if (res.ok) return true;
    } catch { /* retry once (including on abort/timeout), then give up */ }
  }
  return false;
}
