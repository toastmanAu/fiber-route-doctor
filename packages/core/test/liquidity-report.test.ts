import { describe, it, expect } from "vitest";
import { computeLiquidityReport, SKEW_DRAINED_PCT, SKEW_FULL_PCT } from "../src/index.js";
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

describe("computeLiquidityReport — skew flags", () => {
  it("flags drained (<10% local) and full (>90% local) channels", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "50", remote: "950" }),   // 5% -> drained
      liq({ channelId: "0x02", local: "950", remote: "50" }),   // 95% -> full
      liq({ channelId: "0x03", local: "500", remote: "500" })   // 50% -> no flag
    ]));
    expect(r.skews).toEqual([
      { channelId: "0x01", asset: "CKB", localRatioPct: 5, flag: "drained" },
      { channelId: "0x02", asset: "CKB", localRatioPct: 95, flag: "full" }
    ]);
  });
  it("does not flag exactly at the thresholds (strict inequality)", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "100", remote: "900" }),  // exactly 10%
      liq({ channelId: "0x02", local: "900", remote: "100" })   // exactly 90%
    ]));
    expect(r.skews).toEqual([]);
    expect(SKEW_DRAINED_PCT).toBe(10);
    expect(SKEW_FULL_PCT).toBe(90);
  });
  it("flags full using exact ratio comparison, not the floored display percentage", () => {
    // 907 / 1000 = 90.7% exactly -> above the 90% "full" threshold, even though
    // Number((907n * 100n) / 1000n) floors to 90, which would wrongly look unflagged.
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "907", remote: "93" })
    ]));
    expect(r.skews).toEqual([
      { channelId: "0x01", asset: "CKB", localRatioPct: 90, flag: "full" }
    ]);
  });
  it("skips zero-capacity channels and inactive channels", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", local: "0", remote: "0" }),
      liq({ channelId: "0x02", local: "1", remote: "999", enabled: false })
    ]));
    expect(r.skews).toEqual([]);
  });
});

describe("computeLiquidityReport — peer groups", () => {
  it("groups active channels by counterparty, sorted by outbound descending", () => {
    const r = computeLiquidityReport(snapOf([
      liq({ channelId: "0x01", peer: "0x02aa", local: "100", remote: "1" }),
      liq({ channelId: "0x02", peer: "0x02bb", local: "900", remote: "2" }),
      liq({ channelId: "0x03", peer: "0x02aa", local: "50", remote: "3" }),
      liq({ channelId: "0x04", peer: "0x02cc", local: "5", state: "AwaitingChannelReady" })
    ]));
    expect(r.peers).toEqual([
      { peer: "0x02bb", channelCount: 1, outbound: "900", inbound: "2" },
      { peer: "0x02aa", channelCount: 2, outbound: "150", inbound: "4" }
    ]);
  });
});
