import { describe, it, expect } from "vitest";
import { KeyPair, PrivateKey, SignatureAlgorithm, biscuit } from "@biscuit-auth/biscuit-wasm";
import { VERSION } from "../src/index.js";

describe("biscuit package", () => {
  it("exposes a version", () => { expect(VERSION).toBe("0.1.0"); });
  it("mints a biscuit token under vitest (wasm loads)", () => {
    const kp = new KeyPair(SignatureAlgorithm.Ed25519);
    const pk = PrivateKey.fromString(kp.getPrivateKey().toString());
    const b = biscuit`check if time($time), $time <= ${new Date(Date.now() + 3600e3)};`;
    b.addCode('read("channels");');
    const token = b.build(pk).toBase64();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(50);
  });
});
