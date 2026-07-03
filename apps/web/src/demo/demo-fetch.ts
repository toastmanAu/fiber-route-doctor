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

/** Endpoints of the highest-capacity channel — guarantees a direct route exists. */
export function pickDemoRoute(channels: RpcChannelInfo[]): { source: string; target: string; amount: string } {
  const ckbEnabled = channels.filter(
    (c) => c.udt_type_script === null && (c.update_info_of_node1?.enabled || c.update_info_of_node2?.enabled)
  );
  const pool = ckbEnabled.length > 0 ? ckbEnabled : channels;
  let best = pool[0];
  for (const c of pool) if (BigInt(c.capacity) > BigInt(best.capacity)) best = c;
  return { source: best.node1, target: best.node2, amount: DEMO_AMOUNT_VALUE };
}

const route = pickDemoRoute(fixtures.graphChannels as any);
export const DEMO_SOURCE = route.source;
export const DEMO_TARGET = route.target;
export const DEMO_AMOUNT = route.amount;
