// Snapshot a live Fiber node's channel liquidity with a freshly minted readonly token.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/liquidity-live-smoke.mjs
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient, buildLiquiditySnapshot, computeLiquidityReport, formatLiquidityText } from "../packages/core/src/index.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP liquidity-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const channels = await new HealthClient({ url, biscuit: token }).listChannels();
const snapshot = buildLiquiditySnapshot(channels, url, new Date().toISOString());
const report = computeLiquidityReport(snapshot);
console.log(formatLiquidityText(report, snapshot));
console.log(`OK: snapshot built — ${snapshot.channels.length} channel(s), ${report.assets.length} asset(s), ${report.excludedChannels} excluded`);
