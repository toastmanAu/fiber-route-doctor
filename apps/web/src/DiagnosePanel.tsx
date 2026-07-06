import React, { useEffect, useState } from "react";
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type RouteReport } from "@fiber-route-doctor/core";
import { buildProbe } from "./probe-form.js";
import { buildRouteView } from "./route-view.js";
import { RouteGraph } from "./RouteGraph.js";
import { useWallet } from "./wallet-context.js";
import { graphClientOptionsFor } from "./diagnose-run.js";
import { DEMO_SOURCE, DEMO_TARGET, DEMO_AMOUNT } from "./demo/demo-fetch.js";

interface DiagnosePanelProps {
  fetchOverride?: typeof fetch;
  demoActive: boolean;
  onReport: (report: RouteReport | null) => void;
}

export function DiagnosePanel({ fetchOverride, demoActive, onReport }: DiagnosePanelProps) {
  const { profiles } = useWallet();
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("1000");
  const [asset, setAsset] = useState("");
  const [token, setToken] = useState("");
  const [out, setOut] = useState("");
  const [report, setReport] = useState<RouteReport | null>(null);
  const [busy, setBusy] = useState(false);

  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }

  useEffect(() => {
    if (demoActive) {
      setSource(DEMO_SOURCE); setTarget(DEMO_TARGET); setAmount(DEMO_AMOUNT); setAsset("");
    } else {
      setSource(""); setTarget(""); setAmount("1000");
    }
    // Clear any prior result so a stale route/report doesn't linger (here or on the
    // parent-driven Network Map) across a live↔demo mode switch until the next run.
    setReport(null); setOut(""); onReport(null);
  }, [demoActive, onReport]);

  async function run() {
    setBusy(true);
    try {
      const probe = buildProbe({ source, target, amount, asset });
      const client = new GraphClient(graphClientOptionsFor({ url, token, fetchImpl: fetchOverride }));
      const model = await loadGraph(client);
      const result: RouteReport = await runDiagnosis(model, probe);
      setReport(result); onReport(result);
      setOut(formatReportText(result));
    } catch (e) {
      setReport(null); onReport(null);
      setOut(`error: ${String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <section style={{ marginTop: "0.25rem" }}>
      {profiles.length > 0 && (
        <div style={{ margin: "0.4rem 0" }}>
          <label>profile: <select defaultValue="" onChange={(e) => applyProfile(e.target.value)}>
            <option value="" disabled>— pick a minted token —</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.scope})</option>)}
          </select></label>
        </div>
      )}
      {([["node url", url, setUrl], ["source pubkey", source, setSource], ["target pubkey", target, setTarget], ["amount", amount, setAmount], ["asset (blank=CKB)", asset, setAsset]] as const).map(([label, val, set]) => (
        <div key={label} style={{ margin: "0.4rem 0" }}>
          <label>{label}: <input value={val} onChange={(e) => set(e.target.value)} style={{ width: 420 }} /></label>
        </div>
      ))}
      <div style={{ margin: "0.4rem 0" }}>
        <label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label>
      </div>
      <button onClick={run} disabled={busy}>{busy ? "diagnosing…" : "Diagnose"}</button>
      {report && <RouteGraph view={buildRouteView(report)} />}
      {out && <pre style={{ background: "#111", color: "#0f0", padding: "1rem", marginTop: "1rem", whiteSpace: "pre-wrap" }}>{out}</pre>}
    </section>
  );
}
