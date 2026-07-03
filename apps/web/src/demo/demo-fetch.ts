import type { RpcChannelInfo } from "@fiber-route-doctor/core";
import fixtures from "./fixtures.json";

const normalizeChannels = (chans: Array<Record<string, unknown>>) =>
  chans.map((c: any) => ({ ...c, funding_udt_type_script: c.udt_type_script, udt_type_script: undefined }));

const RESULT_BY_METHOD: Record<string, unknown> = {
  node_info: fixtures.nodeInfo,
  list_peers: { peers: fixtures.listPeers },
  list_channels: { channels: normalizeChannels(fixtures.listChannels as any) },
  graph_nodes: { nodes: fixtures.graphNodes },
  graph_channels: { channels: normalizeChannels(fixtures.graphChannels as any) }
};

/** A fetch impl that serves the bundled real testnet snapshot — no node, no CORS. */
export const demoFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
  const result = RESULT_BY_METHOD[body.method ?? ""] ?? null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const DEMO_AMOUNT_VALUE = "1000";

type FixtureChannel = RpcChannelInfo | Record<string, any>;

/** Endpoints of the highest-capacity channel — guarantees a direct route exists. */
export function pickDemoRoute(channels: RpcChannelInfo[]): { source: string; target: string; amount: string } {
  const asAny = channels as FixtureChannel[];
  const ckbEnabled = asAny.filter((c: any) => c.udt_type_script === null && c.update_info_of_node1?.enabled && c.update_info_of_node2?.enabled);
  const pool = ckbEnabled.length > 0 ? ckbEnabled : asAny;
  let best = pool[0];
  for (const c of pool) if (BigInt((c as any).capacity) > BigInt((best as any).capacity)) best = c;
  return { source: (best as any).node1, target: (best as any).node2, amount: DEMO_AMOUNT_VALUE };
}

const route = pickDemoRoute(fixtures.graphChannels as any);
export const DEMO_SOURCE = route.source;
export const DEMO_TARGET = route.target;
export const DEMO_AMOUNT = route.amount;
