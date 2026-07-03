import type { Hex, RpcChannelInfo, RpcGraphNode } from "./types.js";
import type { HubEntry, MapEdge, MapNode, NetworkMapModel } from "./network-map-types.js";

const HUB_COUNT = 10;

function edgeDisabled(c: RpcChannelInfo): boolean {
  const dir1 = c.update_info_of_node1?.enabled ?? false;
  const dir2 = c.update_info_of_node2?.enabled ?? false;
  return !dir1 && !dir2;
}

export function buildNetworkMapModel(graphNodes: RpcGraphNode[], graphChannels: RpcChannelInfo[], ownPubkey?: Hex): NetworkMapModel {
  const names = new Map<string, string | null>();
  for (const n of graphNodes) names.set(n.pubkey, n.node_name ?? null);
  const degree = new Map<string, number>();
  const capacity = new Map<string, bigint>();
  let totalCapacity = 0n;
  const edges: MapEdge[] = graphChannels.map((c) => {
    const cap = BigInt(c.capacity);
    totalCapacity += cap;
    for (const endpoint of [c.node1, c.node2]) {
      degree.set(endpoint, (degree.get(endpoint) ?? 0) + 1);
      capacity.set(endpoint, (capacity.get(endpoint) ?? 0n) + cap);
      if (!names.has(endpoint)) names.set(endpoint, null); // endpoint not gossiped in graph_nodes
    }
    return { outpoint: c.channel_outpoint, a: c.node1, b: c.node2, capacity: cap.toString(), disabled: edgeDisabled(c) };
  });
  const nodes: MapNode[] = [...names.entries()].map(([pubkey, name]) => ({
    pubkey,
    name,
    degree: degree.get(pubkey) ?? 0,
    totalCapacity: (capacity.get(pubkey) ?? 0n).toString(),
    isolated: (degree.get(pubkey) ?? 0) === 0,
    isOwn: pubkey === ownPubkey
  }));
  const hubs: HubEntry[] = nodes
    .filter((n) => n.degree > 0)
    .sort((x: MapNode, y: MapNode) => {
      const capDiff = BigInt(y.totalCapacity) - BigInt(x.totalCapacity);
      if (capDiff !== 0n) return capDiff > 0n ? 1 : -1;
      if (y.degree !== x.degree) return y.degree - x.degree;
      return x.pubkey < y.pubkey ? -1 : 1;
    })
    .slice(0, HUB_COUNT)
    .map((n: MapNode) => ({ pubkey: n.pubkey, name: n.name, degree: n.degree, totalCapacity: n.totalCapacity }));
  return { nodes, edges, hubs, stats: { nodeCount: nodes.length, channelCount: edges.length, totalCapacity: totalCapacity.toString() } };
}
