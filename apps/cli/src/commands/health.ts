import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HealthClient, formatHealthText, runHealthProbe, type CheckStatus, type HealthReport, WEBHOOK_FORMATS, type WebhookFormat, detectTransitions, postAlert, type HealthAlert, type Transition } from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";

export interface HealthArgs {
  url: string; biscuit?: string; profile?: string; authTokenFile?: string;
  json: boolean; watch: boolean; intervalSeconds: number;
  webhook?: string; webhookFormat: WebhookFormat;
}

export function parseHealthArgs(rest: string[]): HealthArgs {
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
  const watch = bools.has("watch");
  const intervalSeconds = Number(flags.get("interval") ?? "10");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 3600) {
    throw new Error("--interval must be an integer between 1 and 3600 seconds");
  }
  const webhook = flags.get("webhook");
  if (webhook !== undefined) {
    if (!watch) throw new Error("--webhook requires --watch");
    const u = new URL(webhook); // throws on malformed URLs
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("--webhook must be an http(s) URL");
  }
  const webhookFormat = flags.get("webhook-format") ?? "generic";
  if (!(WEBHOOK_FORMATS as string[]).includes(webhookFormat)) {
    throw new Error(`--webhook-format must be one of: ${WEBHOOK_FORMATS.join(", ")}`);
  }
  return {
    url, biscuit: flags.get("biscuit"), profile: flags.get("profile"), authTokenFile: flags.get("auth-token-file"),
    json: bools.has("json"), watch, intervalSeconds, webhook, webhookFormat: webhookFormat as WebhookFormat
  };
}

const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");

export function healthExitCode(verdict: CheckStatus): number {
  return verdict === "pass" ? 0 : verdict === "warn" ? 1 : 2;
}

function defaultProbe(args: HealthArgs): Promise<HealthReport> {
  const token = resolveToken({
    authToken: args.biscuit,
    authTokenFile: args.authTokenFile,
    profile: args.profile,
    env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  return runHealthProbe(new HealthClient({ url: args.url, biscuit: token }));
}

export interface HealthDeps {
  probe?: (args: HealthArgs) => Promise<HealthReport>;
  print?: (s: string) => void;
}

export interface WatchOpts {
  nodeUrl: string; intervalMs: number; webhook?: string; webhookFormat: WebhookFormat; maxTicks?: number;
}

export interface WatchDeps {
  probe: () => Promise<HealthReport>;
  print: (s: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  post?: typeof postAlert;
}

export async function watchHealth(opts: WatchOpts, deps: WatchDeps): Promise<void> {
  const post = deps.post ?? postAlert;
  let prev: HealthReport | undefined;
  for (let tick = 0; opts.maxTicks === undefined || tick < opts.maxTicks; tick++) {
    if (tick > 0) await deps.sleep(opts.intervalMs);
    const next = await deps.probe();
    deps.print(formatHealthText(next));
    if (prev) {
      const transitions = detectTransitions(prev, next);
      for (const t of transitions) deps.print(`[${deps.now().toISOString()}] ${t.check}: ${t.from} → ${t.to} (${t.reason})`);
      if (transitions.length > 0 && opts.webhook) {
        const alert: HealthAlert = {
          ts: deps.now().toISOString(), nodeUrl: opts.nodeUrl,
          verdict: next.verdict, previousVerdict: prev.verdict, transitions, report: next
        };
        const delivered = await post(opts.webhook, opts.webhookFormat, alert);
        if (!delivered) deps.print("warning: webhook delivery failed");
      }
    }
    prev = next;
  }
}

export async function runHealth(rest: string[], deps: HealthDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  let args: HealthArgs;
  try {
    args = parseHealthArgs(rest);
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const probe = deps.probe ?? defaultProbe;
  if (args.watch) {
    await watchHealth(
      { nodeUrl: args.url, intervalMs: args.intervalSeconds * 1000, webhook: args.webhook, webhookFormat: args.webhookFormat },
      { probe: () => probe(args), print, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => new Date() }
    );
    return 0;
  }
  const report = await probe(args);
  print(args.json ? JSON.stringify(report, null, 2) : formatHealthText(report));
  return healthExitCode(report.verdict);
}
