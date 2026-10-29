// ====================================================================
// مخزن مساحة العمل على الخادم (Workspace) — مصدر الحقيقة لمشاريع MCP.
//
// التخطيط على القرص (كله تحت جذر واحد، لا شيء خارجه يُقرأ أو يُكتب):
//   <root>/projects/<projectId>/project.json   ← ProjectState (schemaVersion)
//   <root>/projects/<projectId>/history.json   ← undo/redo (لقطات محدودة)
//   <root>/projects/<projectId>/media/<assetId><ext>
//   <root>/projects/<projectId>/renders/<jobId>/{status.json, output.*}
//   <root>/projects/<projectId>/plans/<planId>.json
//   <root>/audit.log                           ← JSONL بلا أسرار ولا محتوى وسائط
//   <root>/inbox/                              ← جذر الاستيراد الافتراضي
//
// الكتابة ذرية (tmp + rename) ومُسلسلة لكل مشروع (قفل داخل العملية).
// ====================================================================
import { promises as fsp, constants as fsc } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MediaAsset, ProjectAspect, ProjectState } from "@/lib/types";
import { defaultProject } from "@/lib/project";
import { isPathInside } from "@/lib/server/ffmpeg-export";
import { maxUploadBytes } from "@/lib/server/validate";
import { EngineError } from "./errors";
import { parseProject, PROJECT_SCHEMA_VERSION } from "./project-schema";
import { probeMedia, type MediaInfo } from "./media";
import { clipDuration, newId } from "./timeline";

export const HISTORY_LIMIT = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function workspaceRoot(): string {
  return path.resolve(process.env.MONTAGE_WORKSPACE || path.join(process.cwd(), ".montage_ai", "workspace"));
}

/** جذور الاستيراد المسموحة (MONTAGE_MEDIA_ROOTS مفصولة بـ path.delimiter) + inbox دائماً. */
export function mediaRoots(): string[] {
  const extra = (process.env.MONTAGE_MEDIA_ROOTS || "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
  return [path.join(workspaceRoot(), "inbox"), ...extra];
}

export function assertId(value: string, what: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new EngineError("INVALID_INPUT", `${what} غير صالح`, "المعرّفات: أحرف/أرقام/_/- فقط (≤80).");
  }
  return value;
}

function projectsDir(): string {
  return path.join(workspaceRoot(), "projects");
}

export function projectDir(projectId: string): string {
  assertId(projectId, "معرّف المشروع");
  const dir = path.join(projectsDir(), projectId);
  if (!isPathInside(dir, projectsDir())) throw new EngineError("FORBIDDEN_PATH", "مسار مشروع خارج مساحة العمل");
  return dir;
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fsp.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf-8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new EngineError("EXECUTION_FAILED", `ملف تالف: ${path.basename(file)}`, "استعد من نسخة احتياطية أو أنشئ مشروعاً جديداً.");
  }
}

// قفل بسيط لكل مشروع: يسلسل عمليات القراءة-التعديل-الكتابة داخل العملية.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

// ---------------------------------------------------------------- سجل التدقيق
export async function auditLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const file = path.join(workspaceRoot(), "audit.log");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf-8");
  } catch {
    /* سجل التدقيق لا يُسقط العملية */
  }
}

