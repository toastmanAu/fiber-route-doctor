#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type ProbeRequest } from "@fiber-route-doctor/core";
import { resolveToken, NodeFsTokenStore } from "@fiber-route-doctor/biscuit";
import { parseArgs } from "./args.js";
import { parseCommand } from "./dispatch.js";
import { runKeys } from "./commands/keys.js";
import { runToken } from "./commands/token.js";
import { runHealth } from "./commands/health.js";
import { runLiquidity } from "./commands/liquidity.js";
import { runMap } from "./commands/map.js";
import { runChannel } from "./commands/channel.js";

async function main() {
  const { command, rest } = parseCommand(process.argv.slice(2));

  if (command === "keys") process.exit(await runKeys(rest));
  if (command === "token") process.exit(await runToken(rest));
  if (command === "health") process.exit(await runHealth(rest));
  if (command === "liquidity") process.exit(await runLiquidity(rest));
  if (command === "map") process.exit(await runMap(rest));
  if (command === "channel") process.exit(await runChannel(rest));

  const args = parseArgs(rest);
  const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  const client = new GraphClient({ url: args.url, biscuit: token });
  const model = await loadGraph(client);
  const probe: ProbeRequest = { source: args.source, target: args.target, amount: args.amount, asset: args.asset };
  const router = args.router ? makeRouter(args.url, args.biscuit) : undefined;
  const report = await runDiagnosis(model, probe, router);
  console.log(formatReportText(report));
  process.exit(report.verdict === "blocked" ? 1 : 0);
}

function makeRouter(url: string, biscuit?: string) {
  return {
    async buildRouter(params: unknown) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (biscuit) headers["Authorization"] = `Bearer ${biscuit}`;
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "build_router", params: [params] }) });
      if (!res.ok) throw new Error(`build_router HTTP ${res.status}`);
      const json = await res.json() as { result?: { router_hops: Array<{ channel_outpoint?: string }> }; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      return json.result!;
    }
  };
}

main().catch((e) => { console.error(String(e)); process.exit(2); });
