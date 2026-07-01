import { Biscuit, PublicKey, SignatureAlgorithm } from "@biscuit-auth/biscuit-wasm";
import { publicKeyHex } from "./authorize.js";

export interface TokenInspection { text: string; facts: string[]; checks: string[]; }

export function inspectToken(tokenB64: string, publicKeyString: string): TokenInspection {
  const token = Biscuit.fromBase64(tokenB64, PublicKey.fromString(publicKeyHex(publicKeyString), SignatureAlgorithm.Ed25519));
  const text = token.toString();
  const facts: string[] = [];
  const checks: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (/^(read|write)\("[^"]+"\)$/.test(line)) facts.push(line);
    else if (line.startsWith("check if ")) checks.push(line);
  }
  return { text, facts, checks };
}
