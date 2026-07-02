import type { RpcChannelInfo, RpcGraphNode } from "./types.js";

export interface GraphClientOptions { url: string; biscuit?: string; fetchImpl?: typeof fetch; }

interface JsonRpcResponse<T> { result?: T; error?: { code: number; message: string }; }

/** JSON-RPC method-level error (the node responded, the method failed). */
export class RpcMethodError extends Error {
  constructor(readonly method: string, readonly code: number, message: string) {
    super(`RPC ${method} error ${code}: ${message}`);
    this.name = "RpcMethodError";
  }
}

/** HTTP-level error (the node — or a reverse proxy in front of it — responded with a non-2xx status). */
export class RpcHttpError extends Error {
  constructor(readonly method: string, readonly status: number) {
    super(`RPC ${method} HTTP ${status}`);
    this.name = "RpcHttpError";
  }
}

export class GraphClient {
  private readonly url: string;
  private readonly biscuit?: string;
  private readonly fetchImpl: typeof fetch;
  private id = 0;

  constructor(opts: GraphClientOptions) {
    this.url = opts.url;
    this.biscuit = opts.biscuit;
    // bind to globalThis to avoid native-fetch brand-check "Illegal invocation"
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  protected async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.biscuit) headers["Authorization"] = `Bearer ${this.biscuit}`;
    const res = await this.fetchImpl(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!res.ok) throw new RpcHttpError(method, res.status);
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) throw new RpcMethodError(method, json.error.code, json.error.message);
    return json.result as T;
  }

  async graphNodes(): Promise<RpcGraphNode[]> {
    const r = await this.call<{ nodes: RpcGraphNode[] } | RpcGraphNode[]>("graph_nodes", [{}]);
    return Array.isArray(r) ? r : r.nodes;
  }
  async graphChannels(): Promise<RpcChannelInfo[]> {
    const r = await this.call<{ channels: RpcChannelInfo[] } | RpcChannelInfo[]>("graph_channels", [{}]);
    return Array.isArray(r) ? r : r.channels;
  }
}
