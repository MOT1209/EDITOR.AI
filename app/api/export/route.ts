import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { aiJobs } from "@/lib/mockAi";
import type { ProjectState } from "@/lib/types";
import {
  EXPORT_DIR,
  UPLOAD_DIR,
  ensureExportDir,
  hasFfmpeg,
  isPathInside,
  runExport,
  writeJobStatus,
} from "@/lib/server/ffmpeg-export";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sourcePath = body?.sourcePath;
  const project = body?.project as ProjectState | undefined;
  const videoStabilize = Boolean(body?.videoStabilize);
  const colorGrading =
    typeof body?.colorGrading === "number" ? body.colorGrading : 0.5;

  if (typeof sourcePath !== "string" || !isPathInside(sourcePath, UPLOAD_DIR)) {
    return NextResponse.json({ error: "مسار الفيديو غير صالح. ارفع الفيديو أولاً." }, { status: 400 });
  }
  if (!project) {
    return NextResponse.json({ error: "بيانات المشروع مطلوبة" }, { status: 400 });
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

  runExport({
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
      const message = err instanceof Error ? err.message : "فشل التصدير";
      aiJobs.fail(job.id, message);
      await writeJobStatus({ id: job.id, status: "failed", progress: 0, message });
    });

  return NextResponse.json({ ok: true, job });
}
