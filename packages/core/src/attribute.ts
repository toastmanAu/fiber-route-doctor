import type { GraphModel } from "./graph-model.js";
import type { DirectedEdge, Fix, ProbeRequest, Reason, ReasonCause } from "./types.js";

function edgeFailure(edge: DirectedEdge, probe: ProbeRequest): ReasonCause | null {
  if (!edge.enabled) return "channel_disabled";
  if (probe.amount < edge.tlcMinimumValue) return "below_min_value";
  if (edge.tlcMaximumValue !== null && probe.amount > edge.tlcMaximumValue) return "above_max_value";
  if (edge.capacity < probe.amount) return "insufficient_capacity";
  return null;
}

const FIX_FOR: Record<ReasonCause, string> = {
  target_absent: "Target node is not in the gossip graph — confirm the node is online and announced, or use its direct channel.",
  no_asset_channel: "Target has no channels — it must open at least one channel to receive payments.",
  asset_mismatch: "Target is only reachable via a different asset — open a channel in the requested asset, or route the other asset (cross-asset is CCH-only in Fiber).",
  channel_disabled: "A channel on the only route is disabled — wait for it to re-enable or find an alternate peer.",
  below_min_value: "Payment is below the hop's tlc_minimum_value — increase the amount or choose a channel with a lower minimum.",
  above_max_value: "Payment exceeds the hop's maximum — split the payment (MPP) or use a higher-capacity channel.",
  insufficient_capacity: "No hop has enough directional capacity — open/rebalance a larger channel toward the target.",
  expiry_over_limit: "Total timelock exceeds the ceiling — raise maxTotalExpiry or find a shorter path.",
  fee_over_limit: "Cheapest path still exceeds the fee ceiling — raise maxFeeRate or find a cheaper path.",
  router_declined: "The node's own router declined — inspect node logs / liquidity."
};

export function attributeBlock(model: GraphModel, probe: ProbeRequest): { reasons: Reason[]; fixes: Fix[] } {
  const mk = (cause: ReasonCause, detail: string): { reasons: Reason[]; fixes: Fix[] } =>
    ({ reasons: [{ cause, detail }], fixes: [{ detail: FIX_FOR[cause] }] });

  if (!model.hasNode(probe.target) && model.edgesTo(probe.target).length === 0) {
    return mk("target_absent", `Target ${probe.target} not present in the graph.`);
  }

  const intoTarget = model.edgesTo(probe.target);
  if (intoTarget.length === 0) return mk("no_asset_channel", `Target ${probe.target} has no channels.`);

  const assetEdges = intoTarget.filter(e => e.asset === probe.asset);
  if (assetEdges.length === 0) {
    const others = [...new Set(intoTarget.map(e => e.asset))].join(", ");
    return mk("asset_mismatch", `Target reachable only via asset(s) [${others}], not ${probe.asset}.`);
  }

  // Dominant failing constraint among the requested-asset edges into the target.
  const counts = new Map<ReasonCause, number>();
  for (const e of assetEdges) {
    const f = edgeFailure(e, probe);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  if (counts.size === 0) {
    // Edges into target are individually fine → block is upstream; report insufficient_capacity as the generic upstream cause.
    return mk("insufficient_capacity", `No usable end-to-end route to ${probe.target} despite viable final hops (upstream liquidity/asset gap).`);
  }
  const ranked = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const reasons: Reason[] = ranked.map(([cause, n]) => ({ cause, detail: `${n} final-hop channel(s) failed on ${cause}.` }));
  const fixes: Fix[] = ranked.map(([cause]) => ({ detail: FIX_FOR[cause] }));
  return { reasons, fixes };
}
