import { describe, it, expect } from "vitest";
import { buildLiquiditySnapshot } from "../src/index.js";
import { rpcChan } from "./liquidity-fixtures.js";

describe("buildLiquiditySnapshot", () => {
  it("normalizes hex balances to decimal strings and maps null UDT to CKB", () => {
    const s = buildLiquiditySnapshot([rpcChan()], "http://n:8231", "2026-07-03T00:00:00.000Z");
    expect(s).toMatchObject({ ts: "2026-07-03T00:00:00.000Z", nodeUrl: "http://n:8231" });
    expect(s.channels[0]).toMatchObject({
      peer: "0x02aa", asset: "CKB", state: "ChannelReady", enabled: true, isPublic: true,
      local: "1000", remote: "2000", offeredHold: "0", receivedHold: "0", createdAt: "1"
    });
  });
  it("handles u128 values beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const s = buildLiquiditySnapshot([rpcChan({ local_balance: "0xffffffffffffffffff" })], "u", "t");
    expect(s.channels[0].local).toBe("4722366482869645213695");
  });
  it("derives a stable UDT asset id from the funding type script", () => {
    const udt = { code_hash: "0xcc", hash_type: "type", args: "0x01" };
    const s = buildLiquiditySnapshot([rpcChan({ funding_udt_type_script: udt })], "u", "t");
    expect(s.channels[0].asset).toBe("udt:0xcc:type:0x01");
  });
  it("produces plain-JSON-safe output (no bigints, survives stringify round-trip)", () => {
    const s = buildLiquiditySnapshot([rpcChan()], "u", "t");
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
