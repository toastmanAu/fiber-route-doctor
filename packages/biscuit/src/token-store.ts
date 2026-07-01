import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface TokenProfile { name: string; url: string; token: string; scope: string; expiresAt: string; }

export class NodeFsTokenStore {
  constructor(private readonly filePath: string) {}
  private read(): TokenProfile[] {
    if (!existsSync(this.filePath)) return [];
    return JSON.parse(readFileSync(this.filePath, "utf8")) as TokenProfile[];
  }
  private write(profiles: TokenProfile[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(profiles, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.filePath);
  }
  list(): TokenProfile[] { return this.read(); }
  get(name: string): TokenProfile | undefined { return this.read().find((p) => p.name === name); }
  put(profile: TokenProfile): void {
    const next = this.read().filter((p) => p.name !== profile.name);
    next.push(profile);
    this.write(next);
  }
  remove(name: string): void { this.write(this.read().filter((p) => p.name !== name)); }
}
