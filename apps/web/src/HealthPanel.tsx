import React, { useCallback, useEffect, useRef, useState } from "react";
import { HealthClient, runHealthProbe } from "@fiber-route-doctor/core";
import { buildHealthView, type HealthView } from "./health-view.js";
import { useWallet } from "./wallet-context.js";

export function HealthPanel({ fetchOverride }: { fetchOverride?: typeof fetch }) {
  const { profiles } = useWallet();
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");

  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }
  const [view, setView] = useState<HealthView | null>(null);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setBusy(true);
    setError("");
    try {
      const report = await runHealthProbe(new HealthClient({ url, biscuit: token || undefined, fetchImpl: fetchOverride }));
      if (id !== runId.current) return;
      setView(buildHealthView(report));
    } catch (e) {
      if (id !== runId.current) return;
      setView(null);
      setError(String(e));
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }, [url, token]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(run, 10_000);
    return () => clearInterval(id);
  }, [auto, run]);

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Node Health</h2>
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
      <label style={{ marginLeft: "1rem" }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-refresh (10s)
      </label>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {view && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ color: view.verdictColor, fontWeight: "bold" }}>verdict: {view.verdict.toUpperCase()}</div>
          {view.summary && <div style={{ color: "#888" }}>{view.summary}</div>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {view.rows.map((r) => (
              <li key={r.id} style={{ margin: "0.3rem 0" }}>
                <span style={{ color: r.color }}>{r.icon}</span> <strong>{r.title}</strong> — {r.reason}
                {r.fix && <div style={{ color: "#888", marginLeft: "1.4rem" }}>fix: {r.fix}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
