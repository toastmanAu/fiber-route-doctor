// Channel-manager live smoke: proves the AUTHORIZED write path without funding anything.
//   1. operator token accepted on connect_peer (FRD_PEER_ADDR peer);
//   2. open_channel with an absurd funding amount fails CLEANLY (error, not a hang/success).
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        FRD_PEER_ADDR=/ip4/../tcp/8228/p2p/Qm.. node --import tsx scripts/channel-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { ChannelClient, RpcMethodError } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
const peer = process.env.FRD_PEER_ADDR;
if (!keyPath || !url || !peer) { console.log("SKIP channel-live-smoke: set FRD_BISCUIT_KEY, FIBER_RPC_URL, FRD_PEER_ADDR"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("operator"), expiry: new Date(Date.now() + 3600e3) });
const client = new ChannelClient({ url, biscuit: token });

// 1. connect_peer must be AUTHORIZED (write("peers") via operator). Transport/peer errors are fine; -32999 is not.
try {
  await client.connectPeer({ address: peer });
  console.log("connect_peer: accepted");
} catch (e) {
  if (!(e instanceof RpcMethodError)) { console.error(`FAIL: transport error, nothing proven: ${e}`); process.exit(1); }
  if (e.code === -32999) { console.error("FAIL: operator token unauthorized on connect_peer"); process.exit(1); }
  console.log(`connect_peer: authorized (node reported: ${e.message ?? e})`);
}

// 2. absurd open must fail cleanly — proves the authorized open path w/o spending (100B CKB in shannons).
try {
  await client.openChannel({ pubkey: key.publicKeyString.replace("ed25519/", "0x02"), funding_amount: "0x" + (10_000_000_000_000_000_000n).toString(16) });
  console.error("FAIL: absurd open_channel unexpectedly succeeded");
  process.exit(1);
} catch (e) {
  if (!(e instanceof RpcMethodError)) { console.error(`FAIL: transport error, nothing proven: ${e}`); process.exit(1); }
  if (e.code === -32999) { console.error("FAIL: operator token unauthorized on open_channel"); process.exit(1); }
  console.log(`open_channel(absurd): rejected cleanly — ${e.message ?? e}`);
}
console.log("OK: operator write path authorized end-to-end; nothing was funded");
