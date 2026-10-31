import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { probeMedia } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { maxUploadBytes } from "@/lib/server/validate";
import { kindOfExt, uploadRef } from "@/lib/server/media-ref";
import { QuotaError, allowedMediaExt, rejectOversizedRequest, saveUpload } from "@/lib/server/uploads";
import { logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: رفع وسيط (فيديو/صوت/صورة) إلى الخادم + فحص ffprobe الفعلي → مرجع معتم `upload:<uuid>`.
 * هذا هو المسار الوحيد الذي يجعل الصوت المولَّد/المرفوع قابلاً للدخول في التصدير (T-13).
 * النوع يُشتق من الامتداد المسموح ثم يُتحقق بمحتوى الملف؛ غير المتطابق يُحذف ويُرفض.
 */
export async function POST(req: NextRequest) {
  const tooBig = rejectOversizedRequest(req);
  if (tooBig) return tooBig;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
  if (file.size > maxUploadBytes()) return NextResponse.json({ error: "حجم الملف يتجاوز الحد المسموح", code: "LIMIT_EXCEEDED" }, { status: 413 });
  const ext = allowedMediaExt(file.name);
  if (!ext) return NextResponse.json({ error: "نوع ملف غير مدعوم (فيديو/صوت/صورة فقط)" }, { status: 400 });
  const kind = kindOfExt(ext);

  let saved;
  try {
    saved = await saveUpload(file, ext);
  } catch (e) {
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, code: "LIMIT_EXCEEDED" }, { status: 507 });
    throw e;
  }
  try {
    const info = await probeMedia(saved.filepath);
    if (kind === "audio" && !info.audio) throw new Error("الملف لا يحتوي مسار صوت");
    if (kind !== "audio" && !info.video) throw new Error("الملف لا يحتوي مسار صورة/فيديو");
    return NextResponse.json({
      id: saved.id,
      ref: uploadRef(saved.id),
      kind,
      name: file.name,
      size: file.size,
      durationSeconds: kind === "image" ? 0 : info.durationSeconds,
      hasAudio: !!info.audio,
      video: info.video ? { width: info.video.width, height: info.video.height, fps: info.video.fps } : null,
    });
  } catch (e) {
    await fs.rm(saved.filepath, { force: true }).catch(() => {});
    logger.warn("upload.rejected", { name: path.basename(file.name), size: file.size });
    const msg = isEngineError(e) || e instanceof Error ? e.message : "ملف غير صالح";
    return NextResponse.json({ error: `تعذّر قراءة الملف: ${msg}` }, { status: isEngineError(e) && e.code === "DEPENDENCY_MISSING" ? 503 : 400 });
  }
}
