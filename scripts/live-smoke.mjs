// Live smoke test. Skips unless FIBER_RPC_URL is set.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/live-smoke.mjs
// Auth: mints a readonly token from FRD_BISCUIT_KEY (like the other smokes);
//       a pre-minted FIBER_BISCUIT token takes precedence if set.
import { readFileSync } from "node:fs";
import { GraphClient, loadGraph } from "../packages/core/src/index.ts";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";

const url = process.env.FIBER_RPC_URL;
if (!url) { console.log("SKIP live-smoke: set FIBER_RPC_URL to run"); process.exit(0); }

let biscuit = process.env.FIBER_BISCUIT;
if (!biscuit && process.env.FRD_BISCUIT_KEY) {
  const key = importPrivateKeyString(readFileSync(process.env.FRD_BISCUIT_KEY, "utf8"));
  biscuit = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
}

const client = new GraphClient({ url, biscuit });
const model = await loadGraph(client);
const edges = model.allEdges();
console.log(`OK: loaded graph with ${edges.length} directed edges`);
if (edges.length > 0) {
  const e = edges[0];
  console.log(`sample edge: ${e.from} -> ${e.to} asset=${e.asset} feeRate=${e.feeRate} min=${e.tlcMinimumValue} enabled=${e.enabled}`);
}
