import { computeLiquidityReport } from "./liquidity.js";
import type { LiquidityDiff, LiquiditySnapshot } from "./liquidity-types.js";

export function diffSnapshots(prev: LiquiditySnapshot, next: LiquiditySnapshot): LiquidityDiff {
  const prevById = new Map(prev.channels.map((c) => [c.channelId, c]));
  const nextById = new Map(next.channels.map((c) => [c.channelId, c]));

  const opened = next.channels.filter((c) => !prevById.has(c.channelId));
  const closed = prev.channels.filter((c) => !nextById.has(c.channelId));

  const balanceDeltas = next.channels
    .filter((c) => prevById.has(c.channelId))
    .map((c) => {
      const p = prevById.get(c.channelId)!;
      return {
        channelId: c.channelId,
        asset: c.asset,
        localDelta: (BigInt(c.local) - BigInt(p.local)).toString(),
        remoteDelta: (BigInt(c.remote) - BigInt(p.remote)).toString()
      };
    })
    .filter((d) => d.localDelta !== "0" || d.remoteDelta !== "0");

  const prevAssets = new Map(computeLiquidityReport(prev).assets.map((a) => [a.asset, a]));
  const nextAssets = new Map(computeLiquidityReport(next).assets.map((a) => [a.asset, a]));
  const assetKeys = [...new Set([...prevAssets.keys(), ...nextAssets.keys()])]
    .sort((a, b) => (a === "CKB" ? -1 : b === "CKB" ? 1 : a < b ? -1 : 1));
  const assetDeltas = assetKeys
    .map((asset) => {
      const p = prevAssets.get(asset);
      const n = nextAssets.get(asset);
      return {
        asset,
        outboundDelta: (BigInt(n?.outbound ?? "0") - BigInt(p?.outbound ?? "0")).toString(),
        inboundDelta: (BigInt(n?.inbound ?? "0") - BigInt(p?.inbound ?? "0")).toString()
      };
    })
    .filter((d) => d.outboundDelta !== "0" || d.inboundDelta !== "0");

  return { fromTs: prev.ts, toTs: next.ts, opened, closed, balanceDeltas, assetDeltas };
}
