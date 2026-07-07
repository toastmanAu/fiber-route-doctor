import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ChannelClient, watchChannelState, type RpcChannel } from "@fiber-route-doctor/core";
import { NodeFsTokenStore, resolveToken } from "@fiber-route-doctor/biscuit";

export type ChannelSub = "connect" | "open" | "list" | "update" | "close" | "watch";
const SUBS: ChannelSub[] = ["connect", "open", "list", "update", "close", "watch"];

export interface ChannelArgs {
  sub: ChannelSub;
  url: string; biscuit?: string; profile?: string; authTokenFile?: string; json: boolean;
  address?: string; pubkey?: string; save: boolean;
  fundingAmountHex?: string; isPrivate: boolean; feeRateHex?: string;
  channelId?: string; enable?: boolean; force: boolean;
  maxPolls: number; intervalSeconds: number;
}

/** Decimal CKB string -> shannon (1e8) 0x-hex. Exact string math; max 8 fraction digits; must be > 0. */
export function ckbToShannonHex(s: string): string {
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new Error(`invalid CKB amount '${s}' (max 8 decimal places)`);
  const [whole, frac = ""] = s.split(".");
  const shannons = BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
  if (shannons <= 0n) throw new Error("amount must be greater than 0");
  return `0x${shannons.toString(16)}`;
}

export function parseChannelArgs(rest: string[]): ChannelArgs {
  const sub = rest[0];
  if (!sub || !(SUBS as string[]).includes(sub)) throw new Error(`unknown channel subcommand '${sub ?? ""}' (expected: ${SUBS.join(", ")})`);
  const flags = new Map<string, string>(); const bools = new Set<string>();
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2); const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) bools.add(key); else { flags.set(key, next); i++; }
  }
  const url = flags.get("url");
  if (!url) throw new Error("missing required flag --url");
  const args: ChannelArgs = {
    sub: sub as ChannelSub, url,
    biscuit: flags.get("biscuit"), profile: flags.get("profile"), authTokenFile: flags.get("auth-token-file"),
    json: bools.has("json"),
    address: flags.get("address"), pubkey: flags.get("pubkey"), save: bools.has("save"),
    isPrivate: bools.has("private"), channelId: flags.get("channel-id"),
    force: bools.has("force"),
    maxPolls: Number(flags.get("max-polls") ?? "60"), intervalSeconds: Number(flags.get("interval") ?? "5")
  };
  if (!Number.isInteger(args.maxPolls) || args.maxPolls < 1) throw new Error("--max-polls must be a positive integer");
  if (!Number.isInteger(args.intervalSeconds) || args.intervalSeconds < 1) throw new Error("--interval must be a positive integer (seconds)");
  const feeRate = flags.get("fee-rate");
  if (feeRate !== undefined) {
    if (!/^\d+$/.test(feeRate)) throw new Error("--fee-rate must be a non-negative integer (ppm for open/update; shannons/KB for close)");
    args.feeRateHex = `0x${BigInt(feeRate).toString(16)}`;
  }
  if (bools.has("enable") && bools.has("disable")) throw new Error("--enable and --disable are mutually exclusive");
  if (bools.has("enable")) args.enable = true;
  if (bools.has("disable")) args.enable = false;
  switch (args.sub) {
    case "connect":
      if (!args.address && !args.pubkey) throw new Error("connect requires --address or --pubkey");
      break;
    case "open": {
      if (!args.pubkey) throw new Error("open requires --pubkey");
      const amount = flags.get("amount");
      if (!amount) throw new Error("open requires --amount <CKB>");
      args.fundingAmountHex = ckbToShannonHex(amount);
      break;
    }
    case "update":
      if (!args.channelId) throw new Error("update requires --channel-id");
      if (args.enable === undefined && args.feeRateHex === undefined) throw new Error("update requires at least one of --enable/--disable/--fee-rate");
      break;
    case "close":
      if (!args.channelId) throw new Error("close requires --channel-id");
      if (args.force && !bools.has("yes-force")) throw new Error("force-close burns the commitment transaction — repeat with --force --yes-force to confirm");
      break;
    case "watch":
      if (!args.channelId) throw new Error("watch requires --channel-id");
      break;
    case "list": break;
  }
  return args;
}

