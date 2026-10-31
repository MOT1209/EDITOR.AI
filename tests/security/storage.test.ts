import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, utimesSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { cleanupDir, dirSize, ensureStorageQuota, runCleanup, managedDirs, type StorageConfig } from "@/lib/server/storage";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), "montage-st-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const age = (p: string, hours: number) => { const t = (Date.now() - hours * 3600_000) / 1000; utimesSync(p, t, t); };

describe("temporary file cleanup", () => {
  it("removes only entries older than TTL (files and directories)", async () => {
    const dir = path.join(root, "a", "uploads"); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "old.mp4"), "x".repeat(100)); age(path.join(dir, "old.mp4"), 48);
    writeFileSync(path.join(dir, "new.mp4"), "y"); 
    mkdirSync(path.join(dir, "olddir")); writeFileSync(path.join(dir, "olddir", "f"), "z".repeat(10)); age(path.join(dir, "olddir"), 48);
    const r = await cleanupDir(dir, 24 * 3600_000);
    expect(r.removed.sort()).toEqual(["old.mp4", "olddir"]);
    expect(r.freedBytes).toBe(110);
    expect(existsSync(path.join(dir, "new.mp4"))).toBe(true);
    expect(existsSync(path.join(dir, "old.mp4"))).toBe(false);
  });
  it("dry-run deletes nothing", async () => {
    const dir = path.join(root, "a", "exports"); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "old"), "x"); age(path.join(dir, "old"), 999);
    const r = await cleanupDir(dir, 1000, { dryRun: true });
    expect(r.removed).toEqual(["old"]);
    expect(existsSync(path.join(dir, "old"))).toBe(true);
  });
  it("never follows a symlink out of the managed dir (removes the link only)", async () => {
    const dir = path.join(root, "a", "uploads"); mkdirSync(dir, { recursive: true });
    const outside = path.join(root, "precious"); mkdirSync(outside); writeFileSync(path.join(outside, "keep.txt"), "data");
    symlinkSync(outside, path.join(dir, "link")); 
    // lstat mtime of the link itself
    await cleanupDir(dir, -1);
    expect(existsSync(path.join(outside, "keep.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "link"))).toBe(false);
  });
  it("refuses a root-like directory", async () => {
    await expect(cleanupDir("/", 0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("runCleanup never touches the workspace (user projects)", async () => {
    const ws = path.join(root, ".montage_ai", "workspace", "projects", "p1"); mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, "project.json"), "{}"); age(path.join(ws, "project.json"), 9999); age(ws, 9999);
    const cfg: StorageConfig = { maxStorageBytes: 1e9, uploadTtlMs: 1, exportTtlMs: 1, pipelineTtlMs: 1 };
    await runCleanup({ cwd: root, config: cfg });
    expect(existsSync(path.join(ws, "project.json"))).toBe(true);
    expect(managedDirs(root).map((d) => path.basename(d.dir)).sort()).toEqual(["exports", "pipeline", "uploads"]);
  });
});

describe("storage quota", () => {
  it("rejects when used + incoming exceeds the cap", async () => {
    const [up] = managedDirs(root); mkdirSync(up.dir, { recursive: true });
    writeFileSync(path.join(up.dir, "a"), "x".repeat(1000));
    expect(await dirSize(up.dir)).toBe(1000);
    const cfg: StorageConfig = { maxStorageBytes: 1500, uploadTtlMs: 1, exportTtlMs: 1, pipelineTtlMs: 1 };
    await expect(ensureStorageQuota(400, cfg, root)).resolves.toBeUndefined();
    await expect(ensureStorageQuota(600, cfg, root)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});
