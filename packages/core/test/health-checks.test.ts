import { describe, it, expect } from "vitest";
import { checkReachability, checkAuth, type HealthSnapshot, type RpcOutcome } from "../src/index.js";

const OK: RpcOutcome = { ok: true };
const DENIED: RpcOutcome = { ok: false, kind: "auth-denied", detail: "RPC list_peers error -32999: Unauthorized" };
const DOWN: RpcOutcome = { ok: false, kind: "transport-error", detail: "fetch failed: ECONNREFUSED" };

function snap(outcomes: HealthSnapshot["outcomes"], data: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return { outcomes, ...data };
}

describe("checkReachability", () => {
  it("fails when every call transport-errored", () => {
    const r = checkReachability(snap({ nodeInfo: DOWN, listPeers: DOWN, listChannels: DOWN }));
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("ECONNREFUSED");
    expect(r.fix).toBeTruthy();
  });
  it("passes when any call reached the node — even if only to be denied", () => {
    expect(checkReachability(snap({ nodeInfo: DENIED, listPeers: DENIED, listChannels: DENIED })).status).toBe("pass");
    expect(checkReachability(snap({ nodeInfo: OK, listPeers: DOWN, listChannels: DOWN })).status).toBe("pass");
  });
});

describe("checkAuth", () => {
  it("fails when all calls are denied", () => {
    const r = checkAuth(snap({ nodeInfo: DENIED, listPeers: DENIED, listChannels: DENIED }));
    expect(r.status).toBe("fail");
    expect(r.fix).toContain("token generate");
  });
  it("warns naming missing scopes when only some calls are denied", () => {
    const r = checkAuth(snap({ nodeInfo: OK, listPeers: DENIED, listChannels: OK }));
    expect(r.status).toBe("warn");
    expect(r.reason).toContain('read("peers")');
  });
  it("passes when all calls authorized and skips when nothing reached the node", () => {
    expect(checkAuth(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK })).status).toBe("pass");
    expect(checkAuth(snap({ nodeInfo: DOWN, listPeers: DOWN, listChannels: DOWN })).status).toBe("skip");
  });
});
