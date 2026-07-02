import type { ChannelLiquidity, LiquidityReport, LiquiditySnapshot } from "@fiber-route-doctor/core";

const COLOR = { ok: "#2ecc71", drained: "#e74c3c", full: "#f1c40f", excluded: "#7f8c8d" } as const;

export interface LiquidityCard { asset: string; outbound: string; inbound: string; maxSend: string; maxReceive: string; }
export interface LiquidityRow {
  channelId: string; peer: string; asset: string; pct: number | null;
  barColor: string; flag?: "drained" | "full"; excluded: boolean; local: string; remote: string;
}
export interface LiquidityView { cards: LiquidityCard[]; rows: LiquidityRow[]; empty: boolean; }

function pctOf(c: ChannelLiquidity): number | null {
  const total = BigInt(c.local) + BigInt(c.remote);
  return total === 0n ? null : Number((BigInt(c.local) * 100n) / total);
}

export function buildLiquidityView(report: LiquidityReport, snapshot: LiquiditySnapshot): LiquidityView {
  const flagById = new Map(report.skews.map((s) => [s.channelId, s.flag]));
  const rows: LiquidityRow[] = snapshot.channels.map((c) => {
    const excluded = !(c.state === "ChannelReady" && c.enabled);
    const flag = flagById.get(c.channelId);
    const barColor = excluded ? COLOR.excluded : flag ? COLOR[flag] : COLOR.ok;
    return { channelId: c.channelId, peer: c.peer, asset: c.asset, pct: pctOf(c), barColor, flag, excluded, local: c.local, remote: c.remote };
  });
  const cards: LiquidityCard[] = report.assets.map((a) => ({
    asset: a.asset, outbound: a.outbound, inbound: a.inbound, maxSend: a.maxSend, maxReceive: a.maxReceive
  }));
  return { cards, rows, empty: snapshot.channels.length === 0 };
}
