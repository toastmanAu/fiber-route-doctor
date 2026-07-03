import { describe, it, expect } from "vitest";
import { selectActive } from "../src/wallet-context.js";
import type { BrowserTokenProfile } from "@fiber-route-doctor/biscuit/browser";

const p = (name: string): BrowserTokenProfile => ({ name, url: "u", token: "t", scope: "readonly", expiresAt: "", publicKeyString: "ed25519/aa" });

describe("selectActive", () => {
  it("returns the named profile", () => {
    expect(selectActive([p("a"), p("b")], "b")?.name).toBe("b");
  });
  it("returns null for null name or a missing name", () => {
    expect(selectActive([p("a")], null)).toBeNull();
    expect(selectActive([p("a")], "z")).toBeNull();
  });
});
