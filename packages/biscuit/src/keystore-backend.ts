import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { KeystoreFile } from "./keystore.js";

export interface KeystoreBackend {
  load(): KeystoreFile | null;
  save(ks: KeystoreFile): void;
  exists(): boolean;
}

export class NodeFsKeystore implements KeystoreBackend {
  constructor(private readonly filePath: string) {}
  exists(): boolean { return existsSync(this.filePath); }
  load(): KeystoreFile | null {
    if (!existsSync(this.filePath)) return null;
    return JSON.parse(readFileSync(this.filePath, "utf8")) as KeystoreFile;
  }
  save(ks: KeystoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(ks, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.filePath);
  }
}
