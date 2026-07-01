import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/dispatch.js";

describe("parseCommand", () => {
  it("routes a leading subcommand and strips it", () => {
    expect(parseCommand(["token", "generate", "--scope", "readonly"]))
      .toEqual({ command: "token", rest: ["generate", "--scope", "readonly"] });
    expect(parseCommand(["keys", "init"])).toEqual({ command: "keys", rest: ["init"] });
  });
  it("defaults to diagnose when the first arg is a flag or missing", () => {
    expect(parseCommand(["--url", "u"])).toEqual({ command: "diagnose", rest: ["--url", "u"] });
    expect(parseCommand([])).toEqual({ command: "diagnose", rest: [] });
  });
  it("throws on an unknown subcommand", () => {
    expect(() => parseCommand(["frobnicate"])).toThrow(/unknown command/);
  });
});
