// ====================================================================
// السجل الدائم للإضافات — تحت <workspace>/extensions/ (لا شيء خارج الجذر).
//
//   extensions/<skills|tools>/<id>/state.json     ← حالة + منح + إصدار فعّال + سجل إصدارات
//   extensions/<skills|tools>/<id>/v/<ver>.json   ← الحزمة الكاملة لكل إصدار (غير قابلة للتعديل)
//   extensions/<skills|tools>/<id>/runs.jsonl     ← سجل التنفيذ (مقتطع، بلا أسرار)
//   extensions/rev.json                           ← عدّاد تغيّر السجل (يراقبه خادم MCP)
//
// الأصل (origin) يُحدَّد بطريقة الدخول: user (أُنشئ هنا) أو imported (حزمة). المدمجة
// ليست في هذا المخزن إطلاقاً، فلا يمكن الكتابة فوقها.
// ====================================================================
import { promises as fsp } from "fs";
import path from "path";
import { EngineError } from "@/lib/engine/errors";
import { assertId, readJson, withLock, workspaceRoot, writeJsonAtomic } from "@/lib/engine/store";
import { isPathInside } from "@/lib/server/ffmpeg-export";
import { compareSemver, isSemver } from "./semver";
import { ID_RE, computeDigest, type ExtensionKind, type ExtensionPackage, type Permission } from "./manifest";

export type Origin = "user" | "imported";
export const MAX_PER_KIND = 100;
export const MAX_VERSIONS = 30;
const RUNS_KEEP = 200;

export interface VersionEntry {
  version: string;
  savedAt: string;
  digest: string;
  note?: string;
}

export interface TestRecord {
  version: string;
  ok: boolean;
  at: string;
  durationMs: number;
  provenance?: string;
  error?: string;
}

export interface RunRecord {
  at: string;
  version: string;
  mode: "run" | "test" | "mcp";
  ok: boolean;
  durationMs: number;
  provenance?: string;
  code?: string;
  error?: string;
  logs?: string[];
}

