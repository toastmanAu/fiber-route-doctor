import type { ProbeRequest, ProbeResult } from "./types.js";

export interface BuildRouterParams {
  amount: string;
  udt_type_script: null;
  hops_info: Array<{ pubkey: string }>;
  max_fee_rate?: string;
}
export interface RouterCaller {
  buildRouter(params: BuildRouterParams): Promise<{ router_hops: Array<{ channel_outpoint?: string }> }>;
}

export function toBuildRouterParams(probe: ProbeRequest): BuildRouterParams {
  const params: BuildRouterParams = {
    amount: `0x${probe.amount.toString(16)}`,
    udt_type_script: null, // MVP cross-check targets CKB; UDT support is a stretch goal
    hops_info: [{ pubkey: probe.target }]
  };
  if (probe.maxFeeRate !== undefined) params.max_fee_rate = `0x${probe.maxFeeRate.toString(16)}`;
  return params;
}

export async function crossCheckRouter(caller: RouterCaller, probe: ProbeRequest): Promise<ProbeResult> {
  try {
    const res = await caller.buildRouter(toBuildRouterParams(probe));
    const channelOutpoints = res.router_hops.map(h => h.channel_outpoint).filter((x): x is string => typeof x === "string");
    return { kind: "router_path", channelOutpoints };
  } catch (err) {
    return { kind: "router_error", message: err instanceof Error ? err.message : String(err) };
  }
}
