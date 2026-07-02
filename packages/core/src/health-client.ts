import { GraphClient, RpcMethodError, RpcHttpError } from "./graph-client.js";
import type { RpcChannel, RpcNodeInfo, RpcPeerInfo, HealthSnapshot, RpcOutcome } from "./health-types.js";

export class HealthClient extends GraphClient {
  async nodeInfo(): Promise<RpcNodeInfo> {
    return this.call<RpcNodeInfo>("node_info", []);
  }
  async listPeers(): Promise<RpcPeerInfo[]> {
    return (await this.call<{ peers: RpcPeerInfo[] }>("list_peers", [])).peers;
  }
  async listChannels(): Promise<RpcChannel[]> {
    return (await this.call<{ channels: RpcChannel[] }>("list_channels", [{}])).channels;
  }
}

const UNAUTHORIZED_CODE = -32999; // fnn BiscuitAuthMiddleware auth_reject_error()

function classifyFailure(e: unknown): RpcOutcome {
  if (e instanceof RpcMethodError && e.code === UNAUTHORIZED_CODE) {
    return { ok: false, kind: "auth-denied", detail: e.message };
  }
  // HTTP 401/403 means a reverse proxy in front of the node rejected the request on auth grounds —
  // the node WAS reached, so this is auth-denied, not a transport failure.
  if (e instanceof RpcHttpError && (e.status === 401 || e.status === 403)) {
    return { ok: false, kind: "auth-denied", detail: e.message };
  }
  return { ok: false, kind: "transport-error", detail: e instanceof Error ? e.message : String(e) };
}

/** Runs all three health RPCs, capturing each failure independently — never rejects for call failures. */
export async function collectHealthSnapshot(client: HealthClient): Promise<HealthSnapshot> {
  const [ni, pe, ch] = await Promise.allSettled([client.nodeInfo(), client.listPeers(), client.listChannels()]);
  return {
    nodeInfo: ni.status === "fulfilled" ? ni.value : undefined,
    peers: pe.status === "fulfilled" ? pe.value : undefined,
    channels: ch.status === "fulfilled" ? ch.value : undefined,
    outcomes: {
      nodeInfo: ni.status === "fulfilled" ? { ok: true } : classifyFailure(ni.reason),
      listPeers: pe.status === "fulfilled" ? { ok: true } : classifyFailure(pe.reason),
      listChannels: ch.status === "fulfilled" ? { ok: true } : classifyFailure(ch.reason)
    }
  };
}
