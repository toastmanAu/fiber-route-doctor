// Prove the in-browser custody path end-to-end against an auth-enabled node, both layers:
//   1. a token minted from a FRESH random wallet key must be REJECTED (-32999) — auth is enforced;
//   2. the node's own key imported through the browser importWallet path, then minted, must be ACCEPTED.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/wallet-live-smoke.mjs
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { IdbKeystore, IdbProfileStore, createWallet, importWallet, mint } from "../packages/biscuit/src/browser/index.ts";

const url = process.env.FIBER_RPC_URL;
const keyPath = process.env.FRD_BISCUIT_KEY;
if (!url || !keyPath) { console.log("SKIP wallet-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const probe = async (token) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "graph_channels", params: [{}] })
  });
  return res.json();
};

// Layer 1: fresh random wallet -> node MUST reject (proves biscuit auth is actually enforced).
const strangerKs = new IdbKeystore();
await createWallet(strangerKs, "smoke-pass");
const stranger = await mint(strangerKs, { passphrase: "smoke-pass", scope: "readonly", expiryDays: 1, url, profileName: "stranger" }, new IdbProfileStore());
const rejected = await probe(stranger.token);
if (!rejected.error || rejected.error.code !== -32999) {
  console.error(`FAIL: node ACCEPTED a stranger-key token (auth not enforced?): ${JSON.stringify(rejected.error ?? "ok")}`);
  process.exit(1);
}

// Layer 2: node's own key through the browser import path -> mint -> node MUST accept.
const operatorKs = new IdbKeystore();
await importWallet(operatorKs, readFileSync(keyPath.replace(/^~/, process.env.HOME), "utf8").trim(), "privatekey", "smoke-pass");
const operator = await mint(operatorKs, { passphrase: "smoke-pass", scope: "readonly", expiryDays: 1, url, profileName: "operator" }, new IdbProfileStore());
const accepted = await probe(operator.token);
if (accepted.error) {
  console.error(`FAIL: node rejected the imported-node-key token: ${accepted.error.code} ${accepted.error.message}`);
  process.exit(1);
}
const n = (accepted.result.channels ?? accepted.result).length;
console.log(`OK: stranger token rejected (-32999) and imported-node-key token accepted — graph_channels returned ${n} channels (first page)`);
