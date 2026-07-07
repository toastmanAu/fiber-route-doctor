import React, { useState } from "react";
import { type RouteReport } from "@fiber-route-doctor/core";
import { HealthPanel } from "./HealthPanel.js";
import { LiquidityPanel } from "./LiquidityPanel.js";
import { NetworkMapPanel } from "./NetworkMapPanel.js";
import { DiagnosePanel } from "./DiagnosePanel.js";
import { WalletProvider } from "./wallet-context.js";
import { WalletPanel } from "./WalletPanel.js";
import { demoFetch } from "./demo/demo-fetch.js";
import { SectionHero } from "./SectionHero.js";
import heroMasthead from "./assets/hero-masthead.webp";
import heroWallet from "./assets/hero-wallet.webp";
import heroDiagnose from "./assets/hero-diagnose.webp";
import heroHealth from "./assets/hero-health.webp";
import heroLiquidity from "./assets/hero-liquidity.webp";
import heroMap from "./assets/hero-map.webp";

export function App() {
  const [report, setReport] = useState<RouteReport | null>(null);
  const [demo, setDemo] = useState(false);
  const fetchOverride = demo ? demoFetch : undefined;

  return (
    <WalletProvider>
      <main style={{ fontFamily: "monospace", maxWidth: 820, margin: "2rem auto", padding: "0 1rem" }}>
        <SectionHero image={heroMasthead} heading="Fiber Route Doctor" masthead />
        {import.meta.env.PROD && (
          <div style={{ background: "#13263b", border: "1px solid #3498db", padding: "0.6rem", marginBottom: "1rem", fontSize: 13, color: "#e6edf3" }}>
            The wallet below is fully live in your browser (create a key, mint a real biscuit token — no backend).
            Toggle <strong>Demo data</strong> to explore a real testnet snapshot (hundreds of live channels) with no node.
            Live queries against your own node need the CLI or a CORS-enabled node — see the{" "}
            <a href="https://github.com/toastmanAu/fiber-route-doctor" style={{ color: "#3498db" }}>README</a> and{" "}
            <a href="https://github.com/toastmanAu/fiber-route-doctor/blob/master/docs/GAP-ANALYSIS.md" style={{ color: "#3498db" }}>gap analysis</a>.
          </div>
        )}
        <label style={{ display: "block", marginBottom: "1rem" }}>
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Demo data (real testnet snapshot — no node needed)
        </label>
        <SectionHero image={heroWallet} heading="Wallet" color="#2ecc71" align="right" />
        <WalletPanel />
        <SectionHero image={heroDiagnose} heading="Diagnose" color="#f1c40f" align="lower" />
        <DiagnosePanel fetchOverride={fetchOverride} demoActive={demo} onReport={setReport} />
        <SectionHero image={heroHealth} heading="Node Health" color="#2ecc71" align="left" />
        <HealthPanel fetchOverride={fetchOverride} />
        <SectionHero image={heroLiquidity} heading="Liquidity" color="#3498db" align="right" />
        <LiquidityPanel fetchOverride={fetchOverride} />
        <SectionHero image={heroMap} heading="Network Map" color="#ffffff" align="lower-left" />
        <NetworkMapPanel routeOutpoints={report?.path.map((h) => h.channelOutpoint) ?? []} fetchOverride={fetchOverride} />
      </main>
    </WalletProvider>
  );
}
