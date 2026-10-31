import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { aiJobs } from "@/lib/mockAi";
import { parseProject } from "@/lib/engine/project-schema";
import { workspaceRoot } from "@/lib/engine/store";
import {
  ExportCancelledError,
  EXPORT_DIR,
  UPLOAD_DIR,
  ensureExportDir,
  hasFfmpeg,
  isPathInside,
  runExport,
  writeJobStatus,
} from "@/lib/server/ffmpeg-export";
import { checkExportable } from "@/lib/engine/export-guard";
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
  const sourcePath = body?.sourcePath;
  const parsed = body?.project ? parseProject(body.project) : null;
  const videoStabilize = Boolean(body?.videoStabilize);
  const colorGrading =
    typeof body?.colorGrading === "number" ? body.colorGrading : 0.5;

  // المصدر: مرفوعات المتصفح، أو وسائط مشروع في مساحة عمل الخادم (مشاريع MCP).
  const sourceOk =
    typeof sourcePath === "string" &&
    (isPathInside(sourcePath, UPLOAD_DIR) || isPathInside(sourcePath, path.join(workspaceRoot(), "projects")));
  if (!sourceOk) {
    return NextResponse.json({ error: "مسار الفيديو غير صالح. ارفع الفيديو أولاً." }, { status: 400 });
  }
  if (!parsed) {
    return NextResponse.json({ error: "بيانات المشروع مطلوبة" }, { status: 400 });
  }
  if (!parsed.ok) {
    return NextResponse.json({ error: "بيانات المشروع غير صالحة", details: parsed.errors }, { status: 400 });
  }
  const project = parsed.project;
  const guard = checkExportable(project, { acknowledgeAudioLoss: body?.acknowledgeAudioLoss === true });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code, details: guard.details }, { status: 409 });
  }
  if (!hasFfmpeg()) {
    return NextResponse.json(
      { error: "ffmpeg غير مثبت على السيرفر. ثبّته ثم أعد المحاولة." },
      { status: 503 }
    );
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
    project,
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
      await writeJobStatus({ id: job.id, status: cancelled ? "cancelled" : "failed", progress: 0, message });
    })
    .finally(() => releaseExportController(job.id));

  return NextResponse.json({ ok: true, job });
}
