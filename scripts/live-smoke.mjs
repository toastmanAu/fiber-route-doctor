// Live smoke test. Skips unless FIBER_RPC_URL is set.
// Usage: FIBER_RPC_URL=http://127.0.0.1:8227 node --import tsx scripts/live-smoke.mjs
import { GraphClient, loadGraph } from "../packages/core/src/index.ts";

const url = process.env.FIBER_RPC_URL;
if (!url) { console.log("SKIP live-smoke: set FIBER_RPC_URL to run"); process.exit(0); }

const client = new GraphClient({ url, biscuit: process.env.FIBER_BISCUIT });
const model = await loadGraph(client);
const edges = model.allEdges();
console.log(`OK: loaded graph with ${edges.length} directed edges`);
if (edges.length > 0) {
  const e = edges[0];
  console.log(`sample edge: ${e.from} -> ${e.to} asset=${e.asset} feeRate=${e.feeRate} min=${e.tlcMinimumValue} enabled=${e.enabled}`);
}
