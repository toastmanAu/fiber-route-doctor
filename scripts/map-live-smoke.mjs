// Build a network map from a live Fiber node's gossiped topology.
// Usage: FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 \
//        node --import tsx scripts/map-live-smoke.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPrivateKeyString, mintToken, scopeFacts } from "../packages/biscuit/src/index.ts";
import { HealthClient, buildNetworkMapModel, computeLayout } from "../packages/core/src/index.ts";
import { renderMapHtml } from "../apps/cli/src/map-html.ts";

const keyPath = process.env.FRD_BISCUIT_KEY;
const url = process.env.FIBER_RPC_URL;
if (!keyPath || !url) { console.log("SKIP map-live-smoke: set FRD_BISCUIT_KEY and FIBER_RPC_URL"); process.exit(0); }

const key = importPrivateKeyString(readFileSync(keyPath, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const client = new HealthClient({ url, biscuit: token });
const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
const ownPubkey = await client.nodeInfo().then((n) => n.pubkey).catch(() => undefined);
const model = buildNetworkMapModel(nodes, channels, ownPubkey);
const positions = computeLayout(model, { width: 1200, height: 800 });
const html = renderMapHtml(model, positions, { width: 1200, height: 800 });
const out = join(tmpdir(), `fiber-map-smoke-${Date.now()}.html`);
writeFileSync(out, html);
if (html.length < 500) { console.error("FAIL: suspiciously small HTML output"); process.exit(1); }
console.log(`OK: ${model.stats.nodeCount} nodes, ${model.stats.channelCount} channels, own=${ownPubkey ? "marked" : "unknown"} — wrote ${out} (${html.length} bytes)`);
