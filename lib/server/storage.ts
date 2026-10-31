// حدود التخزين وتنظيف الملفات المؤقتة/المنتهية. منطق نقي فوق fs، يُختبر بمجلدات مؤقتة.
//
// - لا يلمس مساحة عمل المشاريع (بيانات المستخدم) إطلاقاً — فقط مجلدات مؤقتة مُدارة.
// - لا يتبع الروابط الرمزية (lstat) ويحذف الرابط نفسه لا هدفه.
// - يرفض العمل على جذر/مجلد ضحل (حارس ضد تهيئة خاطئة).
import { promises as fsp } from "fs";
import path from "path";
import { EngineError } from "@/lib/engine/errors";
import { logger } from "@/lib/server/logger";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface StorageConfig {
  maxStorageBytes: number;
  uploadTtlMs: number;
  exportTtlMs: number;
  pipelineTtlMs: number;
}

function num(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    maxStorageBytes: num(env.MONTAGE_MAX_STORAGE_BYTES, 20 * GB),
    uploadTtlMs: num(env.MONTAGE_UPLOAD_TTL_HOURS, 24) * 3600_000,
    exportTtlMs: num(env.MONTAGE_EXPORT_TTL_HOURS, 72) * 3600_000,
    pipelineTtlMs: num(env.MONTAGE_PIPELINE_TTL_HOURS, 48) * 3600_000,
  };
}

export function managedDirs(cwd = process.cwd()): { dir: string; ttl: keyof StorageConfig }[] {
  const base = path.join(cwd, ".montage_ai");
  return [
    { dir: path.join(base, "uploads"), ttl: "uploadTtlMs" },
    { dir: path.join(base, "exports"), ttl: "exportTtlMs" },
    { dir: path.join(base, "pipeline"), ttl: "pipelineTtlMs" },
  ];
}

function assertSafeDir(dir: string): void {
  const resolved = path.resolve(dir);
  const depth = resolved.split(path.sep).filter(Boolean).length;
  if (depth < 2) throw new EngineError("INVALID_INPUT", "مجلد التنظيف ضحل جداً — مرفوض");
}

/** حجم مجلد بالبايت (بلا اتباع الروابط). */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import("fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fsp.stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

export interface CleanupResult {
  dir: string;
  removed: string[];
  freedBytes: number;
}

/** يحذف العناصر المباشرة في dir التي مضى على آخر تعديل لها أكثر من maxAgeMs. */
export async function cleanupDir(
  dir: string,
  maxAgeMs: number,
  opts: { now?: number; dryRun?: boolean } = {}
): Promise<CleanupResult> {
  assertSafeDir(dir);
  const now = opts.now ?? Date.now();
  const result: CleanupResult = { dir, removed: [], freedBytes: 0 };
  let entries: import("fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const st = await fsp.lstat(p).catch(() => null);
    if (!st) continue;
    if (now - st.mtimeMs <= maxAgeMs) continue;
    const size = st.isDirectory() ? await dirSize(p) : st.size;
    if (!opts.dryRun) await fsp.rm(p, { recursive: true, force: true }).catch(() => undefined);
    result.removed.push(e.name);
    result.freedBytes += size;
  }
  return result;
}

export async function runCleanup(opts: { dryRun?: boolean; cwd?: string; config?: StorageConfig; now?: number } = {}): Promise<CleanupResult[]> {
  const cfg = opts.config ?? storageConfig();
  const out: CleanupResult[] = [];
  for (const t of managedDirs(opts.cwd)) {
    out.push(await cleanupDir(t.dir, cfg[t.ttl], { dryRun: opts.dryRun, now: opts.now }));
  }
  const freed = out.reduce((a, r) => a + r.freedBytes, 0);
  const files = out.reduce((a, r) => a + r.removed.length, 0);
  if (files > 0) logger.info("storage.cleanup", { files, freedBytes: freed, dryRun: !!opts.dryRun });
  return out;
}

let lastSweep = 0;
/** تنظيف انتهازي مُقيَّد زمنياً (مرة كل 10 دقائق كحد أقصى) — يُستدعى عند الرفع. لا يرمي أبداً. */
export async function maybeCleanup(now = Date.now(), minIntervalMs = 10 * 60_000): Promise<void> {
  if (now - lastSweep < minIntervalMs) return;
  lastSweep = now;
  try {
    await runCleanup({ now });
  } catch (e) {
    logger.warn("storage.cleanup_failed", { error: e });
  }
}

/** يرفض (LIMIT_EXCEEDED) إن كان إضافة extraBytes ستتجاوز سقف التخزين الكلي للمجلدات المُدارة. */
export async function ensureStorageQuota(extraBytes: number, cfg: StorageConfig = storageConfig(), cwd?: string): Promise<void> {
  let used = 0;
  for (const t of managedDirs(cwd)) used += await dirSize(t.dir);
  // أصول الصوت المرفوعة (T-13) لا تُنظَّف تلقائياً لكنها تُحتسب في السقف.
  used += await dirSize(path.join(cwd ?? process.cwd(), ".montage_ai", "assets", "audio"));
  if (used + extraBytes > cfg.maxStorageBytes) {
    const mb = Math.round(cfg.maxStorageBytes / MB);
    throw new EngineError("LIMIT_EXCEEDED", `تجاوز سقف التخزين (${mb}MB) — احذف ملفات قديمة أو شغّل pnpm cleanup`, "MONTAGE_MAX_STORAGE_BYTES يضبط السقف.");
  }
}
