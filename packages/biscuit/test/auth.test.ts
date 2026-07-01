import { describe, it, expect } from "vitest";
import { resolveToken } from "../src/index.js";

describe("resolveToken", () => {
  it("prefers explicit token, then file, then profile, then env", () => {
    expect(resolveToken({ authToken: " tok ", env: { FNN_AUTH_TOKEN: "envtok" } })).toBe("tok");
    expect(resolveToken({ authTokenFile: "/f", readFile: () => " filetok\n" })).toBe("filetok");
    expect(resolveToken({ profile: "p", getProfileToken: (n) => (n === "p" ? "ptok" : undefined) })).toBe("ptok");
    expect(resolveToken({ env: { FNN_AUTH_TOKEN: "envtok" } })).toBe("envtok");
    expect(resolveToken({})).toBeUndefined();
  });
});
