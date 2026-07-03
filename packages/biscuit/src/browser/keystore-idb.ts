import type { KeystoreFile } from "../keystore.js";
import { idbDelete, idbGet, idbPut } from "./idb.js";

const KEY = "default";

export interface BrowserKeystore {
  load(): Promise<KeystoreFile | undefined>;
  save(ks: KeystoreFile): Promise<void>;
  clear(): Promise<void>;
}

export class IdbKeystore implements BrowserKeystore {
  load(): Promise<KeystoreFile | undefined> { return idbGet<KeystoreFile>("keystore", KEY); }
  save(ks: KeystoreFile): Promise<void> { return idbPut("keystore", KEY, ks); }
  clear(): Promise<void> { return idbDelete("keystore", KEY); }
}
