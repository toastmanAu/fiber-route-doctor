import { describe, it, expect } from "vitest";
import { diffSnapshots } from "../src/index.js";
import { liq, snapOf } from "./liquidity-fixtures.js";

describe("diffSnapshots", () => {
  it("reports opened, closed, and signed balance deltas; omits unchanged channels", () => {
    const prev = { ...snapOf([
      liq({ channelId: "0x01", local: "1000", remote: "500" }),
      liq({ channelId: "0x02", local: "700", remote: "700" }),
      liq({ channelId: "0x03", local: "10", remote: "10" })
    ]), ts: "T0" };
    const next = { ...snapOf([
      liq({ channelId: "0x01", local: "800", remote: "700" }),   // moved 200 across
      liq({ channelId: "0x02", local: "700", remote: "700" }),   // unchanged
      liq({ channelId: "0x04", local: "5000", remote: "0" })     // opened
    ]), ts: "T1" };
    const d = diffSnapshots(prev, next);
    expect(d.fromTs).toBe("T0");
    expect(d.toTs).toBe("T1");
    expect(d.opened.map((c) => c.channelId)).toEqual(["0x04"]);
    expect(d.closed.map((c) => c.channelId)).toEqual(["0x03"]);
    expect(d.balanceDeltas).toEqual([
      { channelId: "0x01", asset: "CKB", localDelta: "-200", remoteDelta: "200" }
    ]);
  });
  it("emits asset deltas including assets that appear or disappear entirely", () => {
    const prev = { ...snapOf([liq({ channelId: "0x01", asset: "udt:0xcc:type:0x", local: "100", remote: "0" })]), ts: "T0" };
    const next = { ...snapOf([liq({ channelId: "0x02", asset: "CKB", local: "300", remote: "40" })]), ts: "T1" };
    const d = diffSnapshots(prev, next);
    expect(d.assetDeltas).toEqual([
      { asset: "CKB", outboundDelta: "300", inboundDelta: "40" },
      { asset: "udt:0xcc:type:0x", outboundDelta: "-100", inboundDelta: "0" }
    ]);
  });
  it("returns all-empty collections for identical snapshots", () => {
    const s = snapOf([liq({ channelId: "0x01" })]);
    const d = diffSnapshots({ ...s, ts: "T0" }, { ...s, ts: "T1" });
    expect(d.opened).toEqual([]);
    expect(d.closed).toEqual([]);
    expect(d.balanceDeltas).toEqual([]);
    expect(d.assetDeltas).toEqual([]);
  });
});
