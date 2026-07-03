export const NODE_R_MIN = 4;
export const NODE_R_MAX = 20;
export const EDGE_W_MIN = 1;
export const EDGE_W_MAX = 6;
export const ROUTE_EXTRA_WIDTH = 2;

export const COLOR_OWN = "#3498db";
export const COLOR_HUB = "#2ecc71";
export const COLOR_ISOLATED = "#e74c3c";
export const COLOR_NODE = "#95a5a6";
export const COLOR_EDGE = "#7f8c8d";
export const COLOR_EDGE_DISABLED = "#e74c3c";
export const COLOR_ROUTE = "#f1c40f";

/** sqrt-scale a bigint-string value in [0, max] onto [outMin, outMax]; max<=0 or value<=0 -> outMin. */
function sqrtScale(value: string, max: string, outMin: number, outMax: number): number {
  const v = BigInt(value), m = BigInt(max);
  if (m <= 0n || v <= 0n) return outMin;
  // ratio via scaled integer division to stay exact for u128 values
  const ratio = Math.sqrt(Number((v * 10_000n) / m) / 10_000);
  return outMin + (outMax - outMin) * Math.min(1, ratio);
}

export function nodeRadius(capacity: string, maxCapacity: string): number {
  return sqrtScale(capacity, maxCapacity, NODE_R_MIN, NODE_R_MAX);
}
export function edgeWidth(capacity: string, maxCapacity: string): number {
  return sqrtScale(capacity, maxCapacity, EDGE_W_MIN, EDGE_W_MAX);
}
export function nodeColor(n: { isOwn: boolean; isolated: boolean }, isHub: boolean): string {
  if (n.isOwn) return COLOR_OWN;
  if (isHub) return COLOR_HUB;
  if (n.isolated) return COLOR_ISOLATED;
  return COLOR_NODE;
}
