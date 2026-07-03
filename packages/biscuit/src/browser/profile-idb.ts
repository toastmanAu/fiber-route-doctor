import { idbDelete, idbGet, idbGetAll, idbPut } from "./idb.js";

export interface BrowserTokenProfile {
  name: string;
  url: string;
  token: string;
  scope: string;
  expiresAt: string;
  publicKeyString: string;
}

export interface BrowserProfileStore {
  list(): Promise<BrowserTokenProfile[]>;
  get(name: string): Promise<BrowserTokenProfile | undefined>;
  put(p: BrowserTokenProfile): Promise<void>;
  remove(name: string): Promise<void>;
}

export class IdbProfileStore implements BrowserProfileStore {
  list(): Promise<BrowserTokenProfile[]> { return idbGetAll<BrowserTokenProfile>("profiles"); }
  get(name: string): Promise<BrowserTokenProfile | undefined> { return idbGet<BrowserTokenProfile>("profiles", name); }
  put(p: BrowserTokenProfile): Promise<void> { return idbPut("profiles", p.name, p); }
  remove(name: string): Promise<void> { return idbDelete("profiles", name); }
}
