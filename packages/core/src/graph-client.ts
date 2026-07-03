import type { RpcChannelInfo, RpcGraphNode } from "./types.js";

export interface GraphClientOptions { url: string; biscuit?: string; fetchImpl?: typeof fetch; }

// fnn's graph_nodes/graph_channels RPCs cap each page at this many items
// (crates/fiber-lib/src/rpc/graph.rs: default_max_limit = 500). A page
// this full plus a returned last_cursor means more results may follow.
const GRAPH_PAGE_LIMIT = 500;

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
    return this.paginate<RpcGraphNode>("graph_nodes", (r) => (Array.isArray(r) ? r : r.nodes));
  }
  async graphChannels(): Promise<RpcChannelInfo[]> {
    return this.paginate<RpcChannelInfo>("graph_channels", (r) => (Array.isArray(r) ? r : r.channels));
  }

  /**
   * Fetches all pages of a paginated graph_* RPC and concatenates them.
   * The node returns a full page (length === GRAPH_PAGE_LIMIT) plus a
   * `last_cursor` when more results may follow; we keep requesting
   * `{ after: last_cursor }` until a short page or a missing cursor signals
   * the end. The bare-array response shape carries no cursor, so it is
   * always treated as a single page.
   */
  private async paginate<T>(
    method: string,
    extract: (r: { last_cursor?: string } & Record<string, T[]> | T[]) => T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let after: string | undefined;
    for (;;) {
      const params = after === undefined ? [{}] : [{ after }];
      const r = await this.call<{ last_cursor?: string } & Record<string, T[]> | T[]>(method, params);
      const batch = extract(r);
      items.push(...batch);
      const lastCursor = Array.isArray(r) ? undefined : r.last_cursor;
      if (batch.length === GRAPH_PAGE_LIMIT && lastCursor) {
        after = lastCursor;
      } else {
        break;
      }
    }
    return items;
  }
}
