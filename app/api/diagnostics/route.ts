/**
 * لوحة تشخيص المسار (Pipeline Diagnostics) — تعرض أدلة `.montage_ai/pipeline/<job_id>/`
 * التي يكتبها CeoOrchestrator (manifest.json + مُخرَج كل مرحلة) دون إعادة تشغيل المسار.
 *
 * GET /api/diagnostics                → قائمة كل المسارات (ملخص من manifest.json لكل واحد)
 * GET /api/diagnostics?job=<jobId>     → تفصيل مسار واحد (manifest + كل مُخرَجات المراحل)
 *
 * للقراءة فقط — لا يُعدّل أو يحذف أي شيء تحت .montage_ai/pipeline.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fsp, existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIPELINE_DIR = path.join(process.cwd(), ".montage_ai", "pipeline");
const JOB_ID_RE = /^job_\d+$/;
const STAGE_ORDER = ["analyst", "director", "critic", "audio", "render"] as const;

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** ملخص مسار واحد من manifest.json؛ لو غاب (انقطع التشغيل) يُبنى ملخص أدنى من الملفات الموجودة. */
async function summarizeJob(jobId: string): Promise<Record<string, unknown>> {
  const jobDir = path.join(PIPELINE_DIR, jobId);
  const manifest = (await readJson(path.join(jobDir, "manifest.json"))) as Record<string, unknown> | null;
  if (manifest) {
    return { ...manifest, job_id: jobId };
  }
  const stages: Record<string, boolean> = {};
  for (const stage of STAGE_ORDER) {
    stages[stage] = existsSync(path.join(jobDir, `${stage}.json`));
  }
  return {
    job_id: jobId,
    status: "interrupted",
    source_path: "",
    request: "",
    created_at: null,
    duration_seconds: 0,
    stages,
    errors: ["لا يوجد manifest.json — يبدو أن التشغيل انقطع قبل الاكتمال"],
    warnings: [],
  };
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");

  if (jobId) {
    if (!JOB_ID_RE.test(jobId)) {
      return NextResponse.json({ error: "jobId غير صالح" }, { status: 400 });
    }
    const jobDir = path.join(PIPELINE_DIR, jobId);
    if (!existsSync(jobDir)) {
      return NextResponse.json({ error: "المسار غير موجود" }, { status: 404 });
    }
    const [manifest, analyst, director, critic, audio, render] = await Promise.all([
      summarizeJob(jobId),
      readJson(path.join(jobDir, "analyst.json")),
      readJson(path.join(jobDir, "director.json")),
      readJson(path.join(jobDir, "critic.json")),
      readJson(path.join(jobDir, "audio.json")),
      readJson(path.join(jobDir, "render.json")),
    ]);
    return NextResponse.json({ manifest, analyst, director, critic, audio, render });
  }

  if (!existsSync(PIPELINE_DIR)) {
    return NextResponse.json({ jobs: [] });
  }
  const entries = await fsp.readdir(PIPELINE_DIR, { withFileTypes: true });
  const jobIds = entries
    .filter((e) => e.isDirectory() && JOB_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // الأحدث أولاً (job_<epoch_ms> قابل للمقارنة نصياً)

  const jobs = await Promise.all(jobIds.map(summarizeJob));
  return NextResponse.json({ jobs });
}
