import React, { useState } from "react";
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type RouteReport } from "@fiber-route-doctor/core";
import { buildProbe } from "./probe-form.js";
import { buildRouteView } from "./route-view.js";
import { RouteGraph } from "./RouteGraph.js";

export function App() {
  const [url, setUrl] = useState("http://127.0.0.1:8227");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("1000");
  const [asset, setAsset] = useState("");
  const [out, setOut] = useState("");
  const [report, setReport] = useState<RouteReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const probe = buildProbe({ source, target, amount, asset });
      const model = await loadGraph(new GraphClient({ url }));
      const report: RouteReport = await runDiagnosis(model, probe);
      setReport(report);
      setOut(formatReportText(report));
    } catch (e) {
      setReport(null);
      setOut(`error: ${String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <main style={{ fontFamily: "monospace", maxWidth: 720, margin: "2rem auto" }}>
      <h1>Fiber Route Doctor</h1>
      {([["node url", url, setUrl], ["source pubkey", source, setSource], ["target pubkey", target, setTarget], ["amount", amount, setAmount], ["asset (blank=CKB)", asset, setAsset]] as const).map(([label, val, set]) => (
        <div key={label} style={{ margin: "0.4rem 0" }}>
          <label>{label}: <input value={val} onChange={(e) => set(e.target.value)} style={{ width: 420 }} /></label>
        </div>
      ))}
      <button onClick={run} disabled={busy}>{busy ? "diagnosing…" : "Diagnose"}</button>
      {report && <RouteGraph view={buildRouteView(report)} />}
      <pre style={{ background: "#111", color: "#0f0", padding: "1rem", marginTop: "1rem", whiteSpace: "pre-wrap" }}>{out}</pre>
    </main>
  );
}
