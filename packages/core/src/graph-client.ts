import type { RpcChannelInfo, RpcGraphNode } from "./types.js";

export interface GraphClientOptions { url: string; biscuit?: string; fetchImpl?: typeof fetch; }

interface JsonRpcResponse<T> { result?: T; error?: { code: number; message: string }; }

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

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.biscuit) headers["Authorization"] = `Bearer ${this.biscuit}`;
    const res = await this.fetchImpl(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
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
