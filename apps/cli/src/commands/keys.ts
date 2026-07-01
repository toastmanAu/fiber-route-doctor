import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { newMnemonic, deriveFromMnemonic, importPrivateKeyString, NodeFsKeystore, encryptSecret } from "@fiber-route-doctor/biscuit";

const CFG = join(homedir(), ".config", "fiber-route-doctor");
const KS = join(CFG, "keystore.json");

function flags(rest: string[]): Map<string, string> {
  const f = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { const v = rest[i + 1]; if (v && !v.startsWith("--")) { f.set(rest[i].slice(2), v); i++; } else f.set(rest[i].slice(2), "true"); }
  }
  return f;
}

export async function runKeys(rest: string[]): Promise<number> {
  const sub = rest[0];
  const f = flags(rest.slice(1));
  const backend = new NodeFsKeystore(KS);
  const pass = f.get("passphrase") ?? process.env.FRD_PASSPHRASE ?? "";
  if (!pass) { console.error("--passphrase (or FRD_PASSPHRASE) required"); return 1; }

  if (sub === "init") {
    const mnemonic = newMnemonic();
    const key = deriveFromMnemonic(mnemonic);
    backend.save(encryptSecret(mnemonic, pass, "mnemonic", key.publicKeyString));
    console.log("BACK UP THIS RECOVERY PHRASE (shown once):\n" + mnemonic);
    console.log("\nPaste this into your node config rpc.biscuit_public_key:\n" + key.publicKeyString);
    return 0;
  }
  if (sub === "import") {
    if (f.has("mnemonic")) {
      const mnemonic = f.get("mnemonic")!;
      const key = deriveFromMnemonic(mnemonic);
      backend.save(encryptSecret(mnemonic, pass, "mnemonic", key.publicKeyString));
      console.log(key.publicKeyString); return 0;
    }
    const hexArg = f.get("hex");
    if (!hexArg) { console.error("keys import --hex <path|ed25519-private/…> | --mnemonic '<words>'"); return 1; }
    const raw = hexArg.startsWith("/") ? readFileSync(hexArg, "utf8").trim() : hexArg;
    const key = importPrivateKeyString(raw);
    backend.save(encryptSecret(raw, pass, "privatekey", key.publicKeyString));
    console.log(key.publicKeyString); return 0;
  }
  if (sub === "export-public") {
    const ks = backend.load(); if (!ks) { console.error("no keystore"); return 1; }
    console.log(ks.publicKeyString); return 0;
  }
  console.error("usage: keys init|import|export-public");
  return 2;
}
