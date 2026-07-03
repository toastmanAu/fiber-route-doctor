import { describe, it, expect, vi } from "vitest";
import { runMap } from "../src/commands/map.js";
import type { RpcChannelInfo, RpcGraphNode } from "@fiber-route-doctor/core";

const NODES: RpcGraphNode[] = [{ pubkey: "0xaa", node_name: "alpha", addresses: [], timestamp: "0x1" }];
const CHANNELS: RpcChannelInfo[] = [{
  channel_outpoint: "0x1", node1: "0xaa", node2: "0xbb", capacity: "0x64", funding_udt_type_script: null,
  update_info_of_node1: { timestamp: "0x1", enabled: true, fee_rate: "0x1", tlc_expiry_delta: "0x1", tlc_minimum_value: "0x0" },
  update_info_of_node2: null
}];

function deps() {
  return {
    fetchGraph: vi.fn(async () => ({ nodes: NODES, channels: CHANNELS, ownPubkey: "0xaa" })),
    writeFile: vi.fn(),
    print: vi.fn()
  };
}

describe("runMap", () => {
  it("writes a self-contained HTML file and announces it", async () => {
    const d = deps();
    expect(await runMap(["--url", "http://n/"], d)).toBe(0);
    const [path, content] = d.writeFile.mock.calls[0];
    expect(path).toBe("fiber-map.html");
    expect(String(content)).toContain("<svg");
    expect(String(content)).not.toMatch(/https?:\/\//);
    expect(String(d.print.mock.calls[0][0])).toContain("wrote fiber-map.html (2 nodes, 1 channels)");
  });
  it("--json prints the model and writes nothing", async () => {
    const d = deps();
    await runMap(["--url", "http://n/", "--json"], d);
    expect(d.writeFile).not.toHaveBeenCalled();
    const body = JSON.parse(String(d.print.mock.calls[0][0]));
    expect(body.stats).toEqual({ nodeCount: 2, channelCount: 1, totalCapacity: "100" });
    expect(body.nodes.find((n: { pubkey: string }) => n.pubkey === "0xaa").isOwn).toBe(true);
  });
  it("returns 2 and prints usage error on bad args", async () => {
    const d = deps();
    expect(await runMap([], d)).toBe(2);
    expect(String(d.print.mock.calls[0][0])).toContain("--url");
  });
  it("never leaks the biscuit token into the HTML or JSON output", async () => {
    const d = deps();
    await runMap(["--url", "http://n/", "--biscuit", "SECRET-TOKEN-123"], d);
    expect(String(d.writeFile.mock.calls[0][1])).not.toContain("SECRET-TOKEN-123");
    const d2 = deps();
    await runMap(["--url", "http://n/", "--biscuit", "SECRET-TOKEN-123", "--json"], d2);
    expect(String(d2.print.mock.calls[0][0])).not.toContain("SECRET-TOKEN-123");
  });
});
