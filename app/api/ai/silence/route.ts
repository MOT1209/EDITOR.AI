import { NextRequest, NextResponse } from "next/server";
import { detectSilence } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import path from "path";
import { UPLOAD_DIR, hasFfmpeg, isPathInside } from "@/lib/server/ffmpeg-export";
import { workspaceRoot } from "@/lib/engine/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * كشف الصمت الحقيقي (ffmpeg silencedetect) على فيديو مرفوع إلى .montage_ai/uploads.
 * لا بيانات عشوائية: بلا ملف/ffmpeg ⇒ نتيجة فارغة + تحذير صريح (تدهور أنيق).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const duration = typeof body?.duration === "number" && body.duration > 0 ? body.duration : undefined;
  const filePath = body?.filePath;

  const allowed =
    typeof filePath === "string" &&
    (isPathInside(filePath, UPLOAD_DIR) || isPathInside(filePath, path.join(workspaceRoot(), "projects")));
  if (!allowed) {
    return NextResponse.json({ error: "filePath يجب أن يشير إلى فيديو مرفوع (ارفع الفيديو أولاً)" }, { status: 400 });
  }
  if (!hasFfmpeg()) {
    return NextResponse.json({ segments: [], duration, warning: "ffmpeg غير مثبت — تعذّر كشف الصمت" });
  }
  try {
    const segments = await detectSilence(filePath, { noiseDb: -20, minDurationSeconds: 0.5, durationSeconds: duration });
    return NextResponse.json({ segments, duration });
  } catch (e) {
    const msg = isEngineError(e) || e instanceof Error ? e.message : "فشل كشف الصمت";
    const status = isEngineError(e) && (e.code === "UNSUPPORTED" || e.code === "NOT_FOUND") ? 422 : 500;
    return NextResponse.json({ error: msg, segments: [] }, { status });
  }
}
