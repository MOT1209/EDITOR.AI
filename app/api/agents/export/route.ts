/**
 * تصدير خطة EDL إلى برنامج مونتاج عبر auto-editor (NLE).
 *
 * POST /api/agents/export
 *   body: { jobId, format, plan }
 *     - jobId:  معرّف المهمة (job_*) — يُقرأ منه المصدر من manifest.json.
 *     - format: premiere | resolve | shotcut | kdenlive | final_cut_pro
 *     - plan:   خطة EdlPlan (camelCase) كما تُعرض في المحرّر.
 *   النجاح → ملف التصدير (XML) يُنزَّل.
 *   غياب auto-editor → 503 برسالة توجه لتشغيل scripts/install-auto-editor.py.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { promises as fsp, existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

const PIPELINE_DIR = path.join(process.cwd(), ".montage_ai", "pipeline");
const EXPORT_DIR = path.join(PIPELINE_DIR, "exports_nle");
const TIMEOUT_MS = 280_000;

const FORMATS = new Set([
  "premiere",
  "resolve",
  "shotcut",
  "kdenlive",
  "final_cut_pro",
]);

function resolvePython(): string {
  const candidates = [
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), ".venv", "bin", "python"),
    "python",
  ];
  return candidates.find((c) => existsSync(c)) || "python";
}

function runPython(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolveExit) => {
    const proc = spawn(resolvePython(), args, { cwd: process.cwd() });
    const killer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", () => {
      clearTimeout(killer);
      resolveExit({ code: -1, stderr: `تعذّر تشغيل Python: ${args.join(" ")}` });
    });
    proc.on("close", (code) => {
      clearTimeout(killer);
      resolveExit({ code: code ?? -1, stderr });
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const jobId = String(body?.jobId || "");
    const format = String(body?.format || "");
    const plan = body?.plan;

    if (!/^job_\d+$/.test(jobId)) {
      return NextResponse.json({ error: "jobId غير صالح" }, { status: 400 });
    }
    if (!FORMATS.has(format)) {
      return NextResponse.json(
        { error: `تنسيق غير مدعوم: ${format}` },
        { status: 400 }
      );
    }
    if (!plan || typeof plan !== "object") {
      return NextResponse.json({ error: "خطة EDL مطلوبة" }, { status: 400 });
    }

    // المصدر من manifest.json الخاص بالمهمة
    const manifestPath = path.join(PIPELINE_DIR, jobId, "manifest.json");
    if (!existsSync(manifestPath)) {
      return NextResponse.json(
        { error: "manifest غير موجود لهذه المهمة" },
        { status: 404 }
      );
    }
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
    const source = manifest?.source_path;
    if (!source || !existsSync(source)) {
      return NextResponse.json(
        { error: "ملف المصدر غير موجود على القرص" },
        { status: 404 }
      );
    }

    await fsp.mkdir(EXPORT_DIR, { recursive: true });
    const planJson = path.join(EXPORT_DIR, `plan_${jobId}.json`);
    const outFile = path.join(EXPORT_DIR, `${jobId}.${format}.xml`);
    await fsp.writeFile(planJson, JSON.stringify(plan));

    const { code, stderr } = await runPython([
      "-m", "src.export_nle",
      source,
      format,
      planJson,
      "-o", outFile,
    ]);

    if (code === 3) {
      return NextResponse.json(
        {
          error:
            "auto-editor غير مثبت — شغّل: python scripts/install-auto-editor.py",
          hint: "install-auto-editor",
        },
        { status: 503 }
      );
    }
    if (code !== 0 || !existsSync(outFile)) {
      return NextResponse.json(
        { error: `فشل التصدير (رمز ${code})`, detail: stderr.slice(0, 500) },
        { status: 500 }
      );
    }

    const data = await fsp.readFile(outFile);
    return new NextResponse(data, {
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="${jobId}.${format}.xml"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}