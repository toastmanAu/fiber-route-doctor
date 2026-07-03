import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import type { Hex } from "./types.js";
import type { LayoutPoint, NetworkMapModel } from "./network-map-types.js";

const MARGIN = 24;
const DEFAULT_TICKS = 300;
const GOLDEN_ANGLE = 2.399963229728653;
const LINK_DIST_MAX = 100;
const LINK_DIST_MIN = 50;

interface SimNode extends SimulationNodeDatum { id: string; }
interface SimLink { source: string; target: string; }

export function computeLayout(model: NetworkMapModel, opts: { width: number; height: number; ticks?: number }): Map<Hex, LayoutPoint> {
  const { width, height } = opts;
  const ticks = opts.ticks ?? DEFAULT_TICKS;
  // deterministic phyllotaxis initial positions — no randomness anywhere
  const simNodes: SimNode[] = model.nodes.map((n, i) => ({
    id: n.pubkey,
    x: width / 2 + 12 * Math.sqrt(i + 0.5) * Math.cos(i * GOLDEN_ANGLE),
    y: height / 2 + 12 * Math.sqrt(i + 0.5) * Math.sin(i * GOLDEN_ANGLE)
  }));
  const links: SimLink[] = model.edges.map((e) => ({ source: e.a, target: e.b }));
  const maxEdgeCap = model.edges.reduce((m, e) => { const c = BigInt(e.capacity); return c > m ? c : m; }, 0n);
  const linkDistance = (i: number): number => {
    if (maxEdgeCap === 0n) return LINK_DIST_MAX;
    const ratio = Number((BigInt(model.edges[i].capacity) * 100n) / maxEdgeCap) / 100;
    return LINK_DIST_MAX - (LINK_DIST_MAX - LINK_DIST_MIN) * ratio; // higher capacity pulls closer
  };
  const sim = forceSimulation<SimNode>(simNodes)
    .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((_l, i) => linkDistance(i)).strength(0.5))
    .force("charge", forceManyBody<SimNode>().strength(-80))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide<SimNode>(14))
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
  const out = new Map<Hex, LayoutPoint>();
  for (const n of simNodes) {
    out.set(n.id, {
      x: Math.min(width - MARGIN, Math.max(MARGIN, n.x ?? width / 2)),
      y: Math.min(height - MARGIN, Math.max(MARGIN, n.y ?? height / 2))
    });
  }
  return out;
}