export interface ExtensionState {
  id: string;
  kind: ExtensionKind;
  origin: Origin;
  enabled: boolean;
  activeVersion: string;
  /** صلاحيات منحها المالك (منفصلة عن المُعلنة في البيان). */
  grants: Permission[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  versions: VersionEntry[];
  lastTest?: TestRecord;
  lastRun?: RunRecord;
}

const dirName = (kind: ExtensionKind) => (kind === "skill" ? "skills" : "tools");
const root = () => path.join(workspaceRoot(), "extensions");

function extDir(kind: ExtensionKind, id: string): string {
  assertId(id, "معرّف الإضافة");
  if (!ID_RE.test(id)) throw new EngineError("INVALID_INPUT", "معرّف الإضافة غير صالح", "snake_case صغيرة، 3-48 حرفاً.");
  const dir = path.join(root(), dirName(kind), id);
  if (!isPathInside(dir, root())) throw new EngineError("FORBIDDEN_PATH", "مسار إضافة خارج المخزن");
  return dir;
}

const lockKey = (kind: ExtensionKind, id: string) => `ext:${kind}:${id}`;

async function bumpRev(): Promise<void> {
  await writeJsonAtomic(path.join(root(), "rev.json"), { rev: Date.now(), at: new Date().toISOString() });
}

/** يُعيد بصمة التغيّر (mtime لملف rev) — للمراقبة منخفضة الكلفة. */
export async function registryRev(): Promise<number> {
  try {
    return (await fsp.stat(path.join(root(), "rev.json"))).mtimeMs;
  } catch {
    return 0;
  }
}

export async function listStates(kind: ExtensionKind): Promise<ExtensionState[]> {
  const dir = path.join(root(), dirName(kind));
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: ExtensionState[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const st = await readJson<ExtensionState>(path.join(dir, e.name, "state.json")).catch(() => null);
    if (st) out.push(st);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getState(kind: ExtensionKind, id: string): Promise<ExtensionState | null> {
  return readJson<ExtensionState>(path.join(extDir(kind, id), "state.json"));
}

export async function mustGetState(kind: ExtensionKind, id: string): Promise<ExtensionState> {
  const st = await getState(kind, id);
  if (!st) throw new EngineError("NOT_FOUND", `${kind === "skill" ? "مهارة" : "أداة"} مخصّصة غير موجودة: ${id}`);
  return st;
}

export async function readVersion(kind: ExtensionKind, id: string, version: string): Promise<ExtensionPackage> {
  // الإصدار يدخل في مسار ملف: semver صارم فقط (يمنع ../ وأي محارف مسار).
  if (typeof version !== "string" || !isSemver(version)) throw new EngineError("INVALID_INPUT", "رقم إصدار غير صالح", "major.minor.patch");
  const pkg = await readJson<ExtensionPackage>(path.join(extDir(kind, id), "v", `${version}.json`));
  if (!pkg) throw new EngineError("NOT_FOUND", `الإصدار ${version} غير موجود للإضافة ${id}`);
  return pkg;
}

export async function readActivePackage(kind: ExtensionKind, id: string): Promise<{ state: ExtensionState; pkg: ExtensionPackage }> {
  const state = await mustGetState(kind, id);
  return { state, pkg: await readVersion(kind, id, state.activeVersion) };
}

export interface SaveOptions {
  origin: Origin;
  note?: string;
  /** عند true يُسمح بإنشاء إصدار جديد لإضافة قائمة؛ وإلا يُرفض التكرار (CONFLICT). */
  allowNewVersion?: boolean;
}

/**
 * يحفظ إصداراً جديداً. الإصدار الأول يُنشئ الإضافة معطّلة (لا تفعيل ضمني).
 * إصدار جديد: يجب أن يكون أعلى من الأعلى الحالي؛ يبقى الفعّال كما هو حتى setActive/ rollback
 * عدا إن كانت الإضافة معطّلة (يصبح الجديد هو الفعّال).
 */
export async function saveVersion(pkg: ExtensionPackage, opts: SaveOptions): Promise<ExtensionState> {
  const { kind } = pkg;
  const id = pkg.manifest.id;
  const dir = extDir(kind, id);
  return withLock(lockKey(kind, id), async () => {
    const existing = await getState(kind, id);
    const digest = computeDigest(pkg.manifest, pkg.files);
    const now = new Date().toISOString();
    if (!existing) {
      if ((await listStates(kind)).length >= MAX_PER_KIND) throw new EngineError("LIMIT_EXCEEDED", `الحد الأقصى ${MAX_PER_KIND} إضافة من كل نوع`);
      const st: ExtensionState = {
        id, kind, origin: opts.origin, enabled: false, activeVersion: pkg.manifest.version, grants: [],
        config: {}, createdAt: now, updatedAt: now, versions: [{ version: pkg.manifest.version, savedAt: now, digest, note: opts.note }],
      };
      await writeJsonAtomic(path.join(dir, "v", `${pkg.manifest.version}.json`), pkg);
      await writeJsonAtomic(path.join(dir, "state.json"), st);
      await bumpRev();
      return st;
    }
    if (!opts.allowNewVersion) {
      throw new EngineError("CONFLICT", `المعرّف «${id}» مستخدم مسبقاً`, "استخدم تحديث الإضافة بإصدار أعلى، أو اختر معرّفاً آخر. لا يُكتب فوق الموجود.");
    }
    const same = existing.versions.find((v) => v.version === pkg.manifest.version);
    if (same) {
      if (same.digest === digest) return existing; // نفس المحتوى — لا تغيير
      throw new EngineError("CONFLICT", `الإصدار ${pkg.manifest.version} موجود بمحتوى مختلف`, "ارفع رقم الإصدار — الإصدارات المحفوظة غير قابلة للتعديل.");
    }
    const top = existing.versions.map((v) => v.version).sort(compareSemver).pop() as string;
    if (compareSemver(pkg.manifest.version, top) <= 0) {
      throw new EngineError("CONFLICT", `الإصدار ${pkg.manifest.version} ليس أعلى من ${top}`, "الإصدار الجديد يجب أن يكون أعلى من كل الإصدارات المحفوظة.");
    }
    await writeJsonAtomic(path.join(dir, "v", `${pkg.manifest.version}.json`), pkg);
    const versions = [...existing.versions, { version: pkg.manifest.version, savedAt: now, digest, note: opts.note }];
    // تقليم الأقدم (مع الإبقاء على الفعّال).
    while (versions.length > MAX_VERSIONS) {
      const idx = versions.findIndex((v) => v.version !== existing.activeVersion);
      const [gone] = versions.splice(idx, 1);
      await fsp.rm(path.join(dir, "v", `${gone.version}.json`), { force: true });
    }
    const st: ExtensionState = {
      ...existing,
      versions,
      // الإضافة المفعّلة تبقى على إصدارها المختبَر؛ المعطّلة تنتقل للجديد.
      activeVersion: existing.enabled ? existing.activeVersion : pkg.manifest.version,
      updatedAt: now,
      lastTest: existing.enabled ? existing.lastTest : undefined,
    };
    await writeJsonAtomic(path.join(dir, "state.json"), st);
    await bumpRev();
    return st;
  });
}

export async function patchState(kind: ExtensionKind, id: string, fn: (s: ExtensionState) => ExtensionState): Promise<ExtensionState> {
  return withLock(lockKey(kind, id), async () => {
    const cur = await mustGetState(kind, id);
    const next = { ...fn(structuredClone(cur)), updatedAt: new Date().toISOString() };
    await writeJsonAtomic(path.join(extDir(kind, id), "state.json"), next);
    await bumpRev();
    return next;
  });
}

export async function removeExtension(kind: ExtensionKind, id: string): Promise<void> {
  const dir = extDir(kind, id);
  await withLock(lockKey(kind, id), async () => {
    await mustGetState(kind, id);
    await fsp.rm(dir, { recursive: true, force: true });
    await bumpRev();
  });
}

// ---------------------------------------------------------------- سجل التنفيذ
export async function appendRun(kind: ExtensionKind, id: string, rec: RunRecord): Promise<void> {
  try {
    const file = path.join(extDir(kind, id), "runs.jsonl");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const line = JSON.stringify({ ...rec, error: rec.error?.slice(0, 1000), logs: rec.logs?.slice(0, 50).map((l) => l.slice(0, 300)) }) + "\n";
    await fsp.appendFile(file, line, "utf-8");
    await withLock(lockKey(kind, id), async () => {
      const st = await getState(kind, id);
      if (!st) return;
      const upd = { ...st, lastRun: rec, ...(rec.mode === "test" ? { lastTest: { version: rec.version, ok: rec.ok, at: rec.at, durationMs: rec.durationMs, provenance: rec.provenance, error: rec.error?.slice(0, 300) } } : {}) };
      await writeJsonAtomic(path.join(extDir(kind, id), "state.json"), upd); // لا bumpRev: لا يغيّر ما يُعرض لعملاء MCP
    });
    const size = (await fsp.stat(file)).size;
    if (size > 400_000) {
      const lines = (await fsp.readFile(file, "utf-8")).trim().split("\n");
      await fsp.writeFile(file, lines.slice(-RUNS_KEEP).join("\n") + "\n", "utf-8");
    }
  } catch {
    /* سجل التنفيذ لا يُسقط التنفيذ */
  }
}

export async function readRuns(kind: ExtensionKind, id: string, limit = 50): Promise<RunRecord[]> {
  try {
    const text = await fsp.readFile(path.join(extDir(kind, id), "runs.jsonl"), "utf-8");
    return text.trim().split("\n").filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as RunRecord).reverse();
  } catch {
    return [];
  }
}
