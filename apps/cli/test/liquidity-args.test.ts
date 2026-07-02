import { describe, it, expect } from "vitest";
import { parseLiquidityArgs } from "../src/commands/liquidity.js";

describe("parseLiquidityArgs", () => {
  it("parses url, token flags, and booleans", () => {
    const a = parseLiquidityArgs(["--url", "http://n:8231", "--profile", "dt", "--json", "--save", "--diff"]);
    expect(a).toEqual({ url: "http://n:8231", biscuit: undefined, profile: "dt", authTokenFile: undefined, json: true, save: true, diff: true });
  });
  it("defaults booleans to false", () => {
    expect(parseLiquidityArgs(["--url", "u"])).toMatchObject({ json: false, save: false, diff: false });
  });
  it("requires --url", () => {
    expect(() => parseLiquidityArgs([])).toThrow(/--url/);
  });
});
