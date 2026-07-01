import { describe, it, expect } from "vitest";
import { parseExpiry, parseScope } from "../src/commands/token.js";

describe("parseExpiry", () => {
  it("parses days and hours into a future Date", () => {
    const now = Date.now();
    expect(parseExpiry("30d").getTime()).toBeGreaterThan(now + 29 * 864e5);
    expect(parseExpiry("2h").getTime()).toBeGreaterThan(now + 1.9 * 36e5);
  });
  it("throws on a bad format", () => {
    expect(() => parseExpiry("soon")).toThrow(/expiry/);
  });
});

describe("parseScope", () => {
  it("accepts the three templates", () => {
    expect(parseScope("readonly")).toBe("readonly");
    expect(parseScope("invoicing")).toBe("invoicing");
    expect(parseScope("full")).toBe("full");
  });
  it("throws on an invalid scope", () => {
    expect(() => parseScope("bogus")).toThrow(/scope/);
  });
});
