import type { RpcChannel } from "@fiber-route-doctor/core";

const MARCH = ["NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady", "ChannelReady"] as const;
const CHANNEL_METHODS = new Set(["connect_peer", "open_channel", "list_channels", "update_channel", "shutdown_channel"]);

interface SimChannel extends RpcChannel { _closedPolls?: number; }

const err = (id: number | undefined, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status: 200, headers: { "Content-Type": "application/json" } });
const ok = (id: number | undefined, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "Content-Type": "application/json" } });

/**
 * Stateful fetch for the hosted demo: channel methods run against an in-memory list whose
 * pending states advance ONE step per list_channels poll; everything else delegates to `base`.
 * Error-faithful: -32999 without an Authorization header; method error for unknown channel ids.
 * State is per-factory-call — recreate on demo-toggle to reset.
 */
export function makeChannelSimFetch(base: typeof fetch): typeof fetch {
  const sim: SimChannel[] = [];
  let counter = 0;

  return (async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string; params?: unknown[] };
    const method = body.method ?? "";
    if (!CHANNEL_METHODS.has(method)) return base(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (!headers["Authorization"]) return err(body.id, -32999, "Unauthorized");
    const p = (body.params?.[0] ?? {}) as Record<string, unknown>;

    switch (method) {
      case "connect_peer":
        return ok(body.id, null);
      case "open_channel": {
        const id = `0x53494d${(++counter).toString(16).padStart(58, "0")}`; // "SIM"-prefixed hex id
        sim.push({
          channel_id: id, pubkey: String(p.pubkey ?? "0x02"), state: { state_name: MARCH[0] },
          local_balance: String(p.funding_amount ?? "0x0"), remote_balance: "0x0",
          offered_tlc_balance: "0x0", received_tlc_balance: "0x0",
          enabled: false, is_public: p.public !== false, pending_tlcs: [],
          created_at: `0x${Date.now().toString(16)}`, funding_udt_type_script: null
        });
        return ok(body.id, { temporary_channel_id: id });
      }
      case "list_channels": {
        const result = sim.map(({ _closedPolls, ...c }) => c);
        for (const c of sim) {
          const i = (MARCH as readonly string[]).indexOf(c.state.state_name);
          if (i >= 0 && i < MARCH.length - 1) {
            c.state = { state_name: MARCH[i + 1] };
            if (MARCH[i + 1] === "ChannelReady") c.enabled = true;
          } else if (c.state.state_name === "Closed") {
            c._closedPolls = (c._closedPolls ?? 0) + 1;
          }
        }
        for (let i = sim.length - 1; i >= 0; i--) if ((sim[i]._closedPolls ?? 0) >= 2) sim.splice(i, 1);
        return ok(body.id, { channels: result });
      }
      case "update_channel": {
        const c = sim.find((x) => x.channel_id === p.channel_id);
        if (!c) return err(body.id, -32602, `channel not found: ${String(p.channel_id)}`);
        if (typeof p.enabled === "boolean") c.enabled = p.enabled;
        return ok(body.id, null);
      }
      case "shutdown_channel": {
        const c = sim.find((x) => x.channel_id === p.channel_id);
        if (!c) return err(body.id, -32602, `channel not found: ${String(p.channel_id)}`);
        c.state = { state_name: "Closed" };
        c.enabled = false;
        return ok(body.id, null);
      }
    }
    return base(input, init);
  }) as typeof fetch;
}
