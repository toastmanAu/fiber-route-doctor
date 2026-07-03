import {
  COLOR_EDGE, COLOR_EDGE_DISABLED,
  edgeWidth, nodeColor, nodeRadius,
  type LayoutPoint, type NetworkMapModel
} from "@fiber-route-doctor/core";

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const maxOf = (values: string[]): string => values.reduce((m, v) => (BigInt(v) > BigInt(m) ? v : m), "0");

export function renderMapHtml(model: NetworkMapModel, positions: Map<string, LayoutPoint>, opts: { width: number; height: number }): string {
  const { width, height } = opts;
  if (model.nodes.length === 0) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Fiber Network Map</title></head><body style="font-family:monospace;background:#111;color:#ccc"><p>no gossiped topology — node may be isolated</p></body></html>`;
  }
  const hubs = new Set(model.hubs.map((h) => h.pubkey));
  const maxNodeCap = maxOf(model.nodes.map((n) => n.totalCapacity));
  const maxEdgeCap = maxOf(model.edges.map((e) => e.capacity));

  const edgeSvg = model.edges.map((e) => {
    const pa = positions.get(e.a), pb = positions.get(e.b);
    if (!pa || !pb) return "";
    const w = edgeWidth(e.capacity, maxEdgeCap);
    const color = e.disabled ? COLOR_EDGE_DISABLED : COLOR_EDGE;
    const dash = e.disabled ? ' stroke-dasharray="4 3"' : "";
    return `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="${color}" stroke-width="${w.toFixed(1)}"${dash} opacity="0.8"/>`;
  }).join("\n");

  const nodeSvg = model.nodes.map((n) => {
    const p = positions.get(n.pubkey);
    if (!p) return "";
    const r = nodeRadius(n.totalCapacity, maxNodeCap);
    const color = nodeColor(n, hubs.has(n.pubkey));
    const label = n.name ? `<text x="${p.x.toFixed(1)}" y="${(p.y - r - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#ccc">${escapeHtml(n.name)}</text>` : "";
    return `<g class="node" data-pubkey="${escapeHtml(n.pubkey)}" style="cursor:pointer"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" stroke="#fff" stroke-width="${n.isOwn ? 2 : 0.5}"/>${label}</g>`;
  }).join("\n");

  const hubList = model.hubs.map((h) =>
    `<li>${h.name ? escapeHtml(h.name) : `${escapeHtml(h.pubkey.slice(0, 10))}…`} — ${h.degree} ch, cap ${h.totalCapacity}</li>`
  ).join("\n");

  const payload = JSON.stringify({ nodes: model.nodes }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fiber Network Map</title>
<style>body{font-family:monospace;background:#111;color:#ccc;margin:1rem}#detail{border:1px solid #444;padding:.6rem;min-height:3rem;max-width:${width}px;word-break:break-all}</style>
</head><body>
<h1>Fiber Network Map</h1>
<p>${model.stats.nodeCount} nodes · ${model.stats.channelCount} channels · total capacity ${model.stats.totalCapacity}</p>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#181818;border:1px solid #444">
${edgeSvg}
${nodeSvg}
</svg>
<div id="detail">click a node for details</div>
<h2>Top hubs</h2>
<ol>${hubList}</ol>
<script type="application/json" id="map-data">${payload}</script>
<script>
const data = JSON.parse(document.getElementById("map-data").textContent);
const byKey = new Map(data.nodes.map(n => [n.pubkey, n]));
const detail = document.getElementById("detail");
for (const g of document.querySelectorAll("g.node")) {
  g.addEventListener("click", () => {
    const n = byKey.get(g.dataset.pubkey);
    if (!n) return;
    detail.textContent = (n.name || "(unnamed)") + " · " + n.pubkey + " · " + n.degree + " channel(s) · capacity " + n.totalCapacity;
  });
}
</script>
</body></html>`;
}
