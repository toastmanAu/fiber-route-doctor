import React, { useState } from "react";
import { GraphClient, loadGraph, runDiagnosis, formatReportText, type RouteReport } from "@fiber-route-doctor/core";
import { buildProbe } from "./probe-form.js";
import { buildRouteView } from "./route-view.js";
import { RouteGraph } from "./RouteGraph.js";
import { HealthPanel } from "./HealthPanel.js";
import { LiquidityPanel } from "./LiquidityPanel.js";
import { NetworkMapPanel } from "./NetworkMapPanel.js";
import { WalletProvider } from "./wallet-context.js";
import { WalletPanel } from "./WalletPanel.js";
import { demoFetch, DEMO_SOURCE, DEMO_TARGET, DEMO_AMOUNT } from "./demo/demo-fetch.js";
import { SectionHero } from "./SectionHero.js";
import heroMasthead from "./assets/hero-masthead.webp";
import heroWallet from "./assets/hero-wallet.webp";
import heroDiagnose from "./assets/hero-diagnose.webp";
import heroHealth from "./assets/hero-health.webp";
import heroLiquidity from "./assets/hero-liquidity.webp";
import heroMap from "./assets/hero-map.webp";

export function App() {
  const [url, setUrl] = useState("http://127.0.0.1:8227");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("1000");
  const [asset, setAsset] = useState("");
  const [out, setOut] = useState("");
  const [report, setReport] = useState<RouteReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  function toggleDemo(on: boolean) {
    setDemo(on);
    if (on) {
      setSource(DEMO_SOURCE); setTarget(DEMO_TARGET); setAmount(DEMO_AMOUNT); setAsset("");
    } else {
      setSource(""); setTarget(""); setAmount("1000");
    }
  }

  async function run() {
    setBusy(true);
    try {
      const probe = buildProbe({ source, target, amount, asset });
      const model = await loadGraph(new GraphClient({ url, fetchImpl: demo ? demoFetch : undefined }));
      const report: RouteReport = await runDiagnosis(model, probe);
      setReport(report);
      setOut(formatReportText(report));
    } catch (e) {
      setReport(null);
      setOut(`error: ${String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <WalletProvider>
      <main style={{ fontFamily: "monospace", maxWidth: 820, margin: "2rem auto", padding: "0 1rem" }}>
        <SectionHero image={heroMasthead} heading="Fiber Route Doctor" masthead />
        {import.meta.env.PROD && (
          <div style={{ background: "#0d1b2a", border: "1px solid #3498db", padding: "0.6rem", marginBottom: "1rem", fontSize: 13 }}>
            The wallet below is fully live in your browser (create a key, mint a real biscuit token — no backend).
            Toggle <strong>Demo data</strong> to explore a real 213-node / 650-channel testnet snapshot with no node.
            Live queries against your own node need the CLI or a CORS-enabled node — see the{" "}
            <a href="https://github.com/toastmanAu/fiber-route-doctor" style={{ color: "#3498db" }}>README</a> and{" "}
            <a href="https://github.com/toastmanAu/fiber-route-doctor/blob/master/docs/GAP-ANALYSIS.md" style={{ color: "#3498db" }}>gap analysis</a>.
          </div>
        )}
        <label style={{ display: "block", marginBottom: "1rem" }}>
          <input type="checkbox" checked={demo} onChange={(e) => toggleDemo(e.target.checked)} /> Demo data (real testnet snapshot — no node needed)
        </label>
        <SectionHero image={heroWallet} heading="Wallet" color="#2ecc71" align="right" />
        <WalletPanel />
        <SectionHero image={heroDiagnose} heading="Diagnose" color="#f1c40f" align="lower" />
        {([["node url", url, setUrl], ["source pubkey", source, setSource], ["target pubkey", target, setTarget], ["amount", amount, setAmount], ["asset (blank=CKB)", asset, setAsset]] as const).map(([label, val, set]) => (
          <div key={label} style={{ margin: "0.4rem 0" }}>
            <label>{label}: <input value={val} onChange={(e) => set(e.target.value)} style={{ width: 420 }} /></label>
          </div>
        ))}
        <button onClick={run} disabled={busy}>{busy ? "diagnosing…" : "Diagnose"}</button>
        {report && <RouteGraph view={buildRouteView(report)} />}
        {out && <pre style={{ background: "#111", color: "#0f0", padding: "1rem", marginTop: "1rem", whiteSpace: "pre-wrap" }}>{out}</pre>}
        <SectionHero image={heroHealth} heading="Node Health" color="#2ecc71" align="left" />
        <HealthPanel fetchOverride={demo ? demoFetch : undefined} />
        <SectionHero image={heroLiquidity} heading="Liquidity" color="#3498db" align="right" />
        <LiquidityPanel fetchOverride={demo ? demoFetch : undefined} />
        <SectionHero image={heroMap} heading="Network Map" color="#ffffff" align="lower-left" />
        <NetworkMapPanel routeOutpoints={report?.path.map((h) => h.channelOutpoint) ?? []} fetchOverride={demo ? demoFetch : undefined} />
      </main>
    </WalletProvider>
  );
}
