import { describe, it, expect, vi } from "vitest";
import { runHealth, healthExitCode } from "../src/commands/health.js";
import type { HealthReport } from "@fiber-route-doctor/core";

const report = (verdict: HealthReport["verdict"]): HealthReport => ({
  verdict, checks: [{ id: "reachability", title: "Node reachability", status: verdict, reason: "r" }]
});

describe("healthExitCode", () => {
  it("maps pass/warn/fail to 0/1/2", () => {
    expect(healthExitCode("pass")).toBe(0);
    expect(healthExitCode("warn")).toBe(1);
    expect(healthExitCode("fail")).toBe(2);
  });
});

describe("runHealth (one-shot)", () => {
  it("prints the text report and returns the verdict exit code", async () => {
    const print = vi.fn();
    const code = await runHealth(["--url", "http://n/"], { probe: async () => report("warn"), print });
    expect(code).toBe(1);
    expect(String(print.mock.calls[0][0])).toContain("verdict: WARN");
  });
  it("prints JSON with --json", async () => {
    const print = vi.fn();
    await runHealth(["--url", "http://n/", "--json"], { probe: async () => report("pass"), print });
    expect(() => JSON.parse(String(print.mock.calls[0][0]))).not.toThrow();
  });
  it("returns 2 and prints the usage error for bad args", async () => {
    const print = vi.fn();
    const code = await runHealth([], { print });
    expect(code).toBe(2);
    expect(String(print.mock.calls[0][0])).toContain("--url");
  });
});
