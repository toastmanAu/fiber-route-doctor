import { describe, it, expect } from "vitest";
import { parseChannelArgs, ckbToShannonHex } from "../src/commands/channel.js";

describe("ckbToShannonHex", () => {
  it("converts whole and fractional CKB to shannon hex", () => {
    expect(ckbToShannonHex("1")).toBe("0x5f5e100");          // 1e8
    expect(ckbToShannonHex("100")).toBe("0x2540be400");      // 1e10
    expect(ckbToShannonHex("0.00000001")).toBe("0x1");       // 1 shannon
    expect(ckbToShannonHex("62.5")).toBe("0x174876e80");     // 62.5e8
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["", "abc", "-5", "1.123456789", "0"]) {
      expect(() => ckbToShannonHex(bad)).toThrow();
    }
  });
});

describe("parseChannelArgs", () => {
  it("parses open with amount conversion", () => {
    const a = parseChannelArgs(["open", "--url", "http://n", "--pubkey", "0x02aa", "--amount", "500"]);
    expect(a.sub).toBe("open");
    expect(a.pubkey).toBe("0x02aa");
    expect(a.fundingAmountHex).toBe("0xba43b7400"); // 500e8
  });
  it("requires --address or --pubkey for connect", () => {
    expect(() => parseChannelArgs(["connect", "--url", "http://n"])).toThrow(/--address or --pubkey/);
  });
  it("close --force requires --yes-force", () => {
    expect(() => parseChannelArgs(["close", "--url", "http://n", "--channel-id", "0xc1", "--force"]))
      .toThrow(/--yes-force/);
    const ok = parseChannelArgs(["close", "--url", "http://n", "--channel-id", "0xc1", "--force", "--yes-force"]);
    expect(ok.force).toBe(true);
  });
  it("update requires at least one change flag", () => {
    expect(() => parseChannelArgs(["update", "--url", "http://n", "--channel-id", "0xc1"]))
      .toThrow(/at least one of/);
    const a = parseChannelArgs(["update", "--url", "http://n", "--channel-id", "0xc1", "--fee-rate", "1500"]);
    expect(a.feeRatePpmHex).toBe("0x5dc");
  });
  it("rejects unknown subcommands", () => {
    expect(() => parseChannelArgs(["explode", "--url", "http://n"])).toThrow(/unknown channel subcommand/);
  });
});
