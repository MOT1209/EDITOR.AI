/**
 * المسار الكامل (Pipeline) — يشغّل مسار المونتاج متعدد الوكلاء في Python
 * (CEO → Analyst → Director → Critic → Audio → Render) على الفيديو المرفوع
 * ويعيد النتيجة كاملة: تقرير التحليل + خطة EDL + نقد + خطة صوت + الرندر الفعلي.
 *
 * POST /api/agents/pipeline  → يشغّل المسار ويعيد PipelineResult (JSON)
 * GET  /api/agents/pipeline?job=<jobId> → يقدّم الفيديو النهائي final.mp4
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { promises as fsp, existsSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 دقائق — الرندر الفعلي يأخذ وقتاً

const PIPELINE_DIR = path.join(process.cwd(), ".montage_ai", "pipeline");
const UPLOAD_DIR = path.join(process.cwd(), ".montage_ai", "uploads");
const TIMEOUT_MS = 280_000; // أقل بقليل من maxDuration لقتل العملية بأمان

function resolvePython(): string {
  const candidates = [
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), ".venv", "bin", "python"),
    "python",
  ];
  return candidates.find((c) => existsSync(c)) || "python";
}

/** يشغّل سطر أوامر Python ويعيد رمز الخروج */
async function runPython(args: string[]): Promise<number> {
  return new Promise<number>((resolveExit, rejectExit) => {
    const proc = spawn(resolvePython(), args, { cwd: process.cwd() });
    const killer = setTimeout(() => {
      console.error("[pipeline] انتهت المهلة — قتل العملية");
      proc.kill();
    }, TIMEOUT_MS);
    proc.stdout.on("data", (d: Buffer) => console.log(`[pipeline] ${d.toString().trimEnd()}`));
    proc.stderr.on("data", (d: Buffer) => console.error(`[pipeline] ${d.toString().trimEnd()}`));
    proc.on("error", (err) => {
      clearTimeout(killer);
      rejectExit(err);
    });
    proc.on("close", (code) => {
      clearTimeout(killer);
      resolveExit(code ?? -1);
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const phase = String(form.get("phase") || "plan"); // plan | render
    const jobId = String(form.get("jobId") || "");

    // المرحلة 2: الرندر الفعلي لخطة محفوظة (بعد تأكيد المستخدم)
    if (phase === "render") {
      if (!/^job_\d+$/.test(jobId)) {
        return NextResponse.json({ error: "jobId غير صالح" }, { status: 400 });
      }
      const resumeDir = path.join(PIPELINE_DIR, jobId);
      const jsonOut = path.join(PIPELINE_DIR, `render_${jobId}.json`);
      const exitCode = await runPython([
        "-m", "src.main",
        "--resume", resumeDir,
        "--json-out", jsonOut,
      ]);
      if (!existsSync(jsonOut)) {
        return NextResponse.json(
          { error: `الرندر فشل (رمز ${exitCode})` },
          { status: 500 }
        );
      }
      const result = JSON.parse(await fsp.readFile(jsonOut, "utf-8"));
      const videoUrl = result?.render?.rendered
        ? `/api/agents/pipeline?job=${jobId}`
        : null;
      return NextResponse.json({ ...result, jobId, videoUrl, previewStats: result?.preview_stats || null });
    }

    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "ملف الفيديو مطلوب" }, { status: 400 });
    }
    const request = String(form.get("request") || "").slice(0, 800);
    const language = String(form.get("language") || "ar").slice(0, 10);
    const mood = String(form.get("mood") || "").slice(0, 20);
    const aspect = ["9:16", "16:9", "1:1"].includes(String(form.get("aspect") || ""))
      ? String(form.get("aspect"))
      : "9:16";
    const noBroll = form.get("noBroll") === "true" || form.get("noBroll") === "1";
    const demo = form.get("demo") === "true" || form.get("demo") === "1";

    // 1) احفظ الملف المرفوع
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const id = uuid();
    const ext = path.extname(file.name) || ".mp4";
    const filePath = path.join(UPLOAD_DIR, `${id}${ext}`);
    await fsp.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    // 2) شغّل مسار Python مع كتابة النتيجة JSON
    const jsonOut = path.join(PIPELINE_DIR, `req_${id}.json`);
    const args = [
      "-m", "src.main", filePath,
      "--request", request || "فيديو قصير جذاب مع ترجمة",
      "--language", language,
      "--aspect", aspect,
      "--pipeline-dir", PIPELINE_DIR,
      "--json-out", jsonOut,
      "--plan-only",
    ];
    if (mood) args.push("--mood", mood);
    if (noBroll) args.push("--no-broll");
    if (demo) args.push("--demo");

    const exitCode = await runPython(args);

    // 3) اقرأ النتيجة وأعدها
    if (!existsSync(jsonOut)) {
      return NextResponse.json(
        { error: `المسار فشل (رمز ${exitCode}) — لا نتيجة JSON` },
        { status: 500 }
      );
    }
    const result = JSON.parse(await fsp.readFile(jsonOut, "utf-8"));
    // PipelineResult يسلسل بأسماء snake_case (artifacts_dir/job_id/preview_stats)
    const finalJobId = String(result?.artifacts_dir || "").match(/job_\d+/)?.[0] || "";
    return NextResponse.json({
      ...result,
      jobId: finalJobId,
      planReady: finalJobId.length > 0,
      previewStats: result?.preview_stats || null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** يقدّم الفيديو النهائي (final.mp4) للمعرّف الوظيفي job=... */
export async function GET(req: NextRequest) {
  const job = new URL(req.url).searchParams.get("job");
  if (!job || !/^job_\d+$/.test(job)) {
    return NextResponse.json({ error: "معرّف وظيفة غير صالح" }, { status: 400 });
  }
  const videoPath = path.join(PIPELINE_DIR, job, "exports", "final.mp4");
  if (!existsSync(videoPath)) {
    return NextResponse.json({ error: "الفيديو غير جاهز بعد" }, { status: 404 });
  }
  const data = await fsp.readFile(videoPath);
  return new NextResponse(data, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename="${job}.mp4"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
