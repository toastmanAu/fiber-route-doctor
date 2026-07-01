import { CKB_ASSET, type AssetId, type ProbeRequest } from "@fiber-route-doctor/core";

export function buildProbe(input: { source: string; target: string; amount: string; asset: string }): ProbeRequest {
  if (!/^\d+$/.test(input.amount.trim())) throw new Error("amount must be a positive integer (shannons/UDT base units)");
  return {
    source: input.source.trim(),
    target: input.target.trim(),
    amount: BigInt(input.amount.trim()),
    asset: (input.asset.trim() || CKB_ASSET) as AssetId
  };
}
