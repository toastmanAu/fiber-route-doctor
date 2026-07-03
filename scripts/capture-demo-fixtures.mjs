// Capture a real testnet snapshot into the bundled demo fixture.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/capture-demo-fixtures.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP capture-demo-fixtures: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const client = new HealthClient({ url, biscuit: token });

const fixtures = {
  graphNodes: await client.graphNodes(),
  graphChannels: await client.graphChannels(),
  nodeInfo: await client.nodeInfo(),
  listPeers: await client.listPeers(),
  listChannels: await client.listChannels()
};

const outPath = "apps/web/src/demo/fixtures.json";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(fixtures));
console.log(`OK: wrote ${outPath} — ${fixtures.graphNodes.length} nodes, ${fixtures.graphChannels.length} channels, ${fixtures.listChannels.length} own channels, fnn v${fixtures.nodeInfo.version}`);
