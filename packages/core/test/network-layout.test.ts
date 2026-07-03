import { describe, it, expect } from "vitest";
import { buildNetworkMapModel, computeLayout } from "../src/index.js";
import { gnode, gchan } from "./network-fixtures.js";

const MODEL = buildNetworkMapModel(
  [gnode("0xaa", "a"), gnode("0xbb", "b"), gnode("0xcc", "c"), gnode("0xdd", "loner")],
  [
    gchan({ channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb" }),
    gchan({ channel_outpoint: "0x2", node1: "0xbb", node2: "0xcc", capacity: "0x2710" })
  ]
);

describe("computeLayout", () => {
  it("is deterministic: identical inputs give identical positions", () => {
    const p1 = computeLayout(MODEL, { width: 800, height: 600 });
    const p2 = computeLayout(MODEL, { width: 800, height: 600 });
    expect([...p1.entries()]).toEqual([...p2.entries()]);
  });
  it("positions every node, finite and within the clamp bounds", () => {
    const p = computeLayout(MODEL, { width: 800, height: 600, ticks: 50 });
    expect(p.size).toBe(4);
    for (const { x, y } of p.values()) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(24);
      expect(x).toBeLessThanOrEqual(800 - 24);
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y).toBeLessThanOrEqual(600 - 24);
    }
  });
  it("gives distinct nodes distinct positions", () => {
    const p = computeLayout(MODEL, { width: 800, height: 600, ticks: 50 });
    const keys = [...p.values()].map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("returns an empty map for an empty model", () => {
    const empty = buildNetworkMapModel([], []);
    expect(computeLayout(empty, { width: 800, height: 600 }).size).toBe(0);
  });
});
