import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import { aiJobs } from "@/lib/mockAi";
import { parseProject } from "@/lib/engine/project-schema";
import { workspaceRoot } from "@/lib/engine/store";
import {
  ExportCancelledError,
  RenderPlanError,
  EXPORT_DIR,
  UPLOAD_DIR,
  ensureExportDir,
  hasFfmpeg,
  isPathInside,
  runExport,
  type ExportSource,
  writeJobStatus,
} from "@/lib/server/ffmpeg-export";
import { probeMedia } from "@/lib/engine/media";
import { checkExportable } from "@/lib/engine/export-guard";
import { resolveMediaRef, resolveVideoRef } from "@/lib/server/media-ref";
import { buildSourceMap } from "@/lib/server/render-sources";
import { previewSize } from "@/lib/engine/jobs";
import { timelineDuration } from "@/lib/engine/timeline";
import { cancelExport, registerExportController, releaseExportController } from "@/lib/server/export-jobs";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** DELETE /api/export?id=<jobId> → إلغاء تصدير جارٍ (يقتل ffmpeg ويحذف المخرَج الجزئي). */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^job_\d+_\d+$/.test(id)) {
    return NextResponse.json({ error: "معرّف مهمة غير صالح" }, { status: 400 });
  }
  const cancelled = cancelExport(id);
  if (!cancelled) {
    return NextResponse.json({ error: "لا توجد مهمة تصدير جارية بهذا المعرّف" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
    const parsed = body?.project ? parseProject(body.project) : null;
  const videoStabilize = Boolean(body?.videoStabilize);
  const colorGrading =
    typeof body?.colorGrading === "number" ? body.colorGrading : 0.5;

  // المصدر: مرجع معتمد (upload:/project:) لا مسار — يُحلّ على الخادم حصراً (T-03).
  // `sources` ([{assetId, ref}]) يتيح تصدير عدة ملفات؛ `sourceRef` هو المصدر الأساسي، وبغيابه يُستعمل أول مصدر صالح.
  let sourcePath = await resolveVideoRef(body?.sourceRef);
  if (!sourcePath && Array.isArray(body?.sources)) {
    for (const s of (body.sources as { ref?: unknown }[]).slice(0, 64)) {
      sourcePath = await resolveVideoRef(s?.ref);
      if (sourcePath) break;
    }
  }
  if (!sourcePath) {
    return NextResponse.json({ error: "مرجع الفيديو غير صالح أو غير موجود. ارفع الفيديو أولاً.", code: "INVALID_INPUT" }, { status: 400 });
  }
  if (!parsed) {
    return NextResponse.json({ error: "بيانات المشروع مطلوبة" }, { status: 400 });
  }
  if (!parsed.ok) {
    return NextResponse.json({ error: "بيانات المشروع غير صالحة", details: parsed.errors }, { status: 400 });
  }
  // معاينة مرندرة: نفس خطة التصدير بنافذة قصيرة ودقة منخفضة (≤60s) — المرجع الحاكم لمطابقة المعاينة.
  let range: { start: number; end: number } | undefined;
  let size: [number, number] | undefined;
  if (body?.preview !== undefined) {
    const a = Number(body.preview?.start);
    const b = Number(body.preview?.end);
    const total = timelineDuration(parsed.project);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b - a > 60) {
      return NextResponse.json({ error: "نافذة المعاينة غير صالحة (0 ≤ start < end، حتى 60 ثانية)", code: "INVALID_INPUT" }, { status: 400 });
    }
    range = { start: a, end: Math.min(b, Math.max(total, a + 0.1)) };
    size = previewSize(parsed.project.aspect);
  }
  const project = range ? { ...parsed.project, format: "mp4" as const } : parsed.project;
  // مصادر فيديو إضافية (T-02): [{assetId, ref}] — كل ref يُحلّ على الخادم ويُفحص بـ ffprobe.
  const extraSources: ExportSource[] = [];
  const refs: Record<string, string> = {};
  if (body?.sources !== undefined) {
    if (!Array.isArray(body.sources) || body.sources.length > 64) {
      return NextResponse.json({ error: "sources يجب أن تكون مصفوفة (≤64)", code: "INVALID_INPUT" }, { status: 400 });
    }
    for (const s of body.sources as { assetId?: unknown; ref?: unknown }[]) {
      if (typeof s?.assetId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(s.assetId)) {
        return NextResponse.json({ error: "sources[].assetId غير صالح", code: "INVALID_INPUT" }, { status: 400 });
      }
      const r = await resolveMediaRef(s.ref);
      if (!r) return NextResponse.json({ error: `مرجع مصدر الأصل «${s.assetId}» غير صالح أو غير موجود`, code: "INVALID_INPUT" }, { status: 400 });
      if (r.kind === "audio") continue; // أصول الصوت تدخل عبر مقاطع الصوت (ref لكل مقطع) لا عبر sources
      refs[s.assetId] = s.ref as string;
      if (r.kind !== "video") continue; // الصور تُحلّ في خريطة المصادر للمركِّب
      try {
        const info = await probeMedia(r.path);
        extraSources.push({ assetId: s.assetId, path: r.path, hasAudio: !!info.audio });
      } catch {
        return NextResponse.json({ error: `تعذّر فحص مصدر الأصل «${s.assetId}»`, code: "INVALID_INPUT" }, { status: 400 });
      }
    }
  }
  // خريطة المصادر المتحقَّقة للمركِّب (فيديو/صورة/صوت) — الأصول المرفوعة بـ /api/assets/upload (upload:) تُقبل أيضاً.
  const { map: sources, unresolved } = await buildSourceMap(project, { refs, primaryPath: sourcePath });
  const resolvedAudio = new Set(Object.keys(sources).filter((k) => k.startsWith("audio:")).map((k) => k.slice(6)));
  const guard = checkExportable(project, {
    acknowledgeAudioLoss: body?.acknowledgeAudioLoss === true,
    supportedAssetIds: new Set([...extraSources.map((s) => s.assetId), ...Object.keys(sources)]),
    resolvedAudio,
  });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code, details: guard.details }, { status: 409 });
  }
  if (!hasFfmpeg()) {
    return NextResponse.json(
      { error: "ffmpeg غير مثبت على السيرفر. ثبّته ثم أعد المحاولة." },
      { status: 503 }
    );
  }

  // صوت الواجهة المرفوع كأصل خادم (T-13): يُمزج في المخرَج؛ المسارات المكتومة تُتخطّى.
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  const audioInputs: { path: string; start: number; volume: number }[] = [];
  for (const a of project.audioClips) {
    if (muted.has(a.trackId) || !a.ref) continue;
    const r = await resolveMediaRef(a.ref); // audio: (/api/assets/audio) أو upload: (/api/assets/upload) أو project:
    if (!r || r.kind !== "audio" || !existsSync(r.path)) {
      return NextResponse.json({ error: `أصل الصوت «${a.name || a.id}» غير موجود على الخادم — أعد رفعه`, code: "INVALID_INPUT" }, { status: 400 });
    }
    audioInputs.push({ path: r.path, start: a.start, volume: a.volume });
  }

  await ensureExportDir();
  const job = aiJobs.create("export", "تصدير الفيديو");
  const outputPath = path.join(EXPORT_DIR, `${job.id}.${project.format}`);
  await writeJobStatus({ id: job.id, status: "running", progress: 0 });
  const controller = registerExportController(job.id);

  runExport({
    signal: controller.signal,
    sourcePath,
    outputPath,
    audioInputs,
    extraSources,
    project,
    sources,
    range,
    size,
    encoderOverride: range ? { preset: "ultrafast", crf: 30 } : undefined,
    allowMissingAudio: body?.acknowledgeAudioLoss === true,
    videoStabilize,
    colorGrading,
    onProgress: (fraction) => {
      const progress = Math.round(fraction * 100);
      aiJobs.update(job.id, { progress });
      void writeJobStatus({ id: job.id, status: "running", progress });
    },
  })
    .then(async ({ size }) => {
      aiJobs.complete(job.id, { path: outputPath, size, format: project.format });
      await writeJobStatus({
        id: job.id,
        status: "completed",
        progress: 100,
        result: { path: outputPath, size, format: project.format },
      });
    })
    .catch(async (err: unknown) => {
      const cancelled = err instanceof ExportCancelledError;
      const message = err instanceof Error ? err.message : "فشل التصدير";
      aiJobs.fail(job.id, message);
      await writeJobStatus({
        id: job.id,
        status: cancelled ? "cancelled" : "failed",
        progress: 0,
        message,
        ...(err instanceof RenderPlanError ? { issues: err.issues } : {}),
      });
    })
    .finally(() => releaseExportController(job.id));

  return NextResponse.json({ ok: true, job, ...(unresolved.length ? { warnings: [`مصادر لم تُحلّ: ${unresolved.join(", ")}`] } : {}) });
}
