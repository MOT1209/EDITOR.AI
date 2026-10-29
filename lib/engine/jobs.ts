// ====================================================================
// مهام الرندر (معاينة/تصدير) — حالة دائمة على القرص + إلغاء + حدود تزامن.
//
// قاعدة الصدق: الحالة "completed" تُكتب فقط إذا وُجد ملف المخرَج **ونجحت**
// مراجعة ما بعد الرندر (reviewRender). المخرَج الموجود الذي فشل المراجعة
// يُعلَّم "failed_validation" مع الأسباب — لا يُبلَّغ عنه كنجاح.
// ====================================================================
import { promises as fsp } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { ExportCancelledError, runExport, isPathInside } from "@/lib/server/ffmpeg-export";
import type { ProjectState } from "@/lib/types";
import { EngineError } from "./errors";
import { reviewRender, type RenderReview } from "./media";
import { assertId, assetPath, auditLog, getProject, primaryVideoAsset, projectDir } from "./store";
import { timelineDuration } from "./timeline";

export type JobKind = "preview" | "export";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "failed_validation" | "cancelled";

export interface RenderJob {
  id: string;
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  createdAt: string;
  finishedAt?: string;
  /** اسم ملف المخرَج داخل مجلد المهمة (لا مسار مطلق في الحالة المعروضة). */
  outputFile?: string;
  expected: { durationSeconds: number; width?: number; height?: number; hasAudio: boolean };
  range?: { start: number; end: number };
  review?: RenderReview;
  warnings: string[];
  error?: string;
}

const MAX_ACTIVE_GLOBAL = Number(process.env.MONTAGE_MAX_RENDER_JOBS || 2);
const active = new Map<string, AbortController>();
const activeByProject = new Map<string, Set<string>>();

function jobDir(projectId: string, jobId: string): string {
  assertId(jobId, "معرّف المهمة");
  const dir = path.join(projectDir(projectId), "renders", jobId);
  if (!isPathInside(dir, path.join(projectDir(projectId), "renders"))) throw new EngineError("FORBIDDEN_PATH", "مسار مهمة غير صالح");
  return dir;
}

async function writeStatus(job: RenderJob): Promise<void> {
  const file = path.join(jobDir(job.projectId, job.id), "status.json");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(job, null, 2), "utf-8");
  await fsp.rename(tmp, file);
}

export async function getJob(projectId: string, jobId: string): Promise<RenderJob> {
  try {
    const job = JSON.parse(await fsp.readFile(path.join(jobDir(projectId, jobId), "status.json"), "utf-8")) as RenderJob;
    // مهمة "running" على القرص لكن ليست في هذه العملية = توقفت العملية السابقة (إعادة تشغيل).
    if ((job.status === "running" || job.status === "queued") && !active.has(jobId)) {
      job.status = "failed";
      job.error = "توقفت عملية الخادم أثناء الرندر — أعد التشغيل";
    }
    return job;
  } catch (e) {
    if (e instanceof EngineError) throw e;
    throw new EngineError("NOT_FOUND", `مهمة الرندر غير موجودة: ${jobId}`);
  }
}

export function jobOutputPath(job: RenderJob): string | null {
  if (!job.outputFile) return null;
  return path.join(jobDir(job.projectId, job.id), job.outputFile);
}

