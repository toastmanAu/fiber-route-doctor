// Capture a real testnet snapshot into the bundled demo fixture.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/capture-demo-fixtures.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP capture-demo-fixtures: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });

async function call(method, params) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}
async function paginate(method, field) {
  let out = [], cursor;
  for (;;) {
    const r = await call(method, [cursor ? { after: cursor } : {}]);
    const batch = r[field] ?? [];
    out.push(...batch);
    if (batch.length !== 500) break;
    cursor = r.last_cursor;
    if (!cursor) break;
  }
  return out;
}

const fixtures = {
  graphNodes: await paginate("graph_nodes", "nodes"),
  graphChannels: await paginate("graph_channels", "channels"),
  nodeInfo: await call("node_info", []),
  listPeers: (await call("list_peers", [])).peers ?? [],
  listChannels: (await call("list_channels", [{}])).channels ?? []
};

const outPath = "apps/web/src/demo/fixtures.json";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(fixtures));
console.log(`OK: wrote ${outPath} — ${fixtures.graphNodes.length} nodes, ${fixtures.graphChannels.length} channels, ${fixtures.listChannels.length} own channels, fnn v${fixtures.nodeInfo.version}`);
