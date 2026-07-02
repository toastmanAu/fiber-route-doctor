// Probe a live Fiber node's health with a freshly minted readonly token.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/health-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient, runHealthProbe, formatHealthText } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP health-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const report = await runHealthProbe(new HealthClient({ url, biscuit: token }));
console.log(formatHealthText(report));
if (!report.node?.version) { console.error("FAIL: node_info did not return a version"); process.exit(1); }
console.log(`OK: verdict ${report.verdict}, fnn v${report.node.version}, ${report.node.peersCount} peers, ${report.node.channelCount} channels`);
