import { describe, it, expect } from "vitest";
import { parseCkbAmount, shannonHexToCkb, unauthorizedHint, PENDING_STATES } from "../src/channel-form.js";

describe("parseCkbAmount", () => {
  it("converts CKB decimal strings to shannon hex", () => {
    expect(parseCkbAmount("100")).toBe("0x2540be400");
    expect(parseCkbAmount("62.5")).toBe("0x174876e80");
  });
  it("throws readable errors on junk", () => {
    expect(() => parseCkbAmount("")).toThrow(/CKB amount/);
    expect(() => parseCkbAmount("1.123456789")).toThrow(/decimal/);
    expect(() => parseCkbAmount("0")).toThrow(/greater than 0/);
  });
});

describe("shannonHexToCkb", () => {
  it("renders hex shannons as CKB", () => {
    expect(shannonHexToCkb("0x2540be400")).toBe("100");
    expect(shannonHexToCkb("0x174876e80")).toBe("62.5");
    expect(shannonHexToCkb("0x1")).toBe("0.00000001");
  });
});

describe("unauthorizedHint", () => {
  it("distinguishes scope-insufficient from key-mismatch", () => {
    expect(unauthorizedHint(true)).toMatch(/scope/i);   // reads work, write denied -> scope
    expect(unauthorizedHint(true)).toMatch(/operator/);
    expect(unauthorizedHint(false)).toMatch(/node's key|node key/i); // everything denied -> wrong key
  });
});

describe("PENDING_STATES", () => {
  it("covers the pre-ready march but not terminal states", () => {
    for (const s of ["NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady"]) {
      expect(PENDING_STATES.has(s)).toBe(true);
    }
    expect(PENDING_STATES.has("ChannelReady")).toBe(false);
    expect(PENDING_STATES.has("Closed")).toBe(false);
  });
});