// ---------------------------------------------------------------- المشاريع
export interface ProjectSummary {
  id: string;
  name: string;
  aspect: ProjectAspect;
  durationSeconds: number;
  assets: number;
  clips: number;
  updatedAt: string;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const entries = await fsp.readdir(projectsDir(), { withFileTypes: true }).catch(() => []);
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    try {
      const p = await getProject(e.name);
      out.push({
        id: p.id,
        name: p.name,
        aspect: p.aspect,
        durationSeconds: p.duration,
        assets: p.assets?.length ?? 0,
        clips: p.clips.length,
        updatedAt: new Date(p.updatedAt).toISOString(),
      });
    } catch {
      /* مشروع تالف يُتجاهل في القائمة — get_project يعيد الخطأ مفصلاً */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(projectId: string): Promise<ProjectState> {
  const raw = await readJson<unknown>(path.join(projectDir(projectId), "project.json"));
  if (!raw) throw new EngineError("NOT_FOUND", `المشروع غير موجود: ${projectId}`, "استخدم list_projects.");
  const r = parseProject(raw);
  if (!r.ok) throw new EngineError("EXECUTION_FAILED", `ملف المشروع لا يطابق المخطط: ${r.errors.join("؛ ")}`);
  if (r.project.id !== projectId) throw new EngineError("CONFLICT", "معرّف المشروع داخل الملف لا يطابق المجلد");
  return r.project;
}

async function saveProject(project: ProjectState): Promise<void> {
  const r = parseProject({ ...project, schemaVersion: PROJECT_SCHEMA_VERSION });
  if (!r.ok) throw new EngineError("INVALID_INPUT", `التعديل ينتج مشروعاً غير صالح: ${r.errors.join("؛ ")}`);
  await writeJsonAtomic(path.join(projectDir(project.id), "project.json"), r.project);
}

export async function createProject(opts: {
  name: string;
  aspect?: ProjectAspect;
  resolution?: ProjectState["resolution"];
  fps?: ProjectState["fps"];
}): Promise<ProjectState> {
  const base = defaultProject(opts.name.slice(0, 120) || "مشروع جديد");
  const project: ProjectState = {
    ...base,
    id: `p_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    aspect: opts.aspect ?? base.aspect,
    resolution: opts.resolution ?? "720p",
    fps: opts.fps ?? base.fps,
    quality: "standard",
    assets: [],
    schemaVersion: PROJECT_SCHEMA_VERSION,
  };
  await fsp.mkdir(path.join(projectDir(project.id), "media"), { recursive: true });
  await saveProject(project);
  await writeJsonAtomic(path.join(projectDir(project.id), "history.json"), emptyHistory());
  return project;
}

// ---------------------------------------------------------------- السجل والتراجع
export interface HistoryEntry {
  id: string;
  op: string;
  summary: string;
  at: string;
  /** لقطة المشروع قبل العملية (للتراجع). */
  before: ProjectState;
  /** لقطة بعد العملية (للإعادة). */
  after: ProjectState;
}

interface HistoryFile {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

function emptyHistory(): HistoryFile {
  return { undo: [], redo: [] };
}

async function readHistory(projectId: string): Promise<HistoryFile> {
  return (await readJson<HistoryFile>(path.join(projectDir(projectId), "history.json"))) ?? emptyHistory();
}

/**
 * يطبّق عملية على المشروع بشكل ذري: قراءة → fn (دالة نقية) → تحقق المخطط → كتابة
 * → تسجيل في السجل (قابلة للتراجع). أي استثناء يترك المشروع دون تغيير.
 */
export async function mutateProject<T>(
  projectId: string,
  op: string,
  summary: string,
  fn: (p: ProjectState) => { project: ProjectState; result: T } | Promise<{ project: ProjectState; result: T }>
): Promise<{ project: ProjectState; result: T; historyId: string }> {
  return withLock(projectId, async () => {
    const before = await getProject(projectId);
    const { project: after, result } = await fn(structuredClone(before));
    const next = { ...after, id: before.id, createdAt: before.createdAt, updatedAt: Date.now() };
    await saveProject(next);
    const h = await readHistory(projectId);
    const entry: HistoryEntry = { id: newId("h"), op, summary, at: new Date().toISOString(), before, after: next };
    h.undo.push(entry);
    if (h.undo.length > HISTORY_LIMIT) h.undo.splice(0, h.undo.length - HISTORY_LIMIT);
    h.redo = [];
    await writeJsonAtomic(path.join(projectDir(projectId), "history.json"), h);
    return { project: next, result, historyId: entry.id };
  });
}

export async function undo(projectId: string): Promise<{ project: ProjectState; undone: Omit<HistoryEntry, "before" | "after"> }> {
  return withLock(projectId, async () => {
    const h = await readHistory(projectId);
    const entry = h.undo.pop();
    if (!entry) throw new EngineError("NOTHING_TO_UNDO", "لا توجد عمليات للتراجع عنها");
    await saveProject({ ...entry.before, updatedAt: Date.now() });
    h.redo.push(entry);
    await writeJsonAtomic(path.join(projectDir(projectId), "history.json"), h);
    const { before: _b, after: _a, ...meta } = entry;
    return { project: await getProject(projectId), undone: meta };
  });
}

export async function redo(projectId: string): Promise<{ project: ProjectState; redone: Omit<HistoryEntry, "before" | "after"> }> {
  return withLock(projectId, async () => {
    const h = await readHistory(projectId);
    const entry = h.redo.pop();
    if (!entry) throw new EngineError("NOTHING_TO_UNDO", "لا توجد عمليات لإعادتها");
    await saveProject({ ...entry.after, updatedAt: Date.now() });
    h.undo.push(entry);
    await writeJsonAtomic(path.join(projectDir(projectId), "history.json"), h);
    const { before: _b, after: _a, ...meta } = entry;
    return { project: await getProject(projectId), redone: meta };
  });
}

export async function listHistory(projectId: string) {
  await getProject(projectId);
  const h = await readHistory(projectId);
  const strip = (e: HistoryEntry) => ({ id: e.id, op: e.op, summary: e.summary, at: e.at });
  return { undo: h.undo.map(strip).reverse(), redo: h.redo.map(strip).reverse() };
}

// ---------------------------------------------------------------- الوسائط
/** يحلّ مسار الوسيط المحلي لأصل في المشروع، مع التحقق أنه داخل مجلد media. */
export function assetPath(projectId: string, asset: MediaAsset): string {
  const mediaDir = path.join(projectDir(projectId), "media");
  const p = path.resolve(projectDir(projectId), asset.url);
  if (!isPathInside(p, mediaDir)) throw new EngineError("FORBIDDEN_PATH", "مسار أصل خارج مجلد وسائط المشروع");
  return p;
}

export function findAsset(project: ProjectState, assetId: string): MediaAsset {
  const a = project.assets?.find((x) => x.id === assetId);
  if (!a) throw new EngineError("NOT_FOUND", `الأصل غير موجود: ${assetId}`, "استخدم list_media_assets.");
  return a;
}

/** يتحقق أن مساراً يطلبه وكيل يقع ضمن جذر استيراد مسموح (بعد حل الروابط الرمزية). */
export async function resolveImportPath(input: string): Promise<string> {
  if (typeof input !== "string" || input.length === 0 || input.length > 4096 || input.includes("\0")) {
    throw new EngineError("INVALID_INPUT", "مسار غير صالح");
  }
  const roots = mediaRoots();
  // المسار النسبي يُحلّ نسبةً إلى inbox فقط.
  const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(roots[0], input);
  const forbidden = () =>
    new EngineError(
      "FORBIDDEN_PATH",
      "الملف خارج جذور الاستيراد المسموحة",
      `المسموح: ${roots.join(" , ")} — يضبطها المستخدم عبر MONTAGE_MEDIA_ROOTS.`
    );
  // فحص لفظي أولاً: لا نكشف وجود ملفات خارج الجذور (لا NOT_FOUND لمسار ممنوع).
  if (!roots.some((r) => isPathInside(candidate, r))) throw forbidden();
  let real: string;
  try {
    real = await fsp.realpath(candidate);
  } catch {
    throw new EngineError("NOT_FOUND", "الملف غير موجود", `ضع الملف داخل أحد الجذور المسموحة: ${roots.join(" , ")}`);
  }
  const allowed = await Promise.all(roots.map((r) => fsp.realpath(r).catch(() => null)));
  // ثم فحص المسار الحقيقي: رابط رمزي داخل الجذر يشير للخارج يُرفض.
  if (!allowed.some((r) => r && isPathInside(real, r))) throw forbidden();
  const st = await fsp.stat(real);
  if (!st.isFile()) throw new EngineError("INVALID_INPUT", "المسار ليس ملفاً عادياً");
  if (st.size <= 0) throw new EngineError("INVALID_INPUT", "الملف فارغ");
  if (st.size > maxUploadBytes()) throw new EngineError("LIMIT_EXCEEDED", "حجم الملف يتجاوز MAX_UPLOAD_BYTES");
  await fsp.access(real, fsc.R_OK);
  return real;
}

export async function importMedia(
  projectId: string,
  sourcePath: string,
  opts: { name?: string; signal?: AbortSignal } = {}
): Promise<{ asset: MediaAsset; info: MediaInfo; clipCreated: boolean }> {
  const real = await resolveImportPath(sourcePath);
  const ext = path.extname(real).toLowerCase();
  const type: MediaAsset["type"] | null = VIDEO_EXTS.has(ext) ? "video" : AUDIO_EXTS.has(ext) ? "audio" : IMAGE_EXTS.has(ext) ? "image" : null;
  if (!type) {
    throw new EngineError("UNSUPPORTED", `امتداد غير مدعوم: ${ext || "(بلا امتداد)"}`, `المسموح: ${[...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS].join(" ")}`);
  }
  const info = await probeMedia(real, opts.signal);
  if (type === "video" && !info.video) throw new EngineError("INVALID_INPUT", "الملف لا يحتوي مسار فيديو");
  if (type === "audio" && !info.audio) throw new EngineError("INVALID_INPUT", "الملف لا يحتوي مسار صوت");
  if (type !== "image" && info.durationSeconds <= 0) throw new EngineError("INVALID_INPUT", "مدة الوسيط غير معروفة");

  const assetId = newId("asset");
  const rel = path.join("media", `${assetId}${ext}`);
  const dest = path.join(projectDir(projectId), rel);
  await getProject(projectId); // تأكيد وجود المشروع قبل النسخ
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(real, dest, fsc.COPYFILE_EXCL);

  const asset: MediaAsset = {
    id: assetId,
    type,
    name: (opts.name || path.basename(real)).slice(0, 200),
    url: rel.split(path.sep).join("/"),
    duration: info.durationSeconds,
    meta: {
      width: info.video?.width ?? 0,
      height: info.video?.height ?? 0,
      fps: info.video?.fps ?? 0,
      hasAudio: info.audio ? 1 : 0,
      sizeBytes: info.sizeBytes ?? 0,
    },
  };

  try {
    const { result } = await mutateProject(projectId, "import_media", `استيراد ${asset.name}`, (p) => {
      const assets = [...(p.assets ?? []), asset];
      let clipCreated = false;
      let clips = p.clips;
      let duration = p.duration;
      const hasPrimary = (p.assets ?? []).some((a) => a.type === "video");
      if (type === "video" && !hasPrimary && p.clips.length === 0) {
        // أول فيديو: يصبح المصدر الأساسي بمقطع واحد يغطي مدته كاملة.
        duration = info.durationSeconds;
        clips = [
          {
            id: newId("clip"),
            assetId,
            trackId: "t_video",
            start: 0,
            duration: info.durationSeconds,
            inPoint: 0,
            outPoint: info.durationSeconds,
            effects: [],
            volume: 1,
            speed: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
            smartZoom: false,
            colorFilter: "none",
          },
        ];
        clips[0].duration = clipDuration(clips[0]);
        clipCreated = true;
      }
      return { project: { ...p, assets, clips, duration }, result: clipCreated };
    });
    return { asset, info, clipCreated: result };
  } catch (e) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw e;
  }
}

/** الأصل الأساسي (أول فيديو) — مصدر التصدير الوحيد المدعوم حالياً. */
export function primaryVideoAsset(project: ProjectState): MediaAsset {
  const a = project.assets?.find((x) => x.type === "video");
  if (!a) throw new EngineError("CONFLICT", "المشروع بلا فيديو", "استورد فيديو أولاً عبر import_media.");
  return a;
}
