import { describe, it, expect } from "vitest";
import { buildNetworkMapView } from "../src/network-map-view.js";
import { COLOR_OWN, COLOR_ROUTE, COLOR_EDGE_DISABLED, NODE_R_MAX, type NetworkMapModel, type LayoutPoint } from "@fiber-route-doctor/core";

const MODEL: NetworkMapModel = {
  nodes: [
    { pubkey: "0xaa", name: "alpha", degree: 2, totalCapacity: "300", isolated: false, isOwn: true },
    { pubkey: "0xbb", name: null, degree: 1, totalCapacity: "100", isolated: false, isOwn: false }
  ],
  edges: [
    { outpoint: "0x1", a: "0xaa", b: "0xbb", capacity: "100", disabled: false },
    { outpoint: "0x2", a: "0xaa", b: "0xbb", capacity: "200", disabled: true }
  ],
  hubs: [{ pubkey: "0xaa", name: "alpha", degree: 2, totalCapacity: "300" }],
  stats: { nodeCount: 2, channelCount: 2, totalCapacity: "300" }
};
const POS = new Map<string, LayoutPoint>([["0xaa", { x: 100, y: 100 }], ["0xbb", { x: 200, y: 200 }]]);

describe("buildNetworkMapView", () => {
  it("builds node rows with position, scaled radius, precedence color (own beats hub), and label", () => {
    const v = buildNetworkMapView(MODEL, POS);
    expect(v.nodes[0]).toMatchObject({ pubkey: "0xaa", x: 100, y: 100, r: NODE_R_MAX, color: COLOR_OWN, label: "alpha", isOwn: true });
    expect(v.empty).toBe(false);
  });
  it("marks disabled edges dashed/red and route edges gold with extra width", () => {
    const v = buildNetworkMapView(MODEL, POS, ["0x1"]);
    const route = v.edges.find((e) => e.outpoint === "0x1")!;
    const dis = v.edges.find((e) => e.outpoint === "0x2")!;
    expect(route).toMatchObject({ onRoute: true, color: COLOR_ROUTE, dashed: false });
    expect(dis).toMatchObject({ onRoute: false, color: COLOR_EDGE_DISABLED, dashed: true });
    expect(route.width).toBeGreaterThan(0);
  });
  it("skips edges whose endpoints lack positions and flags empty models", () => {
    const v = buildNetworkMapView(MODEL, new Map([["0xaa", { x: 1, y: 1 }]]));
    expect(v.edges).toEqual([]);
    const emptyModel: NetworkMapModel = { nodes: [], edges: [], hubs: [], stats: { nodeCount: 0, channelCount: 0, totalCapacity: "0" } };
    expect(buildNetworkMapView(emptyModel, new Map()).empty).toBe(true);
  });
});
