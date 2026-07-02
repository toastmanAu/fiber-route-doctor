import { describe, it, expect, vi } from "vitest";
import { watchHealth, type WatchDeps } from "../src/commands/health.js";
import type { HealthReport, HealthAlert } from "@fiber-route-doctor/core";

const report = (peersStatus: "pass" | "fail"): HealthReport => ({
  verdict: peersStatus,
  checks: [{ id: "peers", title: "Peer connectivity", status: peersStatus, reason: `peers ${peersStatus}` }]
});

function deps(reports: HealthReport[]) {
  let i = 0;
  return {
    probe: vi.fn(async () => reports[Math.min(i++, reports.length - 1)]),
    print: vi.fn(),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-07-02T00:00:00.000Z")
  };
}

describe("watchHealth", () => {
  it("renders each tick and prints a transition line when a check changes", async () => {
    const d = deps([report("pass"), report("fail")]);
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhookFormat: "generic", maxTicks: 2 }, d);
    expect(d.probe).toHaveBeenCalledTimes(2);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("peers: pass → fail");
  });
  it("sends a webhook only on transition ticks", async () => {
    const post = vi.fn(async () => true) as unknown as WatchDeps["post"];
    const d = deps([report("pass"), report("pass"), report("fail")]);
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhook: "https://h/x", webhookFormat: "slack", maxTicks: 3 }, { ...d, post });
    expect(post).toHaveBeenCalledTimes(1);
    const alert = (post as any).mock.calls[0][2] as HealthAlert;
    expect(alert.previousVerdict).toBe("pass");
    expect(alert.verdict).toBe("fail");
  });
  it("prints a warning when webhook delivery fails, and keeps looping", async () => {
    const post = vi.fn(async () => false) as unknown as WatchDeps["post"];
    const d = deps([report("pass"), report("fail"), report("fail")]);
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhook: "https://h/x", webhookFormat: "generic", maxTicks: 3 }, { ...d, post });
    expect(d.probe).toHaveBeenCalledTimes(3);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("webhook delivery failed");
  });
  it("survives a transient probe failure and compares the next tick against the last good report", async () => {
    let calls = 0;
    const probe = vi.fn(async (): Promise<HealthReport> => {
      calls++;
      if (calls === 1) return report("pass");
      if (calls === 2) throw new Error("connection reset");
      return report("fail");
    });
    const print = vi.fn();
    const d: WatchDeps = {
      probe,
      print,
      sleep: vi.fn(async () => {}),
      now: () => new Date("2026-07-02T00:00:00.000Z")
    };
    await watchHealth({ nodeUrl: "http://n/", intervalMs: 10, webhookFormat: "generic", maxTicks: 3 }, d);
    expect(probe).toHaveBeenCalledTimes(3);
    const printed = print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("probe failed: connection reset");
    expect(printed).toContain("peers: pass → fail");
  });
});
