import { describe, it, expect } from "vitest";
import { computeLiquidityReport } from "../src/index.js";
import { liq, snapOf } from "./liquidity-fixtures.js";

describe("computeLiquidityReport — per-asset totals", () => {
  it("sums outbound/inbound and takes max single send/receive over ready+enabled channels", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "1000", remote: "500" }),
      liq({ channelId: "0x02", local: "3000", remote: "4000", offeredHold: "77", receivedHold: "11" })
    ]));
    expect(r.assets).toEqual([{
      asset: "CKB", channelCount: 2, readyCount: 2,
      outbound: "4000", inbound: "4500", maxSend: "3000", maxReceive: "4000",
      inFlightOut: "77", inFlightIn: "11"
    }]);
    expect(r.totalChannels).toBe(2);
    expect(r.excludedChannels).toBe(0);
  });
  it("excludes non-ready and disabled channels from totals but counts them", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "1000" }),
      liq({ channelId: "0x02", local: "9999", state: "AwaitingChannelReady" }),
      liq({ channelId: "0x03", local: "5555", enabled: false })
    ]));
    expect(r.assets[0]).toMatchObject({ channelCount: 3, readyCount: 1, outbound: "1000", maxSend: "1000" });
    expect(r.excludedChannels).toBe(2);
  });
  it("groups per asset with CKB first then lexicographic", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", asset: "udt:0xff:type:0x", local: "10" }),
      liq({ channelId: "0x02", asset: "CKB", local: "20" }),
      liq({ channelId: "0x03", asset: "udt:0xaa:type:0x", local: "30" })
    ]));
    expect(r.assets.map((a) => a.asset)).toEqual(["CKB", "udt:0xaa:type:0x", "udt:0xff:type:0x"]);
  });
  it("returns an empty assets list for an empty snapshot", () => {
    const r = computeLiquidityReport(snapOf([]));
    expect(r.assets).toEqual([]);
    expect(r.totalChannels).toBe(0);
  });
});
