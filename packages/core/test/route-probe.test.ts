import { describe, it, expect, vi } from "vitest";
import { crossCheckRouter, toBuildRouterParams, CKB_ASSET, type ProbeRequest } from "../src/index.js";

const probe: ProbeRequest = { source: "0xA", target: "0xC", amount: 1000n, asset: CKB_ASSET, maxFeeRate: 5n };

describe("toBuildRouterParams", () => {
  it("encodes amount as hex and target as the final hop", () => {
    const p = toBuildRouterParams(probe);
    expect(p.amount).toBe("0x3e8");
    expect(p.hops_info.at(-1)).toEqual({ pubkey: "0xC" });
    expect(p.max_fee_rate).toBe("0x5");
  });
});

describe("crossCheckRouter", () => {
  it("returns router_path with channel outpoints on success", async () => {
    const caller = { buildRouter: vi.fn(async () => ({ router_hops: [{ channel_outpoint: "0x1" }, { channel_outpoint: "0x2" }] })) };
    const r = await crossCheckRouter(caller, probe);
    expect(r).toEqual({ kind: "router_path", channelOutpoints: ["0x1", "0x2"] });
  });
  it("returns router_error when build_router throws", async () => {
    const caller = { buildRouter: vi.fn(async () => { throw new Error("no path found"); }) };
    const r = await crossCheckRouter(caller, probe);
    expect(r).toEqual({ kind: "router_error", message: "no path found" });
  });
});
