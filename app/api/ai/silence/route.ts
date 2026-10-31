import { resolveVideoRef } from "@/lib/server/media-ref";
import { NextRequest, NextResponse } from "next/server";
import { detectSilence } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { hasFfmpeg } from "@/lib/server/ffmpeg-export";

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
  const filePath = await resolveVideoRef(body?.sourceRef);
  if (!filePath) {
    return NextResponse.json({ error: "sourceRef يجب أن يشير إلى فيديو مرفوع (ارفع الفيديو أولاً)" }, { status: 400 });
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
