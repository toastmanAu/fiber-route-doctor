import { assetIdOf } from "./asset.js";
import type { AssetId, DirectedEdge, GraphNodeInfo, Hex, RpcChannelInfo, RpcChannelUpdateInfo, RpcGraphNode } from "./types.js";

function bi(hex: Hex): bigint { return BigInt(hex); }

function makeEdge(
  outpoint: Hex, from: Hex, to: Hex, asset: AssetId, capacity: bigint, u: RpcChannelUpdateInfo
): DirectedEdge {
  return {
    channelOutpoint: outpoint,
    from, to, asset, capacity,
    enabled: u.enabled,
    feeRate: bi(u.fee_rate),
    tlcExpiryDelta: bi(u.tlc_expiry_delta),
    tlcMinimumValue: bi(u.tlc_minimum_value),
    tlcMaximumValue: u.tlc_maximum_value === undefined ? null : bi(u.tlc_maximum_value)
  };
}

export class GraphModel {
  private constructor(
    private readonly nodes: Map<Hex, GraphNodeInfo>,
    private readonly outgoing: Map<Hex, DirectedEdge[]>,
    private readonly incoming: Map<Hex, DirectedEdge[]>,
    private readonly edges: DirectedEdge[]
  ) {}

  static fromRpc(nodes: RpcGraphNode[], channels: RpcChannelInfo[]): GraphModel {
    const nodeMap = new Map<Hex, GraphNodeInfo>();
    for (const n of nodes) nodeMap.set(n.pubkey, { pubkey: n.pubkey, name: n.node_name ?? null, addresses: [...n.addresses] });

    const outgoing = new Map<Hex, DirectedEdge[]>();
    const incoming = new Map<Hex, DirectedEdge[]>();
    const edges: DirectedEdge[] = [];
    const push = (map: Map<Hex, DirectedEdge[]>, key: Hex, e: DirectedEdge) => {
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    };

    for (const c of channels) {
      const asset = assetIdOf(c.funding_udt_type_script);
      const capacity = bi(c.capacity);
      if (c.update_info_of_node1) {
        const e = makeEdge(c.channel_outpoint, c.node1, c.node2, asset, capacity, c.update_info_of_node1);
        edges.push(e); push(outgoing, e.from, e); push(incoming, e.to, e);
      }
      if (c.update_info_of_node2) {
        const e = makeEdge(c.channel_outpoint, c.node2, c.node1, asset, capacity, c.update_info_of_node2);
        edges.push(e); push(outgoing, e.from, e); push(incoming, e.to, e);
      }
    }
    return new GraphModel(nodeMap, outgoing, incoming, edges);
  }

  hasNode(pubkey: Hex): boolean { return this.nodes.has(pubkey); }
  node(pubkey: Hex): GraphNodeInfo | undefined { return this.nodes.get(pubkey); }
  edgesFrom(pubkey: Hex): DirectedEdge[] { return [...(this.outgoing.get(pubkey) ?? [])]; }
  edgesTo(pubkey: Hex): DirectedEdge[] { return [...(this.incoming.get(pubkey) ?? [])]; }
  allEdges(): DirectedEdge[] { return [...this.edges]; }
  assetsOf(pubkey: Hex): Set<AssetId> {
    const s = new Set<AssetId>();
    for (const e of this.edgesFrom(pubkey)) s.add(e.asset);
    for (const e of this.edgesTo(pubkey)) s.add(e.asset);
    return s;
  }
}
