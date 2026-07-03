import React, { useState } from "react";
import { HealthClient, buildLiquiditySnapshot, computeLiquidityReport } from "@fiber-route-doctor/core";
import { buildLiquidityView, type LiquidityView } from "./liquidity-view.js";
import { useWallet } from "./wallet-context.js";

export function LiquidityPanel() {
  const { profiles } = useWallet();
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");

  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }
  const [view, setView] = useState<LiquidityView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const channels = await new HealthClient({ url, biscuit: token || undefined }).listChannels();
      const snapshot = buildLiquiditySnapshot(channels, url, new Date().toISOString());
      setView(buildLiquidityView(computeLiquidityReport(snapshot), snapshot));
    } catch (e) {
      setView(null);
      setError(String(e));
    } finally { setBusy(false); }
  }

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Channel Liquidity</h2>
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
      <button onClick={run} disabled={busy}>{busy ? "probing…" : "Probe"}</button>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {view?.empty && <p style={{ color: "#888" }}>no channels — nothing to snapshot</p>}
      {view && !view.empty && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {view.cards.map((c) => (
              <div key={c.asset} style={{ border: "1px solid #444", padding: "0.6rem" }}>
                <strong>{c.asset}</strong>
                <div>out {c.outbound} / in {c.inbound}</div>
                <div style={{ color: "#888" }}>max send {c.maxSend} · max receive {c.maxReceive}</div>
              </div>
            ))}
          </div>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.8rem" }}>
            {view.rows.map((r) => (
              <li key={r.channelId} style={{ margin: "0.4rem 0" }}>
                <code>{r.channelId.slice(0, 12)}…</code>{" "}
                <span style={{ display: "inline-block", width: 120, background: "#333", verticalAlign: "middle" }}>
                  <span style={{ display: "block", width: `${r.pct ?? 0}%`, background: r.barColor, height: 10 }} />
                </span>{" "}
                {r.pct === null ? "zero capacity" : `${r.pct}% local`} · local {r.local} / remote {r.remote}
                {r.flag && <span style={{ color: r.barColor }}> ⚠ {r.flag}</span>}
                {r.excluded && <span style={{ color: "#7f8c8d" }}> (excluded)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
