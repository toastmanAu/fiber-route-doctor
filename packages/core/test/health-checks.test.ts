import { describe, it, expect } from "vitest";
import { checkReachability, checkAuth, checkNodeInfo, checkPeers, type HealthSnapshot, type RpcOutcome, type RpcNodeInfo } from "../src/index.js";

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

const NODE_INFO: RpcNodeInfo = {
  version: "0.9.0-rc5", commit_hash: "abcdef1234567890", pubkey: "0x03aa", node_name: "dt",
  addresses: ["/ip4/1.2.3.4/tcp/8228"], chain_hash: "0x11",
  channel_count: "0x1f4", pending_channel_count: "0x0", peers_count: "0x8"
};

describe("checkNodeInfo", () => {
  it("passes with a version/counts summary when node_info succeeded", () => {
    const r = checkNodeInfo(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK }, { nodeInfo: NODE_INFO }));
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("0.9.0-rc5");
    expect(r.reason).toContain("500 channel(s)");
    expect(r.reason).toContain("8 peer(s)");
  });
  it("skips with the outcome detail when node_info failed", () => {
    const r = checkNodeInfo(snap({ nodeInfo: DOWN, listPeers: OK, listChannels: OK }));
    expect(r.status).toBe("skip");
    expect(r.reason).toContain("ECONNREFUSED");
  });
});

describe("checkPeers", () => {
  it("fails as isolated with 0 peers", () => {
    const r = checkPeers(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK }, { peers: [] }));
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("isolated");
    expect(r.fix).toContain("connect_peer");
  });
  it("passes with a count when peers exist", () => {
    const r = checkPeers(snap({ nodeInfo: OK, listPeers: OK, listChannels: OK }, { peers: [{ pubkey: "0x02bb", address: "/ip4/1.1.1.1/tcp/1" }] }));
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("1 peer(s)");
  });
  it("skips when list_peers failed", () => {
    expect(checkPeers(snap({ nodeInfo: OK, listPeers: DENIED, listChannels: OK })).status).toBe("skip");
  });
});
