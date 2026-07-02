import { describe, it, expect } from "vitest";
import { computeLiquidityReport, formatLiquidityText, diffSnapshots, formatLiquidityDiff } from "../src/index.js";
import { liq, snapOf } from "./liquidity-fixtures.js";

describe("formatLiquidityText", () => {
  it("renders per-asset headline, channel bars, skew and excluded annotations, and peers", () => {
    const snapshot = snapOf([
      liq({ channelId: "0xaabbccddee01", peer: "0x02aa", local: "300", remote: "700" }),          // 30%
      liq({ channelId: "0xaabbccddee02", peer: "0x02bb", local: "50", remote: "950" }),           // 5% drained
      liq({ channelId: "0xaabbccddee03", peer: "0x02cc", local: "10", state: "AwaitingChannelReady" })
    ]);
    const out = formatLiquidityText(computeLiquidityReport(snapshot), snapshot);
    expect(out).toContain("3 channels (1 excluded)");
    expect(out).toContain("CKB: out 350 | in 1650 | max send 300 | max receive 950");
    expect(out).toContain("[███░░░░░░░] 30%");
    expect(out).toContain("[█░░░░░░░░░] 5%");   // Math.round(5/10) = 1 filled cell
    expect(out).toContain("drained");
    expect(out).toContain("excluded: AwaitingChannelReady");
    expect(out).toContain("peer 0x02bb");
  });
  it("renders in-flight holds only when non-zero", () => {
    const withHold = snapOf([liq({ offeredHold: "42" })]);
    const noHold = snapOf([liq()]);
    expect(formatLiquidityText(computeLiquidityReport(withHold), withHold)).toContain("in-flight out 42");
    expect(formatLiquidityText(computeLiquidityReport(noHold), noHold)).not.toContain("in-flight");
  });
  it("renders the explicit empty-node message", () => {
    const empty = snapOf([]);
    expect(formatLiquidityText(computeLiquidityReport(empty), empty)).toContain("no channels — nothing to snapshot");
  });
  it("labels ready-but-disabled channels as disabled and zero-capacity channels distinctly", () => {
    const s = snapOf([
      liq({ channelId: "0x0a", enabled: false }),
      liq({ channelId: "0x0b", local: "0", remote: "0" })
    ]);
    const out = formatLiquidityText(computeLiquidityReport(s), s);
    expect(out).toContain("0x0a excluded: disabled");
    expect(out).toContain("(zero capacity)");
  });
});

describe("formatLiquidityDiff", () => {
  it("renders opened/closed channels and signed deltas", () => {
    // ids stay <= 12 chars so shortId passes them through unshortened and each stays distinct
    const prev = { ...snapOf([liq({ channelId: "0x01", local: "1000", remote: "0" }), liq({ channelId: "0x03", local: "7", remote: "7" })]), ts: "T0" };
    const next = { ...snapOf([liq({ channelId: "0x01", local: "800", remote: "200" }), liq({ channelId: "0x02", local: "50", remote: "0" })]), ts: "T1" };
    const out = formatLiquidityDiff(diffSnapshots(prev, next));
    expect(out).toContain("T0 → T1");
    expect(out).toContain("+ opened 0x02 (CKB, local 50)");
    expect(out).toContain("- closed 0x03 (CKB)");
    expect(out).toContain("Δ 0x01 local -200, remote +200");
    expect(out).toContain("Δ CKB out -157, in +193");
  });
  it("says no changes for identical snapshots", () => {
    const s = snapOf([liq()]);
    const out = formatLiquidityDiff(diffSnapshots({ ...s, ts: "T0" }, { ...s, ts: "T1" }));
    expect(out).toContain("no changes");
  });
});
