import { HealthClient } from "./health-client.js";
import type {
  RpcConnectPeerParams, RpcOpenChannelParams, RpcOpenChannelResult,
  RpcUpdateChannelParams, RpcShutdownChannelParams
} from "./channel-types.js";

/** Channel lifecycle RPCs. Inherits auth, error taxonomy, and listChannels() from HealthClient. */
export class ChannelClient extends HealthClient {
  async connectPeer(p: RpcConnectPeerParams): Promise<void> {
    await this.call("connect_peer", [p]);
  }
  async openChannel(p: RpcOpenChannelParams): Promise<RpcOpenChannelResult> {
    return this.call<RpcOpenChannelResult>("open_channel", [p]);
  }
  async updateChannel(p: RpcUpdateChannelParams): Promise<void> {
    await this.call("update_channel", [p]);
  }
  async shutdownChannel(p: RpcShutdownChannelParams): Promise<void> {
    await this.call("shutdown_channel", [p]);
  }
}
