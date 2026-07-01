import { GraphClient } from "./graph-client.js";
import type { RpcChannel, RpcNodeInfo, RpcPeerInfo } from "./health-types.js";

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
