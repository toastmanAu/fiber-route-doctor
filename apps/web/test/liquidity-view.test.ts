import { describe, it, expect } from "vitest";
import { buildLiquidityView } from "../src/liquidity-view.js";
import { computeLiquidityReport, type ChannelLiquidity, type LiquiditySnapshot } from "@fiber-route-doctor/core";

function liq(over: Partial<ChannelLiquidity> = {}): ChannelLiquidity {
  return {
    channelId: "0x01", peer: "0x02aa", asset: "CKB", state: "ChannelReady",
    enabled: true, isPublic: true, local: "300", remote: "700",
    offeredHold: "0", receivedHold: "0", createdAt: "1", ...over
  };
}
const snapOf = (channels: ChannelLiquidity[]): LiquiditySnapshot => ({ ts: "T", nodeUrl: "u", channels });

describe("buildLiquidityView", () => {
  it("builds cards per asset and bar rows with percent and colors", () => {
    const s = snapOf([liq(), liq({ channelId: "0x02", local: "20", remote: "980" })]);
    const v = buildLiquidityView(computeLiquidityReport(s), s);
    expect(v.empty).toBe(false);
    expect(v.cards).toEqual([{ asset: "CKB", outbound: "320", inbound: "1680", maxSend: "300", maxReceive: "980" }]);
    expect(v.rows[0]).toMatchObject({ pct: 30, barColor: "#2ecc71", excluded: false });
    expect(v.rows[1]).toMatchObject({ pct: 2, flag: "drained", barColor: "#e74c3c" });
  });
  it("marks excluded channels grey with null-safe pct and flags full channels amber", () => {
    const s = snapOf([
      liq({ channelId: "0x03", state: "AwaitingChannelReady" }),
      liq({ channelId: "0x04", local: "990", remote: "10" })
    ]);
    const v = buildLiquidityView(computeLiquidityReport(s), s);
    expect(v.rows[0]).toMatchObject({ excluded: true, barColor: "#7f8c8d" });
    expect(v.rows[1]).toMatchObject({ flag: "full", barColor: "#f1c40f" });
  });
  it("flags empty snapshots", () => {
    const s = snapOf([]);
    expect(buildLiquidityView(computeLiquidityReport(s), s).empty).toBe(true);
  });
});
