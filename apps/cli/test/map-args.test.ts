import { describe, it, expect } from "vitest";
import { parseMapArgs } from "../src/commands/map.js";

describe("parseMapArgs", () => {
  it("parses url, token flags, out, dimensions, json", () => {
    const a = parseMapArgs(["--url", "http://n:8231", "--profile", "dt", "--out", "x.html", "--width", "1600", "--height", "900", "--json"]);
    expect(a).toMatchObject({ url: "http://n:8231", profile: "dt", out: "x.html", width: 1600, height: 900, json: true });
  });
  it("defaults out/width/height and booleans", () => {
    expect(parseMapArgs(["--url", "u"])).toMatchObject({ out: "fiber-map.html", width: 1200, height: 800, json: false });
  });
  it("requires --url and validates dimensions", () => {
    expect(() => parseMapArgs([])).toThrow(/--url/);
    expect(() => parseMapArgs(["--url", "u", "--width", "50"])).toThrow(/width/);
    expect(() => parseMapArgs(["--url", "u", "--height", "1.5"])).toThrow(/height/);
    expect(() => parseMapArgs(["--url", "u", "--width", "9000"])).toThrow(/width/);
  });
});
