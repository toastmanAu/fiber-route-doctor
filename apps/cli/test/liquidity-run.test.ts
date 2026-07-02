import { describe, it, expect, vi } from "vitest";
import { runLiquidity } from "../src/commands/liquidity.js";
import type { LiquiditySnapshot, RpcChannel, SnapshotStore } from "@fiber-route-doctor/core";

const CHAN: RpcChannel = {
  channel_id: "0x01", pubkey: "0x02aa", state: { state_name: "ChannelReady" },
  local_balance: "0x3e8", remote_balance: "0x7d0", offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
  enabled: true, is_public: true, pending_tlcs: [], created_at: "0x1", funding_udt_type_script: null, failure_detail: null
};

function memStore(initial?: LiquiditySnapshot): SnapshotStore & { saved: LiquiditySnapshot[] } {
  const saved: LiquiditySnapshot[] = initial ? [initial] : [];
  return {
    saved,
    list: () => saved.map((s) => `${s.ts}.json`),
    get: (name) => saved.find((s) => `${s.ts}.json` === name),
    put: (s) => { saved.push(s); return `${s.ts}.json`; },
    latest: () => saved[saved.length - 1]
  };
}
function deps(store = memStore()) {
  return {
    fetchChannels: vi.fn(async () => [CHAN]),
    store,
    print: vi.fn(),
    now: () => new Date("2026-07-03T12:00:00.000Z")
  };
}

describe("runLiquidity", () => {
  it("prints the report and returns 0", async () => {
    const d = deps();
    expect(await runLiquidity(["--url", "http://n/"], d)).toBe(0);
    expect(String(d.print.mock.calls[0][0])).toContain("Channel liquidity");
  });
  it("--save persists the snapshot and announces the filename", async () => {
    const d = deps();
    await runLiquidity(["--url", "http://n/", "--save"], d);
    expect(d.store.saved).toHaveLength(1);
    expect(d.store.saved[0].ts).toBe("2026-07-03T12:00:00.000Z");
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("saved 2026-07-03T12:00:00.000Z.json");
  });
  it("--diff renders a diff against the latest saved snapshot", async () => {
    const prev: LiquiditySnapshot = {
      ts: "2026-07-01T00:00:00.000Z", nodeUrl: "http://n/",
      channels: [{ channelId: "0x01", peer: "0x02aa", asset: "CKB", state: "ChannelReady", enabled: true, isPublic: true, local: "500", remote: "2500", offeredHold: "0", receivedHold: "0", createdAt: "1" }]
    };
    const d = deps(memStore(prev));
    expect(await runLiquidity(["--url", "http://n/", "--diff"], d)).toBe(0);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Liquidity diff");
    expect(printed).toContain("local +500");
  });
  it("--diff with no saved snapshot errors with guidance and exit 2", async () => {
    const d = deps();
    expect(await runLiquidity(["--url", "http://n/", "--diff"], d)).toBe(2);
    expect(String(d.print.mock.calls[0][0])).toContain("run with --save first");
  });
  it("--diff --save diffs against the PREVIOUS latest, then saves the new one", async () => {
    const prev: LiquiditySnapshot = { ts: "2026-07-01T00:00:00.000Z", nodeUrl: "http://n/", channels: [] };
    const d = deps(memStore(prev));
    await runLiquidity(["--url", "http://n/", "--diff", "--save"], d);
    expect(d.store.saved).toHaveLength(2);
    const printed = d.print.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("+ opened");
  });
  it("--json emits parseable {report, snapshot} and includes diff when requested", async () => {
    const d = deps(memStore({ ts: "T0", nodeUrl: "u", channels: [] }));
    await runLiquidity(["--url", "http://n/", "--json", "--diff"], d);
    const body = JSON.parse(String(d.print.mock.calls[0][0]));
    expect(body.report.assets[0].asset).toBe("CKB");
    expect(body.snapshot.channels).toHaveLength(1);
    expect(body.diff.opened).toHaveLength(1);
  });
  it("returns 2 and prints the usage error for bad args", async () => {
    const d = deps();
    expect(await runLiquidity([], d)).toBe(2);
    expect(String(d.print.mock.calls[0][0])).toContain("--url");
  });
});
