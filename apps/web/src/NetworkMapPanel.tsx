import React, { useEffect, useMemo, useRef, useState } from "react";
import { HealthClient, buildNetworkMapModel, computeLayout, type NetworkMapModel, type MapNode } from "@fiber-route-doctor/core";
import { buildNetworkMapView } from "./network-map-view.js";
import { useWallet } from "./wallet-context.js";

const W = 900, H = 620;

export function NetworkMapPanel({ routeOutpoints }: { routeOutpoints: string[] }) {
  const { profiles } = useWallet();
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");

  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }
  const [model, setModel] = useState<NetworkMapModel | null>(null);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: W, h: H });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const runId = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  async function load() {
    const id = ++runId.current;
    setBusy(true);
    setError("");
    try {
      const client = new HealthClient({ url, biscuit: token || undefined });
      const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
      const ownPubkey = token ? await client.nodeInfo().then((n) => n.pubkey).catch(() => undefined) : undefined;
      if (id !== runId.current) return;
      setModel(buildNetworkMapModel(nodes, channels, ownPubkey));
      setSelected(null);
      setViewBox({ x: 0, y: 0, w: W, h: H });
    } catch (e) {
      if (id !== runId.current) return;
      setModel(null);
      setError(String(e));
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }

  const positions = useMemo(() => (model ? computeLayout(model, { width: W, height: H }) : null), [model]);
  const view = useMemo(() => (model && positions ? buildNetworkMapView(model, positions, routeOutpoints) : null), [model, positions, routeOutpoints]);

  // Native non-passive wheel listener: React's synthetic onWheel binds passively,
  // so preventDefault there is a no-op and the page scrolls while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      setViewBox((v) => {
        const w = Math.min(W * 5, Math.max(W / 5, v.w * factor));
        const h = (w / W) * H;
        return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view]);
  function onPointerDown(e: React.PointerEvent) { drag.current = { x: e.clientX, y: e.clientY }; }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const scale = viewBox.w / W;
    setViewBox((v) => ({ ...v, x: v.x - (e.clientX - drag.current!.x) * scale, y: v.y - (e.clientY - drag.current!.y) * scale }));
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp() { drag.current = null; }

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Network Map</h2>
      {profiles.length > 0 && (
        <div style={{ margin: "0.4rem 0" }}>
          <label>profile: <select defaultValue="" onChange={(e) => applyProfile(e.target.value)}>
            <option value="" disabled>— pick a minted token —</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.scope})</option>)}
          </select></label>
        </div>
      )}
      <div style={{ margin: "0.4rem 0" }}>
        <label>node url: <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <div style={{ margin: "0.4rem 0" }}>
        <label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <button onClick={load} disabled={busy}>{busy ? "loading…" : "Load map"}</button>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {model && view?.empty && <p style={{ color: "#888" }}>no gossiped topology — node may be isolated</p>}
      {model && view && !view.empty && (
        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
          <svg
            ref={svgRef}
            width={W} height={H} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            style={{ background: "#111", border: "1px solid #444", cursor: "grab", touchAction: "none" }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
          >
            {view.edges.map((e) => (
              <line key={e.outpoint} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                stroke={e.color} strokeWidth={e.width} strokeDasharray={e.dashed ? "4 3" : undefined} opacity={0.8} />
            ))}
            {view.nodes.map((n) => (
              <g key={n.pubkey} onClick={() => setSelected(model.nodes.find((m) => m.pubkey === n.pubkey) ?? null)} style={{ cursor: "pointer" }}>
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} stroke="#fff" strokeWidth={n.isOwn ? 2 : 0.5} />
                {n.label && <text x={n.x} y={n.y - n.r - 4} textAnchor="middle" fontSize="10" fill="#ccc">{n.label}</text>}
              </g>
            ))}
          </svg>
          <div style={{ minWidth: 260 }}>
            <div style={{ color: "#888" }}>{model.stats.nodeCount} nodes · {model.stats.channelCount} channels</div>
            {selected && (
              <div style={{ border: "1px solid #444", padding: "0.6rem", margin: "0.6rem 0" }}>
                <strong>{selected.name ?? "(unnamed)"}</strong>
                <div style={{ fontSize: 12, wordBreak: "break-all" }}>{selected.pubkey}</div>
                <div>{selected.degree} channel(s) · capacity {selected.totalCapacity}</div>
              </div>
            )}
            <h3 style={{ marginBottom: "0.3rem" }}>Top hubs</h3>
            <ol style={{ paddingLeft: "1.2rem", margin: 0 }}>
              {model.hubs.map((h) => (
                <li key={h.pubkey} style={{ fontSize: 13 }}>{h.name ?? `${h.pubkey.slice(0, 10)}…`} — {h.degree} ch, cap {h.totalCapacity}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
