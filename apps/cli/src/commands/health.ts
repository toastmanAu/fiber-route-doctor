import { WEBHOOK_FORMATS, type WebhookFormat } from "@fiber-route-doctor/core";

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
