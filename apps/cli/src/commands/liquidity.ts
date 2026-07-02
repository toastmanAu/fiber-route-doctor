import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HealthClient, buildLiquiditySnapshot, computeLiquidityReport, diffSnapshots,
  formatLiquidityDiff, formatLiquidityText, type RpcChannel, type SnapshotStore
} from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";
import { NodeFsSnapshotStore } from "../snapshot-store.js";

export interface LiquidityArgs {
  url: string; biscuit?: string; profile?: string; authTokenFile?: string;
  json: boolean; save: boolean; diff: boolean;
}

export function parseLiquidityArgs(rest: string[]): LiquidityArgs {
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
    json: bools.has("json"), save: bools.has("save"), diff: bools.has("diff")
  };
}

const CFG = join(homedir(), ".config", "fiber-route-doctor");
const PROFILES = join(CFG, "profiles.json");
const SNAPSHOTS_DIR = join(CFG, "snapshots");

function defaultFetchChannels(args: LiquidityArgs): Promise<RpcChannel[]> {
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  return new HealthClient({ url: args.url, biscuit: token }).listChannels();
}

export interface LiquidityDeps {
  fetchChannels?: (args: LiquidityArgs) => Promise<RpcChannel[]>;
  store?: SnapshotStore;
  print?: (s: string) => void;
  now?: () => Date;
}

export async function runLiquidity(rest: string[], deps: LiquidityDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  let args: LiquidityArgs;
  try {
    args = parseLiquidityArgs(rest);
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const store = deps.store ?? new NodeFsSnapshotStore(SNAPSHOTS_DIR);
  const fetchChannels = deps.fetchChannels ?? defaultFetchChannels;
  const now = deps.now ?? (() => new Date());

  const prev = args.diff ? store.latest() : undefined;
  if (args.diff && !prev) {
    print("no saved snapshot to diff against — run with --save first");
    return 2;
  }

  const channels = await fetchChannels(args);
  const snapshot = buildLiquiditySnapshot(channels, args.url, now().toISOString());
  const report = computeLiquidityReport(snapshot);
  const diff = prev ? diffSnapshots(prev, snapshot) : undefined;

  if (args.json) {
    print(JSON.stringify({ report, snapshot, ...(diff ? { diff } : {}) }, null, 2));
  } else {
    print(formatLiquidityText(report, snapshot));
    if (diff) print(formatLiquidityDiff(diff));
  }
  if (args.save) {
    const name = store.put(snapshot);
    if (!args.json) print(`saved ${name}`);
  }
  return 0;
}
