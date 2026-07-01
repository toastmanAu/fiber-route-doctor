import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses required flags and defaults asset to CKB", () => {
    const a = parseArgs(["--url", "http://n/rpc", "--source", "0xA", "--target", "0xC", "--amount", "1000"]);
    expect(a).toMatchObject({ url: "http://n/rpc", source: "0xA", target: "0xC", amount: 1000n, asset: "CKB", router: false });
  });
  it("enables router cross-check with --router and reads --biscuit", () => {
    const a = parseArgs(["--url", "u", "--source", "0xA", "--target", "0xC", "--amount", "5", "--router", "--biscuit", "tok"]);
    expect(a.router).toBe(true);
    expect(a.biscuit).toBe("tok");
  });
  it("throws when a required flag is missing", () => {
    expect(() => parseArgs(["--url", "u", "--source", "0xA"])).toThrow(/target/);
  });
});
