import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { IdbProfileStore, type BrowserTokenProfile } from "@fiber-route-doctor/biscuit/browser";

export function selectActive(profiles: BrowserTokenProfile[], name: string | null): BrowserTokenProfile | null {
  if (name === null) return null;
  return profiles.find((p) => p.name === name) ?? null;
}

interface WalletContextValue {
  profiles: BrowserTokenProfile[];
  activeProfileName: string | null;
  activeProfile: BrowserTokenProfile | null;
  setActiveProfile: (name: string | null) => void;
  refreshProfiles: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const store = new IdbProfileStore();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<BrowserTokenProfile[]>([]);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await store.list());
  }, []);

  useEffect(() => { void refreshProfiles(); }, [refreshProfiles]);

  const value = useMemo<WalletContextValue>(() => ({
    profiles,
    activeProfileName,
    activeProfile: selectActive(profiles, activeProfileName),
    setActiveProfile: setActiveProfileName,
    refreshProfiles
  }), [profiles, activeProfileName, refreshProfiles]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
