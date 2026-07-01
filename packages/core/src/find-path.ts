import type { DirectedEdge, Hex, ProbeRequest, ReportHop } from "./types.js";
import type { GraphModel } from "./graph-model.js";

export interface PathResult { hops: ReportHop[]; totalFee: bigint; totalExpiry: bigint; }

export function hopFee(amount: bigint, feeRate: bigint): bigint {
  return (amount * feeRate) / 1000n; // per-thousand, matching Fiber max_fee_rate semantics
}

export function edgeUsable(edge: DirectedEdge, probe: ProbeRequest): boolean {
  if (!edge.enabled) return false;
  if (edge.asset !== probe.asset) return false;
  if (edge.capacity < probe.amount) return false;
  if (probe.amount < edge.tlcMinimumValue) return false;
  if (edge.tlcMaximumValue !== null && probe.amount > edge.tlcMaximumValue) return false;
  return true;
}

// Dijkstra over usable edges, minimizing total fee. Deterministic tie-break by node key.
export function findBestPath(model: GraphModel, probe: ProbeRequest): PathResult | null {
  if (probe.source === probe.target) return { hops: [], totalFee: 0n, totalExpiry: 0n };

  const best = new Map<Hex, bigint>([[probe.source, 0n]]);
  const prev = new Map<Hex, DirectedEdge>();
  const visited = new Set<Hex>();

  while (true) {
    // pick unvisited node with smallest known cost (deterministic tie-break)
    let cur: Hex | null = null;
    let curCost = 0n;
    for (const [node, cost] of best) {
      if (visited.has(node)) continue;
      if (cur === null || cost < curCost || (cost === curCost && node < cur)) { cur = node; curCost = cost; }
    }
    if (cur === null) break;
    if (cur === probe.target) break;
    visited.add(cur);

    for (const edge of model.edgesFrom(cur)) {
      if (!edgeUsable(edge, probe)) continue;
      const cost = curCost + hopFee(probe.amount, edge.feeRate);
      const known = best.get(edge.to);
      if (known === undefined || cost < known) { best.set(edge.to, cost); prev.set(edge.to, edge); }
    }
  }

  if (!prev.has(probe.target)) return null;

  const edges: DirectedEdge[] = [];
  let node = probe.target;
  while (node !== probe.source) {
    const e = prev.get(node)!;
    edges.unshift(e);
    node = e.from;
  }

  let totalFee = 0n, totalExpiry = 0n;
  const hops: ReportHop[] = edges.map((e, i) => {
    const fee = hopFee(probe.amount, e.feeRate);
    totalFee += fee; totalExpiry += e.tlcExpiryDelta;
    return { index: i, from: e.from, to: e.to, channelOutpoint: e.channelOutpoint, asset: e.asset, fee, expiryDelta: e.tlcExpiryDelta };
  });
  return { hops, totalFee, totalExpiry };
}
