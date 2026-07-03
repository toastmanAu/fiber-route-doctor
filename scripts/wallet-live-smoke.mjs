// Prove the in-browser custody path end-to-end: create wallet → mint token → node accepts it.
// Usage: FIBER_RPC_URL=http://127.0.0.1:8231 node --import tsx scripts/wallet-live-smoke.mjs
import "fake-indexeddb/auto";
import { IdbKeystore, IdbProfileStore, createWallet, mint } from "../packages/biscuit/src/browser/index.ts";

const url = process.env.FIBER_RPC_URL;
if (!url) { console.log("SKIP wallet-live-smoke: set FIBER_RPC_URL"); process.exit(0); }

const ks = new IdbKeystore();
await createWallet(ks, "smoke-pass");
const profile = await mint(ks, { passphrase: "smoke-pass", scope: "readonly", expiryDays: 1, url, profileName: "smoke" }, new IdbProfileStore());

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "graph_channels", params: [{}] })
});
const json = await res.json();
if (json.error) { console.error(`FAIL: node rejected the browser-minted token: ${json.error.code} ${json.error.message}`); process.exit(1); }
const n = (json.result.channels ?? json.result).length;
console.log(`OK: browser-minted readonly token accepted — graph_channels returned ${n} channels (first page)`);
