import { biscuit, PrivateKey } from "@biscuit-auth/biscuit-wasm";

export interface MintOptions { privateKeyString: string; facts: string[]; expiry: Date; }

export function mintToken(opts: MintOptions): string {
  const pk = PrivateKey.fromString(opts.privateKeyString);
  const builder = biscuit`check if time($time), $time <= ${opts.expiry};`;
  builder.addCode(opts.facts.map((f) => `${f};`).join(" "));
  return builder.build(pk).toBase64();
}
