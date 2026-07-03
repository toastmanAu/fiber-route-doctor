export interface MapArgs {
  url: string; biscuit?: string; profile?: string; authTokenFile?: string;
  out: string; json: boolean; width: number; height: number;
}

const DIM_MIN = 200, DIM_MAX = 8000;

function parseDim(name: "width" | "height", raw: string | undefined, fallback: number): number {
  const v = Number(raw ?? String(fallback));
  if (!Number.isInteger(v) || v < DIM_MIN || v > DIM_MAX) throw new Error(`--${name} must be an integer between ${DIM_MIN} and ${DIM_MAX}`);
  return v;
}

export function parseMapArgs(rest: string[]): MapArgs {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) { bools.add(key); } else { flags.set(key, next); i++; }
  }
  const url = flags.get("url");
  if (!url) throw new Error("missing required flag --url");
  return {
    url, biscuit: flags.get("biscuit"), profile: flags.get("profile"), authTokenFile: flags.get("auth-token-file"),
    out: flags.get("out") ?? "fiber-map.html",
    json: bools.has("json"),
    width: parseDim("width", flags.get("width"), 1200),
    height: parseDim("height", flags.get("height"), 800)
  };
}

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HealthClient, buildNetworkMapModel, computeLayout,
  type RpcChannelInfo, type RpcGraphNode
} from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";
import { renderMapHtml } from "../map-html.js";

const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");

async function defaultFetchGraph(args: MapArgs): Promise<{ nodes: RpcGraphNode[]; channels: RpcChannelInfo[]; ownPubkey?: string }> {
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  const client = new HealthClient({ url: args.url, biscuit: token });
  const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
  const ownPubkey = token ? await client.nodeInfo().then((n) => n.pubkey).catch(() => undefined) : undefined;
  return { nodes, channels, ownPubkey };
}

export interface MapDeps {
  fetchGraph?: (args: MapArgs) => Promise<{ nodes: RpcGraphNode[]; channels: RpcChannelInfo[]; ownPubkey?: string }>;
  writeFile?: (path: string, content: string) => void;
  print?: (s: string) => void;
}

export async function runMap(rest: string[], deps: MapDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  let args: MapArgs;
  try {
    args = parseMapArgs(rest);
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const fetchGraph = deps.fetchGraph ?? defaultFetchGraph;
  const writeFile = deps.writeFile ?? ((p: string, c: string) => writeFileSync(p, c));
  const { nodes, channels, ownPubkey } = await fetchGraph(args);
  const model = buildNetworkMapModel(nodes, channels, ownPubkey);
  if (args.json) {
    print(JSON.stringify(model, null, 2));
    return 0;
  }
  const positions = computeLayout(model, { width: args.width, height: args.height });
  writeFile(args.out, renderMapHtml(model, positions, { width: args.width, height: args.height }));
  print(`wrote ${args.out} (${model.stats.nodeCount} nodes, ${model.stats.channelCount} channels)`);
  return 0;
}
