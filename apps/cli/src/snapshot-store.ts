import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LiquiditySnapshot, SnapshotStore } from "@fiber-route-doctor/core";

export class NodeFsSnapshotStore implements SnapshotStore {
  constructor(private readonly dir: string) {}

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).sort();
  }

  get(name: string): LiquiditySnapshot | undefined {
    const path = join(this.dir, name);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as LiquiditySnapshot;
  }

  put(s: LiquiditySnapshot): string {
    mkdirSync(this.dir, { recursive: true });
    const name = `${s.ts.replaceAll(":", "-")}.json`;
    const path = join(this.dir, name);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return name;
  }

  latest(): LiquiditySnapshot | undefined {
    const names = this.list();
    return names.length ? this.get(names[names.length - 1]) : undefined;
  }
}
