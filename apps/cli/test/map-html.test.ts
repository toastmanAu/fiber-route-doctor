import { describe, it, expect } from "vitest";
import { renderMapHtml, escapeHtml } from "../src/map-html.js";
import type { NetworkMapModel, LayoutPoint } from "@fiber-route-doctor/core";

const MODEL: NetworkMapModel = {
  nodes: [
    { pubkey: "0xaa", name: "alpha <script>", degree: 1, totalCapacity: "100", isolated: false, isOwn: true },
    { pubkey: "0xbb", name: null, degree: 1, totalCapacity: "100", isolated: false, isOwn: false }
  ],
  edges: [{ outpoint: "0x1", a: "0xaa", b: "0xbb", capacity: "100", disabled: false }],
  hubs: [{ pubkey: "0xaa", name: "alpha <script>", degree: 1, totalCapacity: "100" }],
  stats: { nodeCount: 2, channelCount: 1, totalCapacity: "100" }
};
const POS = new Map<string, LayoutPoint>([["0xaa", { x: 100, y: 100 }], ["0xbb", { x: 300, y: 300 }]]);

describe("escapeHtml", () => {
  it("escapes angle brackets, ampersands, and quotes", () => {
    expect(escapeHtml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
  });
});

describe("renderMapHtml", () => {
  const html = renderMapHtml(MODEL, POS, { width: 1200, height: 800 });
  it("is a self-contained document with inline svg and embedded model data", () => {
    expect(html).toContain("<svg");
    expect(html).toContain('type="application/json"');
    expect(html).toContain("2 nodes");
    expect(html).toContain("1 channels");
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("escapes node names everywhere they appear", () => {
    expect(html).not.toContain("alpha <script>");
    expect(html).toContain("alpha &lt;script&gt;");
  });
  it("renders an honest empty-state document for an empty model", () => {
    const empty: NetworkMapModel = { nodes: [], edges: [], hubs: [], stats: { nodeCount: 0, channelCount: 0, totalCapacity: "0" } };
    const out = renderMapHtml(empty, new Map(), { width: 800, height: 600 });
    expect(out).toContain("no gossiped topology");
  });
});
