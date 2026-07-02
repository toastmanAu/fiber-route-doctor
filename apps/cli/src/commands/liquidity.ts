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
