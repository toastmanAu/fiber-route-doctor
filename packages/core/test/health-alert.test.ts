import { describe, it, expect, vi } from "vitest";
import { detectTransitions, buildAlertBody, postAlert, type HealthAlert, type HealthReport } from "../src/index.js";

const report = (statuses: Record<string, "pass" | "warn" | "fail" | "skip">): HealthReport => ({
  verdict: Object.values(statuses).includes("fail") ? "fail" : "pass",
  checks: Object.entries(statuses).map(([id, status]) => ({ id, title: id, status, reason: `${id} is ${status}` }))
});

const ALERT: HealthAlert = {
  ts: "2026-07-02T00:00:00.000Z", nodeUrl: "http://127.0.0.1:8231", verdict: "fail", previousVerdict: "pass",
  transitions: [{ check: "peers", from: "pass", to: "fail", reason: "0 peers — node is isolated (no gossip, no routing)" }],
  report: report({ peers: "fail" })
};

describe("detectTransitions", () => {
  it("reports only checks whose status changed", () => {
    const t = detectTransitions(report({ peers: "pass", auth: "pass" }), report({ peers: "fail", auth: "pass" }));
    expect(t).toEqual([{ check: "peers", from: "pass", to: "fail", reason: "peers is fail" }]);
  });
  it("returns empty when nothing changed", () => {
    expect(detectTransitions(report({ peers: "fail" }), report({ peers: "fail" }))).toEqual([]);
  });
});

describe("buildAlertBody", () => {
  it("generic format carries the machine payload", () => {
    const body = JSON.parse(buildAlertBody("generic", ALERT));
    expect(body).toMatchObject({ nodeUrl: "http://127.0.0.1:8231", verdict: "fail", previousVerdict: "pass" });
    expect(body.transitions).toHaveLength(1);
  });
  it("slack and discord formats wrap a human summary", () => {
    expect(JSON.parse(buildAlertBody("slack", ALERT)).text).toContain("peers: pass → fail");
    expect(JSON.parse(buildAlertBody("discord", ALERT)).content).toContain("FAIL");
  });
  it("never includes anything token-like", () => {
    for (const f of ["generic", "slack", "discord"] as const) {
      expect(buildAlertBody(f, ALERT)).not.toMatch(/[Bb]earer|biscuit|token/);
    }
  });
});

describe("postAlert", () => {
  it("POSTs the body and returns true on 2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await postAlert("https://hooks.example/x", "generic", ALERT, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
  });
  it("retries once on failure then returns false without throwing", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    expect(await postAlert("https://hooks.example/x", "generic", ALERT, fetchImpl)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("retry succeeds after a transient failure", async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(async () => new Response("bad", { status: 500 }))
      .mockImplementationOnce(async () => new Response("ok", { status: 200 }));
    expect(await postAlert("https://hooks.example/x", "generic", ALERT, fetchImpl)).toBe(true);
  });
});
