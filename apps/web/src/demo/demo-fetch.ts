import type { RpcChannelInfo } from "@fiber-route-doctor/core";
import fixtures from "./fixtures.json";

const RESULT_BY_METHOD: Record<string, unknown> = {
  node_info: fixtures.nodeInfo,
  list_peers: { peers: fixtures.listPeers },
  list_channels: { channels: fixtures.listChannels },
  graph_nodes: { nodes: fixtures.graphNodes },
  graph_channels: { channels: fixtures.graphChannels }
};

/** A fetch impl that serves the bundled real testnet snapshot — no node, no CORS. */
export const demoFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
  const result = RESULT_BY_METHOD[body.method ?? ""] ?? null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const DEMO_AMOUNT_VALUE = "1000";
const EMPTY_ROUTE = { source: "", target: "", amount: DEMO_AMOUNT_VALUE };

function highestCapacity(pool: RpcChannelInfo[]): RpcChannelInfo {
  let best = pool[0];
  for (const c of pool) if (BigInt(c.capacity) > BigInt(best.capacity)) best = c;
  return best;
}

/**
 * Endpoints of a channel that guarantees a direct, payable source->target route.
 *
 * The returned route always sets source=node1, target=node2, and the direct
 * source->target edge is derived from `update_info_of_node1` — so the pool
 * MUST be filtered to channels where that specific direction is enabled,
 * not "either direction enabled".
 */
export function pickDemoRoute(channels: RpcChannelInfo[]): { source: string; target: string; amount: string } {
  if (channels.length === 0) return EMPTY_ROUTE;

  const ckbChannels = channels.filter((c) => c.udt_type_script === null);
  const directPayable = ckbChannels.filter((c) => c.update_info_of_node1?.enabled === true);

  const pool = directPayable.length > 0 ? directPayable : ckbChannels.length > 0 ? ckbChannels : channels;
  const best = highestCapacity(pool);
  return { source: best.node1, target: best.node2, amount: DEMO_AMOUNT_VALUE };
}

const route = pickDemoRoute(fixtures.graphChannels as unknown as RpcChannelInfo[]);
export const DEMO_SOURCE = route.source;
export const DEMO_TARGET = route.target;
export const DEMO_AMOUNT = route.amount;
