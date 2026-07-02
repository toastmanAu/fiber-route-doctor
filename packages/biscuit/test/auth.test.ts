import { describe, it, expect } from "vitest";
import { resolveToken, isRunLimitError } from "../src/index.js";

describe("resolveToken", () => {
  it("prefers explicit token, then file, then profile, then env", () => {
    expect(resolveToken({ authToken: " tok ", env: { FNN_AUTH_TOKEN: "envtok" } })).toBe("tok");
    expect(resolveToken({ authTokenFile: "/f", readFile: () => " filetok\n" })).toBe("filetok");
    expect(resolveToken({ profile: "p", getProfileToken: (n) => (n === "p" ? "ptok" : undefined) })).toBe("ptok");
    expect(resolveToken({ env: { FNN_AUTH_TOKEN: "envtok" } })).toBe("envtok");
    expect(resolveToken({})).toBeUndefined();
  });
});

describe("isRunLimitError", () => {
  it("classifies biscuit-wasm's plain-object RunLimit timeout as a run-limit error", () => {
    expect(isRunLimitError({ RunLimit: "Timeout" })).toBe(true);
  });

  it("does not classify a FailedLogic denial as a run-limit error", () => {
    expect(isRunLimitError({ FailedLogic: { Unauthorized: { policy: "Deny", checks: [] } } })).toBe(false);
  });

  it("does not classify a plain Error instance as a run-limit error", () => {
    expect(isRunLimitError(new Error("x"))).toBe(false);
  });

  it("does not classify null, undefined, or primitives as a run-limit error", () => {
    expect(isRunLimitError(null)).toBe(false);
    expect(isRunLimitError(undefined)).toBe(false);
    expect(isRunLimitError("RunLimit")).toBe(false);
    expect(isRunLimitError(42)).toBe(false);
  });
});
