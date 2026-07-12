import React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const barStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  zIndex: 1000,
  display: "flex",
  gap: 12,
  alignItems: "center",
  background: "#13263b",
  color: "#e6edf3",
  border: "1px solid #3498db",
  borderRadius: 8,
  padding: "12px 16px"
};

const buttonStyle: React.CSSProperties = {
  background: "#3498db",
  color: "#ffffff",
  border: 0,
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer"
};

/**
 * Prompt-mode service-worker updates: a new deploy never reloads the page on
 * its own (a silent reload could interrupt an in-flight key-mint or
 * channel-open) — the user chooses when to pick it up.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;
  return (
    <div style={barStyle} role="status">
      <span>A new version is available.</span>
      <button style={buttonStyle} onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
      <button style={{ ...buttonStyle, background: "transparent", color: "#e6edf3" }} onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
