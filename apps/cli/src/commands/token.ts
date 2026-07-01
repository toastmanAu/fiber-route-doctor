import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  mintToken, scopeFacts, inspectToken, deriveFromMnemonic, importPrivateKeyString,
  NodeFsKeystore, NodeFsTokenStore, decryptSecret, type ScopeTemplate
} from "@fiber-route-doctor/biscuit";

const CFG = join(homedir(), ".config", "fiber-route-doctor");
const KS = join(CFG, "keystore.json");
const PROFILES = join(CFG, "profiles.json");

export function parseExpiry(s: string): Date {
  const m = s.trim().match(/^(\d+)([dh])$/);
  if (!m) throw new Error("expiry must look like '30d' or '12h'");
  const n = Number(m[1]);
  const ms = m[2] === "d" ? n * 864e5 : n * 36e5;
  return new Date(Date.now() + ms);
}

function flags(rest: string[]): Map<string, string> {
  const f = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { const v = rest[i + 1]; if (v && !v.startsWith("--")) { f.set(rest[i].slice(2), v); i++; } else f.set(rest[i].slice(2), "true"); }
  }
  return f;
}

function unlockKey(passphrase: string): { privateKeyString: string; publicKeyString: string } {
  const ks = new NodeFsKeystore(KS).load();
  if (!ks) throw new Error(`no keystore at ${KS} — run 'keys init' or 'keys import' first`);
  const secret = decryptSecret(ks, passphrase);
  return ks.kind === "mnemonic" ? deriveFromMnemonic(secret) : importPrivateKeyString(secret);
}

export async function runToken(rest: string[]): Promise<number> {
  const sub = rest[0];
  const f = flags(rest.slice(1));
  const store = new NodeFsTokenStore(PROFILES);
  if (sub === "generate") {
    const pass = f.get("passphrase") ?? process.env.FRD_PASSPHRASE ?? "";
    const key = unlockKey(pass);
    const scope = (f.get("scope") ?? "readonly") as ScopeTemplate;
    const expiry = parseExpiry(f.get("expiry") ?? "30d");
    const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts(scope), expiry });
    const name = f.get("profile");
    if (name) store.put({ name, url: f.get("url") ?? "", token, scope, expiresAt: expiry.toISOString() });
    console.log(token);
    return 0;
  }
  if (sub === "list") {
    for (const p of store.list()) console.log(`${p.name}\t${p.url}\t${p.scope}\texpires ${p.expiresAt}\t${p.token.slice(0, 8)}…`);
    return 0;
  }
  if (sub === "show") { const p = store.get(rest[1] ?? ""); if (!p) { console.error("no such profile"); return 1; } console.log(p.token); return 0; }
  if (sub === "inspect") {
    const arg = rest[1] ?? "";
    const tokenB64 = arg.startsWith("@") ? (store.get(arg.slice(1))?.token ?? "") : (arg.startsWith("/") ? readFileSync(arg, "utf8").trim() : arg);
    const pub = f.get("pubkey");
    if (!pub) { console.error("--pubkey <ed25519/…> required to inspect"); return 1; }
    const r = inspectToken(tokenB64, pub);
    console.log(JSON.stringify({ facts: r.facts, checks: r.checks }, null, 2));
    return 0;
  }
  console.error("usage: token generate|list|show|inspect");
  return 2;
}
