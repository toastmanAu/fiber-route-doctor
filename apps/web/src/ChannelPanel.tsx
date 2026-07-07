import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChannelClient, RpcMethodError, type RpcChannel } from "@fiber-route-doctor/core";
import { useWallet } from "./wallet-context.js";
import { parseCkbAmount, shannonHexToCkb, unauthorizedHint, PENDING_STATES } from "./channel-form.js";

interface ChannelPanelProps { fetchOverride?: typeof fetch; demoActive: boolean; }
type Confirm = { kind: "open"; pubkey: string; amountCkb: string } | { kind: "close"; channelId: string; force: boolean } | null;

export function ChannelPanel({ fetchOverride, demoActive }: ChannelPanelProps) {
  const { profiles } = useWallet();
  const [url, setUrl] = useState("http://127.0.0.1:8231");
  const [token, setToken] = useState("");
  const [address, setAddress] = useState("");
  const [openPubkey, setOpenPubkey] = useState("");
  const [amountCkb, setAmountCkb] = useState("500");
  const [channels, setChannels] = useState<RpcChannel[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [forceText, setForceText] = useState("");
  const [feeDraft, setFeeDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  function applyProfile(name: string) {
    const p = profiles.find((x) => x.name === name);
    if (p) { setUrl(p.url); setToken(p.token); }
  }
  const makeClient = useCallback(
    () => new ChannelClient({ url, biscuit: token.trim() || undefined, fetchImpl: fetchOverride }),
    [url, token, fetchOverride]
  );

  async function explainAndSetError(e: unknown) {
    if (e instanceof RpcMethodError && e.code === -32999) {
      let readOk = false;
      try { await makeClient().listChannels(); readOk = true; } catch { /* readOk stays false */ }
      setError(unauthorizedHint(readOk));
    } else { setError(String(e)); }
  }

  const refresh = useCallback(async () => {
    const id = ++runId.current;
    try {
      const list = await makeClient().listChannels();
      if (id === runId.current) { setChannels(list); setError(""); }
    } catch (e) { if (id === runId.current) await explainAndSetError(e); }
  }, [makeClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-poll while any channel is mid-lifecycle
  useEffect(() => {
    if (!channels?.some((c) => PENDING_STATES.has(c.state.state_name) || c.state.state_name === "Closed")) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [channels, refresh]);

  async function guard(run: () => Promise<void>) {
    setBusy(true); setMsg(""); setError("");
    try { await run(); } catch (e) { await explainAndSetError(e); } finally { setBusy(false); }
  }
  const doConnect = () => guard(async () => {
    await makeClient().connectPeer({ address: address.trim() });
    setMsg("connect_peer accepted"); await refresh();
  });
  const doOpen = (pubkey: string, amount: string) => guard(async () => {
    const r = await makeClient().openChannel({ pubkey: pubkey.trim(), funding_amount: parseCkbAmount(amount) });
    setMsg(`negotiation started — ${r.temporary_channel_id.slice(0, 14)}…`); setConfirm(null); await refresh();
  });
  const doUpdate = (c: RpcChannel, enabled?: boolean) => guard(async () => {
    const fee = feeDraft[c.channel_id]?.trim();
    if (enabled === undefined && fee && !/^\d+$/.test(fee)) { setError("fee must be a non-negative integer (ppm)"); return; }
    await makeClient().updateChannel({
      channel_id: c.channel_id, enabled,
      tlc_fee_proportional_millionths: fee && /^\d+$/.test(fee) ? `0x${BigInt(fee).toString(16)}` : undefined
    });
    setMsg("update_channel accepted"); await refresh();
  });
  const doClose = (channelId: string, force: boolean) => guard(async () => {
    await makeClient().shutdownChannel({ channel_id: channelId, force: force || undefined });
    setMsg(`shutdown_channel accepted${force ? " (FORCE)" : ""}`); setConfirm(null); setForceText(""); await refresh();
  });

  return (
    <section style={{ marginTop: "0.25rem" }}>
      {demoActive && <div style={{ display: "inline-block", background: "#f1c40f", color: "#111", fontWeight: "bold", padding: "0.1rem 0.5rem", marginBottom: "0.5rem" }}>SIMULATED</div>}
      {demoActive && <div style={{ fontSize: 12, color: "#8aa" }}>Simulator checks only that a token is attached — mint any token in the Wallet above, pick it here, and click through the real lifecycle.</div>}
      {profiles.length > 0 && (
        <div style={{ margin: "0.4rem 0" }}>
          <label>profile: <select defaultValue="" onChange={(e) => applyProfile(e.target.value)}>
            <option value="" disabled>— pick a minted token —</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.scope})</option>)}
          </select></label>
        </div>
      )}
      <div style={{ margin: "0.4rem 0" }}><label>node url: <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: 420 }} /></label></div>
      <div style={{ margin: "0.4rem 0" }}><label>biscuit token: <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 420 }} /></label></div>

      <h3>Connect peer</h3>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="/ip4/../tcp/../p2p/.." style={{ width: 420 }} />
        <button onClick={doConnect} disabled={busy || !address.trim()}>Connect</button>
      </div>

      <h3 style={{ marginTop: "1rem" }}>Open channel</h3>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
        <input value={openPubkey} onChange={(e) => setOpenPubkey(e.target.value)} placeholder="peer pubkey 0x02.." style={{ width: 320 }} />
        <label>amount (CKB) <input value={amountCkb} onChange={(e) => setAmountCkb(e.target.value)} style={{ width: 90 }} /></label>
        <button onClick={() => setConfirm({ kind: "open", pubkey: openPubkey, amountCkb })} disabled={busy || !openPubkey.trim() || !amountCkb.trim()}>Open…</button>
      </div>
      <div style={{ fontSize: 12, color: "#8aa" }}>funding must clear the peer's auto-accept floor (its node_info `open_channel_auto_accept_min_ckb_funding_amount`) and the node wallet must hold the CKB</div>

      <h3 style={{ marginTop: "1rem" }}>Channels</h3>
      <button onClick={refresh} disabled={busy}>Refresh</button>
      {channels !== null && channels.length === 0 && <div style={{ color: "#8aa", marginTop: "0.4rem" }}>no channels</div>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {(channels ?? []).map((c) => (
          <li key={c.channel_id} style={{ margin: "0.5rem 0", borderLeft: `3px solid ${c.state.state_name === "ChannelReady" ? "#2ecc71" : PENDING_STATES.has(c.state.state_name) ? "#f1c40f" : "#e74c3c"}`, paddingLeft: "0.6rem" }}>
            <div><strong>{c.state.state_name}</strong>{c.enabled ? "" : " (disabled)"} — {c.channel_id.slice(0, 14)}… peer {c.pubkey.slice(0, 12)}…</div>
            <div style={{ fontSize: 13 }}>local {shannonHexToCkb(c.local_balance)} CKB / remote {shannonHexToCkb(c.remote_balance)} CKB</div>
            {c.failure_detail && <div style={{ color: "#e74c3c" }}>FAILURE: {c.failure_detail}</div>}
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.2rem", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => doUpdate(c, !c.enabled)} disabled={busy}>{c.enabled ? "Disable" : "Enable"}</button>
              <input value={feeDraft[c.channel_id] ?? ""} onChange={(e) => setFeeDraft({ ...feeDraft, [c.channel_id]: e.target.value })} placeholder="fee ppm" style={{ width: 80 }} />
              <button onClick={() => doUpdate(c)} disabled={busy || !(feeDraft[c.channel_id] ?? "").trim()}>Set fee</button>
              <button onClick={() => setConfirm({ kind: "close", channelId: c.channel_id, force: false })} disabled={busy}>Close…</button>
              <button onClick={() => setConfirm({ kind: "close", channelId: c.channel_id, force: true })} disabled={busy} style={{ color: "#e74c3c" }}>Force close…</button>
            </div>
          </li>
        ))}
      </ul>

      {confirm?.kind === "open" && (
        <div style={{ border: "1px solid #f1c40f", padding: "0.6rem", margin: "0.6rem 0" }}>
          Open a channel to <code>{confirm.pubkey.slice(0, 20)}…</code> funding <strong>{confirm.amountCkb} CKB</strong> from the node wallet?
          <div style={{ marginTop: "0.4rem" }}>
            <button onClick={() => doOpen(confirm.pubkey, confirm.amountCkb)} disabled={busy}>Confirm open</button>{" "}
            <button onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {confirm?.kind === "close" && (
        <div style={{ border: "1px solid #e74c3c", padding: "0.6rem", margin: "0.6rem 0" }}>
          {confirm.force ? <>FORCE-close <code>{confirm.channelId.slice(0, 14)}…</code>? This broadcasts the commitment tx. Type <strong>force</strong> to enable:</>
            : <>Cooperatively close <code>{confirm.channelId.slice(0, 14)}…</code>?</>}
          <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {confirm.force && <input value={forceText} onChange={(e) => setForceText(e.target.value)} placeholder="type force" style={{ width: 100 }} />}
            <button onClick={() => doClose(confirm.channelId, confirm.force)} disabled={busy || (confirm.force && forceText !== "force")}>Confirm close</button>
            <button onClick={() => { setConfirm(null); setForceText(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ color: "#2ecc71", marginTop: "0.5rem" }}>{msg}</div>}
      {error && <pre style={{ color: "#e74c3c", whiteSpace: "pre-wrap" }}>{error}</pre>}
    </section>
  );
}
