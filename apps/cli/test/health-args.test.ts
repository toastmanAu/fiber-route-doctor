import { describe, it, expect } from "vitest";
import { parseHealthArgs } from "../src/commands/health.js";

describe("parseHealthArgs", () => {
  it("parses url, token flags, json, watch, interval, webhook", () => {
    const a = parseHealthArgs(["--url", "http://n:8231", "--profile", "dt", "--watch", "--interval", "5", "--webhook", "https://hooks.example/x", "--webhook-format", "discord", "--json"]);
    expect(a).toMatchObject({ url: "http://n:8231", profile: "dt", watch: true, intervalSeconds: 5, webhook: "https://hooks.example/x", webhookFormat: "discord", json: true });
  });
  it("defaults: interval 10, format generic, no watch/json", () => {
    const a = parseHealthArgs(["--url", "http://n:8231"]);
    expect(a).toMatchObject({ intervalSeconds: 10, webhookFormat: "generic", watch: false, json: false });
  });
  it("requires --url", () => {
    expect(() => parseHealthArgs([])).toThrow(/--url/);
  });
  it("rejects bad intervals", () => {
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--interval", "0"])).toThrow(/interval/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--interval", "1.5"])).toThrow(/interval/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--interval", "9999"])).toThrow(/interval/);
  });
  it("rejects --webhook without --watch, non-http(s) webhook URLs, unknown formats", () => {
    expect(() => parseHealthArgs(["--url", "u", "--webhook", "https://h/x"])).toThrow(/--watch/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "ftp://h/x"])).toThrow(/http/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "not a url"])).toThrow();
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "https://h/x", "--webhook-format", "teams"])).toThrow(/webhook-format/);
  });
  it("rejects a bare --webhook with no value", () => {
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook"])).toThrow(/--webhook/);
    expect(() => parseHealthArgs(["--url", "u", "--watch", "--webhook", "--json"])).toThrow(/--webhook/);
  });
});
