import React, { useEffect, useState } from "react";
import {
  IdbKeystore, IdbProfileStore, hasKeystore, createWallet, importWallet, mint, exportMnemonic,
  inspectToken, type BrowserTokenProfile
} from "@fiber-route-doctor/biscuit/browser";
import { useWallet } from "./wallet-context.js";

const ks = new IdbKeystore();
const profileStore = new IdbProfileStore();

export function WalletPanel() {
  const { profiles, refreshProfiles, setActiveProfile } = useWallet();
  const [has, setHas] = useState<boolean | null>(null);
  const [pass, setPass] = useState("");
  const [exportPass, setExportPass] = useState("");
  const [reveal, setReveal] = useState<string | null>(null);   // one-time mnemonic display
  const [importText, setImportText] = useState("");
  const [importKind, setImportKind] = useState<"mnemonic" | "privatekey">("mnemonic");
  const [showImport, setShowImport] = useState(false);
  const [scope, setScope] = useState<"readonly" | "invoicing" | "operator" | "full">("readonly");
  const [expiryDays, setExpiryDays] = useState("30");
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [profileName, setProfileName] = useState("dt");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void hasKeystore(ks).then(setHas); }, []);

  async function guard(run: () => Promise<void>) {
    setBusy(true); setError("");
    try { await run(); } catch (e) { setError(String(e)); } finally { setBusy(false); setPass(""); setExportPass(""); }
  }

  const doCreate = () => guard(async () => {
    const { mnemonic } = await createWallet(ks, pass);
    setReveal(mnemonic); setHas(true);
  });
  const doImport = () => guard(async () => {
    await importWallet(ks, importText, importKind, pass);
    setImportText(""); setShowImport(false); setHas(true);
  });
  const doMint = () => guard(async () => {
    await mint(ks, { passphrase: pass, scope, expiryDays: Number(expiryDays), url, profileName }, profileStore);
    await refreshProfiles();
  });
  const doExport = () => guard(async () => { setReveal(await exportMnemonic(ks, exportPass)); });
  const doRemove = () => guard(async () => {
    if (!confirm("Remove this wallet? The encrypted key is deleted from this browser.")) return;
    await ks.clear(); setHas(false);
  });
  const doInspect = (p: BrowserTokenProfile) => {
    try { alert(inspectToken(p.token, p.publicKeyString).facts.join("\n") || "(no facts)"); }
    catch (e) { alert(String(e)); }
  };
  const doDelete = (name: string) => guard(async () => { await profileStore.remove(name); await refreshProfiles(); });

  return (
    <section style={{ marginBottom: "2rem", border: "1px solid #444", padding: "1rem" }}>
      {error && <pre style={{ color: "#e74c3c" }}>{error}</pre>}
      {reveal && (
        <div style={{ border: "1px solid #f1c40f", padding: "0.6rem", margin: "0.6rem 0" }}>
          <strong>Back up these words — shown once:</strong>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{reveal}</pre>
          <button onClick={() => setReveal(null)}>I've saved it</button>
        </div>
      )}
      {has === false && !reveal && (
        <div>
          <label>passphrase: <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <div style={{ margin: "0.5rem 0" }}>
            <button onClick={doCreate} disabled={busy || !pass}>Create wallet</button>
          </div>
          <div style={{ margin: "0.5rem 0" }}>
            <select value={importKind} onChange={(e) => setImportKind(e.target.value as "mnemonic" | "privatekey")}>
              <option value="mnemonic">mnemonic</option>
              <option value="privatekey">hex key</option>
            </select>
            <input type={showImport ? "text" : "password"} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="24 words or ed25519-private/…" style={{ width: 360 }} />
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={showImport} onChange={(e) => setShowImport(e.target.checked)} /> show</label>
            <button onClick={doImport} disabled={busy || !pass || !importText}>Import</button>
          </div>
        </div>
      )}
      {has === true && (
        <div>
          <h3>Mint token</h3>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="readonly">readonly</option><option value="invoicing">invoicing</option><option value="operator">operator</option><option value="full">full</option>
            </select>
            <label>expiry days <input value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} style={{ width: 50 }} /></label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="node url" style={{ width: 220 }} />
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="profile name" style={{ width: 100 }} />
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="passphrase" />
            <button onClick={doMint} disabled={busy || !pass || !profileName}>Mint</button>
          </div>
          <h3 style={{ marginTop: "1rem" }}>Profiles</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {profiles.map((p) => (
              <li key={p.name} style={{ margin: "0.3rem 0" }}>
                <button onClick={() => setActiveProfile(p.name)}>use</button>{" "}
                <strong>{p.name}</strong> — {p.scope} · {p.url} · exp {p.expiresAt.slice(0, 10)} · {p.token.slice(0, 8)}…{" "}
                <button onClick={() => doInspect(p)}>inspect</button>{" "}
                <button onClick={() => doDelete(p.name)}>delete</button>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <input type="password" value={exportPass} onChange={(e) => setExportPass(e.target.value)} placeholder="passphrase" />
            <button onClick={doExport} disabled={busy || !exportPass}>Export seed phrase</button>
            <button onClick={doRemove} disabled={busy} style={{ color: "#e74c3c" }}>Remove wallet</button>
          </div>
        </div>
      )}
    </section>
  );
}
