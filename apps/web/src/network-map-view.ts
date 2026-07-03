import {
  COLOR_EDGE, COLOR_EDGE_DISABLED, COLOR_ROUTE, ROUTE_EXTRA_WIDTH,
  edgeWidth, nodeColor, nodeRadius,
  type LayoutPoint, type NetworkMapModel
} from "@fiber-route-doctor/core";

export interface ViewNode { pubkey: string; x: number; y: number; r: number; color: string; label: string | null; isOwn: boolean; }
export interface ViewEdge { outpoint: string; x1: number; y1: number; x2: number; y2: number; width: number; color: string; dashed: boolean; onRoute: boolean; }
export interface NetworkMapView { nodes: ViewNode[]; edges: ViewEdge[]; empty: boolean; }

const maxOf = (values: string[]): string =>
  values.reduce((m, v) => (BigInt(v) > BigInt(m) ? v : m), "0");

export function buildNetworkMapView(model: NetworkMapModel, positions: Map<string, LayoutPoint>, routeOutpoints: string[] = []): NetworkMapView {
  const hubs = new Set(model.hubs.map((h) => h.pubkey));
  const route = new Set(routeOutpoints);
  const maxNodeCap = maxOf(model.nodes.map((n) => n.totalCapacity));
  const maxEdgeCap = maxOf(model.edges.map((e) => e.capacity));
  const nodes: ViewNode[] = model.nodes.flatMap((n) => {
    const p = positions.get(n.pubkey);
    if (!p) return [];
    return [{ pubkey: n.pubkey, x: p.x, y: p.y, r: nodeRadius(n.totalCapacity, maxNodeCap), color: nodeColor(n, hubs.has(n.pubkey)), label: n.name, isOwn: n.isOwn }];
  });
  const edges: ViewEdge[] = model.edges.flatMap((e) => {
    const pa = positions.get(e.a), pb = positions.get(e.b);
    if (!pa || !pb) return [];
    const onRoute = route.has(e.outpoint);
    return [{
      outpoint: e.outpoint, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
      width: edgeWidth(e.capacity, maxEdgeCap) + (onRoute ? ROUTE_EXTRA_WIDTH : 0),
      color: onRoute ? COLOR_ROUTE : e.disabled ? COLOR_EDGE_DISABLED : COLOR_EDGE,
      dashed: e.disabled && !onRoute,
      onRoute
    }];
  });
  return { nodes, edges, empty: model.nodes.length === 0 };
}