const PROFILES = join(homedir(), ".config", "fiber-route-doctor", "profiles.json");

export interface ChannelDeps { makeClient?: (args: ChannelArgs) => ChannelClient; }

function defaultClient(args: ChannelArgs): ChannelClient {
  const token = resolveToken({
    authToken: args.biscuit, authTokenFile: args.authTokenFile, profile: args.profile, env: process.env,
    getProfileToken: (n) => new NodeFsTokenStore(PROFILES).get(n)?.token,
    readFile: (p) => readFileSync(p, "utf8")
  });
  return new ChannelClient({ url: args.url, biscuit: token });
}

function renderChannel(c: RpcChannel): string {
  return `${c.channel_id}  ${c.state.state_name}${c.enabled ? "" : " (disabled)"}  local=${BigInt(c.local_balance)}  remote=${BigInt(c.remote_balance)}  peer=${c.pubkey.slice(0, 12)}…${c.failure_detail ? `  FAILURE: ${c.failure_detail}` : ""}`;
}

export async function runChannel(rest: string[], deps: ChannelDeps = {}): Promise<number> {
  let args: ChannelArgs;
  try { args = parseChannelArgs(rest); } catch (e) { console.error(String(e)); return 2; }
  const client = (deps.makeClient ?? defaultClient)(args);
  try {
    switch (args.sub) {
      case "connect":
        await client.connectPeer({ address: args.address, pubkey: args.pubkey, save: args.save || undefined });
        console.log(args.json ? JSON.stringify({ ok: true }) : "OK: connect_peer accepted");
        return 0;
      case "open": {
        const r = await client.openChannel({
          pubkey: args.pubkey!, funding_amount: args.fundingAmountHex!,
          public: args.isPrivate ? false : undefined,
          tlc_fee_proportional_millionths: args.feeRateHex
        });
        console.log(args.json ? JSON.stringify(r) : `OK: negotiation started — temporary_channel_id ${r.temporary_channel_id}\n(watch it: channel watch --url ${args.url} --channel-id ${r.temporary_channel_id} --pubkey ${args.pubkey})`);
        return 0;
      }
      case "list": {
        const channels = await client.listChannels();
        console.log(args.json ? JSON.stringify(channels, null, 2) : channels.length === 0 ? "no channels" : channels.map(renderChannel).join("\n"));
        return 0;
      }
      case "update":
        await client.updateChannel({ channel_id: args.channelId!, enabled: args.enable, tlc_fee_proportional_millionths: args.feeRateHex });
        console.log(args.json ? JSON.stringify({ ok: true }) : "OK: update_channel accepted");
        return 0;
      case "close":
        await client.shutdownChannel({ channel_id: args.channelId!, fee_rate: args.feeRateHex, force: args.force || undefined });
        console.log(args.json ? JSON.stringify({ ok: true }) : `OK: shutdown_channel accepted${args.force ? " (FORCE)" : ""}`);
        return 0;
      case "watch": {
        const r = await watchChannelState(client, args.channelId!, {
          maxPolls: args.maxPolls, delayMs: args.intervalSeconds * 1000,
          counterpartyPubkey: args.pubkey,
          onTick: args.json ? undefined : (polls, state) => console.log(`poll ${polls}/${args.maxPolls}: ${state ?? "not visible yet"}`)
        });
        console.log(args.json ? JSON.stringify(r) : `outcome: ${r.outcome}${r.failureDetail ? ` — ${r.failureDetail}` : ""}${r.channel ? `\n${renderChannel(r.channel)}` : ""}`);
        return r.outcome === "ready" ? 0 : 1;
      }
    }
  } catch (e) {
    console.error(String(e));
    return 2;
  }
}
