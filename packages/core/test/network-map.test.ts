import { describe, it, expect } from "vitest";
import { buildNetworkMapModel } from "../src/index.js";
import { gnode, gchan } from "./network-fixtures.js";

describe("buildNetworkMapModel", () => {
  it("computes degree, capacity totals, stats, and marks own node", () => {
    const m = buildNetworkMapModel(
      [gnode("0xaa", "alpha"), gnode("0xbb")],
      [gchan(), gchan({ channel_outpoint: "0x02", node2: "0xcc", capacity: "0xc8" })],
      "0xaa"
    );
    const aa = m.nodes.find((n) => n.pubkey === "0xaa")!;
    expect(aa).toMatchObject({ name: "alpha", degree: 2, totalCapacity: "300", isOwn: true, isolated: false });
    expect(m.stats).toEqual({ nodeCount: 3, channelCount: 2, totalCapacity: "300" });
  });
  it("synthesizes nodes seen only as channel endpoints", () => {
    const m = buildNetworkMapModel([], [gchan()]);
    expect(m.nodes.map((n) => n.pubkey).sort()).toEqual(["0xaa", "0xbb"]);
    expect(m.nodes[0].name).toBeNull();
  });
  it("flags isolated nodes (in graph_nodes, zero channels)", () => {
    const m = buildNetworkMapModel([gnode("0xdd", "loner")], []);
    expect(m.nodes[0]).toMatchObject({ isolated: true, degree: 0, totalCapacity: "0" });
  });
  it("marks an edge disabled only when NO direction is enabled (null update info = not enabled)", () => {
    const both = gchan();
    const one = gchan({ channel_outpoint: "0x02", update_info_of_node2: null });
    const none = gchan({ channel_outpoint: "0x03", update_info_of_node1: null, update_info_of_node2: { timestamp: "0x1", enabled: false, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" } });
    const m = buildNetworkMapModel([], [both, one, none]);
    expect(m.edges.map((e) => e.disabled)).toEqual([false, false, true]);
  });
  it("handles u128 capacities exactly", () => {
    const m = buildNetworkMapModel([], [gchan({ capacity: "0xffffffffffffffffff" })]);
    expect(m.edges[0].capacity).toBe("4722366482869645213695");
  });
  it("normalizes empty-string node names to null", () => {
    const m = buildNetworkMapModel([gnode("0xee", "")], []);
    expect(m.nodes[0].name).toBeNull();
  });
  it("ranks hubs by capacity, tie-broken by degree then pubkey, max 10, zero-degree excluded", () => {
    const chans = [
      gchan({ channel_outpoint: "0x1", node1: "0x01", node2: "0x02", capacity: "0x64" }), // 01:100, 02:100
      gchan({ channel_outpoint: "0x2", node1: "0x01", node2: "0x03", capacity: "0x64" }), // 01:200(d2), 03:100
      gchan({ channel_outpoint: "0x3", node1: "0x04", node2: "0x05", capacity: "0xc8" })  // 04:200(d1), 05:200(d1)
    ];
    const m = buildNetworkMapModel([gnode("0x09", "idle")], chans);
    expect(m.hubs.map((h) => h.pubkey)).toEqual(["0x01", "0x04", "0x05", "0x02", "0x03"]);
    expect(m.hubs.every((h) => h.degree > 0)).toBe(true);
  });
});
