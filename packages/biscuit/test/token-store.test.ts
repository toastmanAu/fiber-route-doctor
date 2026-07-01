import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFsTokenStore, type TokenProfile } from "../src/index.js";

const p = (name: string): TokenProfile => ({ name, url: "http://n", token: "tok-" + name, scope: "readonly", expiresAt: "2026-08-01T00:00:00Z" });

describe("NodeFsTokenStore", () => {
  it("puts, lists, gets, removes; upsert replaces by name; file is 600", () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-"));
    const path = join(dir, "profiles.json");
    const s = new NodeFsTokenStore(path);
    expect(s.list()).toEqual([]);
    s.put(p("a")); s.put(p("b"));
    expect(s.list().map(x => x.name).sort()).toEqual(["a", "b"]);
    expect(s.get("a")?.token).toBe("tok-a");
    s.put({ ...p("a"), token: "tok-a2" });
    expect(s.get("a")?.token).toBe("tok-a2");
    expect(s.list().length).toBe(2);
    expect((statSync(path).mode & 0o777)).toBe(0o600);
    s.remove("a");
    expect(s.get("a")).toBeUndefined();
  });

  it("re-enforces 600 when overwriting a pre-existing looser-perm file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-"));
    const path = join(dir, "profiles.json");
    const s = new NodeFsTokenStore(path);
    s.put(p("a"));
    chmodSync(path, 0o644);
    expect((statSync(path).mode & 0o777)).toBe(0o644);
    s.put(p("b"));
    expect((statSync(path).mode & 0o777)).toBe(0o600);
    expect(s.list().map(x => x.name).sort()).toEqual(["a", "b"]);
  });
});
