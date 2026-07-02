import type { ChannelLiquidity, LiquidityDiff, LiquidityReport, LiquiditySnapshot, SkewFlag } from "./liquidity-types.js";

const BAR_CELLS = 10;
const shortId = (h: string): string => (h.length > 12 ? `${h.slice(0, 12)}…` : h);

function bar(pct: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(pct / BAR_CELLS)));
  return `[${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}]`;
}

function ratioPct(c: ChannelLiquidity): number | null {
  const total = BigInt(c.local) + BigInt(c.remote);
  if (total === 0n) return null;
  return Number((BigInt(c.local) * 100n) / total);
}

export function formatLiquidityText(report: LiquidityReport, snapshot: LiquiditySnapshot): string {
  if (snapshot.channels.length === 0) return "no channels — nothing to snapshot";
  const skewById = new Map<string, SkewFlag>(report.skews.map((s) => [s.channelId, s]));
  const lines: string[] = [`Channel liquidity — ${report.ts} — ${report.totalChannels} channels (${report.excludedChannels} excluded)`];
  for (const a of report.assets) {
    let head = `${a.asset}: out ${a.outbound} | in ${a.inbound} | max send ${a.maxSend} | max receive ${a.maxReceive}`;
    if (a.inFlightOut !== "0" || a.inFlightIn !== "0") head += ` | in-flight out ${a.inFlightOut} / in ${a.inFlightIn}`;
    lines.push(head);
    for (const c of snapshot.channels.filter((ch) => ch.asset === a.asset)) {
      const active = c.state === "ChannelReady" && c.enabled;
      if (!active) {
        lines.push(` ${shortId(c.channelId)} excluded: ${!c.enabled && c.state === "ChannelReady" ? "disabled" : c.state}`);
        continue;
      }
      const pct = ratioPct(c);
      const skew = skewById.get(c.channelId);
      const pctPart = pct === null ? "(zero capacity)" : `${bar(pct)} ${pct}% local`;
      lines.push(` ${shortId(c.channelId)} ${pctPart}  local ${c.local} / remote ${c.remote}  peer ${shortId(c.peer)}${skew ? `  ⚠ ${skew.flag}` : ""}`);
    }
  }
  if (report.peers.length) {
    lines.push("peers:");
    for (const p of report.peers) lines.push(` peer ${shortId(p.peer)} — ${p.channelCount} channel(s), out ${p.outbound}, in ${p.inbound}`);
  }
  return lines.join("\n");
}

const signed = (v: string): string => (v.startsWith("-") ? v : `+${v}`);

export function formatLiquidityDiff(diff: LiquidityDiff): string {
  const lines: string[] = [`Liquidity diff ${diff.fromTs} → ${diff.toTs}`];
  for (const c of diff.opened) lines.push(` + opened ${shortId(c.channelId)} (${c.asset}, local ${c.local})`);
  for (const c of diff.closed) lines.push(` - closed ${shortId(c.channelId)} (${c.asset})`);
  for (const d of diff.balanceDeltas) lines.push(` Δ ${shortId(d.channelId)} local ${signed(d.localDelta)}, remote ${signed(d.remoteDelta)}`);
  for (const a of diff.assetDeltas) lines.push(` Δ ${a.asset} out ${signed(a.outboundDelta)}, in ${signed(a.inboundDelta)}`);
  if (lines.length === 1) lines.push(" no changes");
  return lines.join("\n");
}
