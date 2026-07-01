import { CKB_ASSET, type AssetId } from "@fiber-route-doctor/core";

export interface CliArgs {
  url: string; source: string; target: string; amount: bigint; asset: AssetId; biscuit?: string; router: boolean;
  profile?: string; authTokenFile?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { bools.add(key); } else { flags.set(key, next); i++; }
  }
  const req = (k: string): string => {
    const v = flags.get(k);
    if (v === undefined) throw new Error(`missing required flag --${k}`);
    return v;
  };
  return {
    url: req("url"), source: req("source"), target: req("target"),
    amount: BigInt(req("amount")),
    asset: (flags.get("asset") as AssetId | undefined) ?? CKB_ASSET,
    biscuit: flags.get("biscuit"),
    router: bools.has("router"),
    profile: flags.get("profile"),
    authTokenFile: flags.get("auth-token-file")
  };
}
