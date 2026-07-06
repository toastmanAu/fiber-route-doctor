import { describe, it, expect } from "vitest";
import { graphClientOptionsFor } from "../src/diagnose-run.js";

describe("graphClientOptionsFor", () => {
  it("attaches the biscuit token when one is present", () => {
    const opts = graphClientOptionsFor({ url: "http://node.local/rpc", token: "tok123" });
    expect(opts.url).toBe("http://node.local/rpc");
    expect(opts.biscuit).toBe("tok123");
  });

  it("omits the biscuit when the token is empty or whitespace (unauthenticated)", () => {
    expect(graphClientOptionsFor({ url: "u", token: "" }).biscuit).toBeUndefined();
    expect(graphClientOptionsFor({ url: "u", token: "   " }).biscuit).toBeUndefined();
  });

  it("trims surrounding whitespace from a pasted token", () => {
    expect(graphClientOptionsFor({ url: "u", token: "  tok  " }).biscuit).toBe("tok");
  });

  it("passes the fetch override through unchanged", () => {
    const fake = (async () => new Response("{}")) as unknown as typeof fetch;
    const opts = graphClientOptionsFor({ url: "u", token: "t", fetchImpl: fake });
    expect(opts.fetchImpl).toBe(fake);
  });
});
