import { describe, it, expect } from "vitest";
import {
  nodeRadius, edgeWidth, nodeColor,
  NODE_R_MIN, NODE_R_MAX, EDGE_W_MIN, EDGE_W_MAX,
  COLOR_OWN, COLOR_HUB, COLOR_ISOLATED, COLOR_NODE
} from "../src/index.js";

describe("scales", () => {
  it("maps zero to the minimum and max to the maximum (sqrt scale)", () => {
    expect(nodeRadius("0", "1000")).toBe(NODE_R_MIN);
    expect(nodeRadius("1000", "1000")).toBe(NODE_R_MAX);
    expect(edgeWidth("0", "500")).toBe(EDGE_W_MIN);
    expect(edgeWidth("500", "500")).toBe(EDGE_W_MAX);
  });
  it("is sqrt-shaped: quarter capacity gives half the range", () => {
    const r = nodeRadius("250", "1000");
    expect(r).toBeCloseTo(NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * 0.5, 1);
  });
  it("handles zero max and u128 values without throwing", () => {
    expect(nodeRadius("0", "0")).toBe(NODE_R_MIN);
    expect(nodeRadius("4722366482869645213695", "4722366482869645213695")).toBe(NODE_R_MAX);
  });
});

describe("nodeColor precedence", () => {
  it("own > hub > isolated > default", () => {
    expect(nodeColor({ isOwn: true, isolated: true }, true)).toBe(COLOR_OWN);
    expect(nodeColor({ isOwn: false, isolated: true }, true)).toBe(COLOR_HUB);
    expect(nodeColor({ isOwn: false, isolated: true }, false)).toBe(COLOR_ISOLATED);
    expect(nodeColor({ isOwn: false, isolated: false }, false)).toBe(COLOR_NODE);
  });
});
