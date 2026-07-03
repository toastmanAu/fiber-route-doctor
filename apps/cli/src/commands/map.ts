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
