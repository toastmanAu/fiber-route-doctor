import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFsSnapshotStore } from "../src/snapshot-store.js";
import type { LiquiditySnapshot } from "@fiber-route-doctor/core";

const snap = (ts: string): LiquiditySnapshot => ({ ts, nodeUrl: "http://n:8231", channels: [] });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "frd-snap-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("NodeFsSnapshotStore", () => {
  it("round-trips a snapshot with a filesystem-safe name and 0600 mode", () => {
    const store = new NodeFsSnapshotStore(dir);
    const name = store.put(snap("2026-07-03T10:00:00.000Z"));
    expect(name).toBe("2026-07-03T10-00-00.000Z.json");
    expect(store.get(name)).toEqual(snap("2026-07-03T10:00:00.000Z"));
    expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false); // atomic: no temp left behind
  });
  it("list() sorts and latest() returns the newest snapshot", () => {
    const store = new NodeFsSnapshotStore(dir);
    store.put(snap("2026-07-03T10:00:00.000Z"));
    store.put(snap("2026-07-01T10:00:00.000Z"));
    store.put(snap("2026-07-02T10:00:00.000Z"));
    expect(store.list()).toHaveLength(3);
    expect(store.latest()?.ts).toBe("2026-07-03T10:00:00.000Z");
  });
  it("returns empty/undefined when the directory does not exist yet", () => {
    const store = new NodeFsSnapshotStore(join(dir, "never-created"));
    expect(store.list()).toEqual([]);
    expect(store.latest()).toBeUndefined();
    expect(store.get("nope.json")).toBeUndefined();
  });
});