export async function listJobs(projectId: string): Promise<RenderJob[]> {
  const dir = path.join(projectDir(projectId), "renders");
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const jobs: RenderJob[] = [];
  for (const n of names) {
    try {
      jobs.push(await getJob(projectId, n));
    } catch {
      /* تجاهل المجلدات غير المكتملة */
    }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** صوت المشروع الإضافي القابل للتصدير: فقط ما يشير لأصل صوت داخل مجلد media. */
function resolveAudioInputs(project: ProjectState): { inputs: { path: string; start: number; volume: number }[]; warnings: string[] } {
  const warnings: string[] = [];
  const inputs: { path: string; start: number; volume: number }[] = [];
  const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  for (const a of project.audioClips) {
    if (mutedTracks.has(a.trackId)) continue;
    const asset = project.assets?.find((x) => x.url === a.url && (x.type === "audio" || x.type === "music" || x.type === "sfx"));
    if (!asset) {
      warnings.push(`المقطع الصوتي «${a.name}» ليس ملفاً على الخادم (مثل blob: من المتصفح) — لن يُضمَّن في المخرَج`);
      continue;
    }
    inputs.push({ path: assetPath(project.id, asset), start: a.start, volume: a.volume });
  }
  return { inputs, warnings };
}

export interface StartRenderOptions {
  kind: JobKind;
  range?: { start: number; end: number };
  timeoutMs?: number;
}

const PREVIEW_MAX_SECONDS = 60;

export async function startRender(projectId: string, opts: StartRenderOptions): Promise<RenderJob> {
  const project = await getProject(projectId);
  const primary = primaryVideoAsset(project);
  const foreign = project.clips.filter((c) => c.kind !== "image" && c.assetId !== primary.id && c.assetId !== "main");
  if (foreign.length > 0) {
    throw new EngineError("UNSUPPORTED", "التصدير يدعم مصدر فيديو واحداً — توجد مقاطع من أصول أخرى", `احذف المقاطع: ${foreign.map((c) => c.id).join(", ")}`);
  }
  const total = timelineDuration(project);
  let range = opts.range;
  if (opts.kind === "preview") {
    const start = range?.start ?? 0;
    const end = Math.min(range?.end ?? start + 10, total);
    if (!(end > start) || start < 0) throw new EngineError("OUT_OF_RANGE", `نافذة المعاينة غير صالحة (المدة الكلية ${total}s)`);
    if (end - start > PREVIEW_MAX_SECONDS) throw new EngineError("LIMIT_EXCEEDED", `المعاينة بحد أقصى ${PREVIEW_MAX_SECONDS}s`);
    range = { start, end };
  } else if (range) {
    throw new EngineError("INVALID_INPUT", "التصدير يشمل التايملاين كاملاً — استخدم generate_preview لنافذة");
  }

  const projectActive = activeByProject.get(projectId) ?? new Set<string>();
  if (opts.kind === "export" && [...projectActive].length > 0) {
    throw new EngineError("CONFLICT", "توجد مهمة رندر جارية لهذا المشروع", "انتظر انتهاءها أو ألغِها عبر cancel_render.");
  }
  if (active.size >= MAX_ACTIVE_GLOBAL) {
    throw new EngineError("LIMIT_EXCEEDED", `الحد الأقصى للمهام المتزامنة (${MAX_ACTIVE_GLOBAL})`, "أعد المحاولة بعد انتهاء مهمة.");
  }

  const source = assetPath(projectId, primary);
  const { inputs, warnings } = resolveAudioInputs(project);
  const sourceHasAudio = Number(primary.meta?.hasAudio ?? 1) === 1;
  const id = `r_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const ext = opts.kind === "preview" ? "mp4" : project.format;
  const outputFile = `output.${ext}`;
  // المعاينة: 360 سطراً تقريباً بنفس النسبة، ultrafast.
  const size: [number, number] | undefined =
    opts.kind === "preview" ? previewSize(project.aspect) : undefined;
  const job: RenderJob = {
    id,
    projectId,
    kind: opts.kind,
    status: "running",
    progress: 0,
    createdAt: new Date().toISOString(),
    outputFile,
    expected: {
      durationSeconds: range ? Math.round((range.end - range.start) * 1000) / 1000 : total,
      // مصدر بلا صوت يُرندر بصمت مولَّد — لا نطالب المراجعة بصوت مسموع حينها.
      hasAudio: sourceHasAudio || inputs.length > 0,
      ...(size ? { width: size[0], height: size[1] } : {}),
    },
    range,
    warnings,
  };
  const controller = new AbortController();
  active.set(id, controller);
  projectActive.add(id);
  activeByProject.set(projectId, projectActive);
  await writeStatus(job);

  const outPath = path.join(jobDir(projectId, id), outputFile);
  const previewProject: ProjectState =
    opts.kind === "preview" ? { ...project, format: "mp4", fps: 24 } : project;
  let lastWrite = 0;

  const done = (async () => {
    try {
      const r = await runExport({
        sourcePath: source,
        outputPath: outPath,
        project: previewProject,
        audioInputs: inputs,
        range,
        size,
        sourceHasAudio,
        encoderOverride: opts.kind === "preview" ? { preset: "ultrafast", crf: 30 } : undefined,
        signal: controller.signal,
        timeoutMs: opts.timeoutMs,
        onProgress: (f) => {
          job.progress = Math.round(f * 100);
          const now = Date.now();
          if (now - lastWrite > 1000) {
            lastWrite = now;
            void writeStatus(job).catch(() => {});
          }
        },
      });
      if (!size) {
        job.expected.width = r.width;
        job.expected.height = r.height;
      }
      job.review = await reviewRender(outPath, { ...job.expected, expectAudio: job.expected.hasAudio });
      job.status = job.review.passed ? "completed" : "failed_validation";
      job.progress = 100;
      if (!job.review.passed) job.error = job.review.issues.join("؛ ");
    } catch (e) {
      if (e instanceof ExportCancelledError) {
        job.status = "cancelled";
        job.error = "أُلغيت بطلب المستخدم";
      } else {
        job.status = "failed";
        job.error = (e as Error).message.slice(0, 1200);
      }
      job.outputFile = undefined;
    } finally {
      job.finishedAt = new Date().toISOString();
      active.delete(id);
      projectActive.delete(id);
      await writeStatus(job).catch(() => {});
      await auditLog({ event: "render_finished", projectId, jobId: id, kind: opts.kind, status: job.status });
    }
  })();
  pending.set(id, done);
  void done.finally(() => pending.delete(id));
  return job;
}

const pending = new Map<string, Promise<void>>();

/** ينتظر انتهاء مهمة (للاختبارات/الأدوات المتزامنة) حتى مهلة. */
export async function waitForJob(projectId: string, jobId: string, timeoutMs: number): Promise<RenderJob> {
  const p = pending.get(jobId);
  if (p) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([p, new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
  }
  return getJob(projectId, jobId);
}

export async function cancelJob(projectId: string, jobId: string): Promise<RenderJob> {
  const job = await getJob(projectId, jobId);
  const c = active.get(jobId);
  if (!c) {
    throw new EngineError("CONFLICT", `المهمة ليست جارية (الحالة: ${job.status})`);
  }
  c.abort();
  return waitForJob(projectId, jobId, 15_000);
}

export async function revalidateJob(projectId: string, jobId: string): Promise<RenderJob> {
  const job = await getJob(projectId, jobId);
  const out = jobOutputPath(job);
  if (!out) throw new EngineError("CONFLICT", `لا مخرَج لهذه المهمة (الحالة: ${job.status})`);
  job.review = await reviewRender(out, { ...job.expected, expectAudio: job.expected.hasAudio });
  if (job.status === "completed" || job.status === "failed_validation") {
    job.status = job.review.passed ? "completed" : "failed_validation";
    job.error = job.review.passed ? undefined : job.review.issues.join("؛ ");
  }
  await writeStatus(job);
  return job;
}

function previewSize(aspect: ProjectState["aspect"]): [number, number] {
  switch (aspect) {
    case "9:16":
      return [360, 640];
    case "1:1":
      return [360, 360];
    case "4:5":
      return [360, 450];
    default:
      return [640, 360];
  }
}
