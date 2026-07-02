import React, { useCallback, useEffect, useState } from "react";
import { HealthClient, runHealthProbe } from "@fiber-route-doctor/core";
import { buildHealthView, type HealthView } from "./health-view.js";

export function HealthPanel() {
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");
  const [view, setView] = useState<HealthView | null>(null);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const report = await runHealthProbe(new HealthClient({ url, biscuit: token || undefined }));
      setView(buildHealthView(report));
    } catch (e) {
      setView(null);
      setError(String(e));
    } finally { setBusy(false); }
  }, [url, token]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(run, 10_000);
    return () => clearInterval(id);
  }, [auto, run]);

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Node Health</h2>
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
