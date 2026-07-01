import type { AssetId, UdtScript } from "./types.js";

/** Stable, order-independent key for an asset. null => native CKB. */
export function assetIdOf(script: UdtScript | null): AssetId {
  if (script === null) return "CKB";
  return `udt:${script.code_hash}:${script.hash_type}:${script.args}`;
}
