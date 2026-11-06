import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/server/api-guard";
import { promises as fs } from "fs";
import path from "path";
import { probeMedia } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { maxUploadBytes } from "@/lib/server/validate";
import { kindOfExt, uploadRef } from "@/lib/server/media-ref";
import {
  BodyTooLargeError,
  QuotaError,
  allowedMediaExt,
  isRawUpload,
  rawUploadName,
  readFormDataCapped,
  rejectOversizedRequest,
  saveUpload,
  saveUploadStream,
} from "@/lib/server/uploads";
import { logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: رفع وسيط (فيديو/صوت/صورة) إلى الخادم + فحص ffprobe الفعلي → مرجع معتم `upload:<uuid>`.
 * هذا هو المسار الوحيد الذي يجعل الصوت المولَّد/المرفوع قابلاً للدخول في التصدير (T-13).
 * النوع يُشتق من الامتداد المسموح ثم يُتحقق بمحتوى الملف؛ غير المتطابق يُحذف ويُرفض.
 */
export async function POST(req: NextRequest) {
  // مستثنى من middleware (جسم كبير يُبث للقرص) ⇒ الحارس هنا — lib/server/api-guard.ts.
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const tooBig = rejectOversizedRequest(req);
  if (tooBig) return tooBig;

  // صيغتان: رفع خام متدفق إلى القرص (application/octet-stream + x-upload-name) — تستخدمه الواجهة،
  // أو multipart (حقل file) بسقف بايتات حقيقي.
  let saved: { id: string; filepath: string };
  let name: string;
  let size: number;
  let ext: string | null;
  try {
    if (isRawUpload(req)) {
      name = rawUploadName(req);
      ext = allowedMediaExt(name);
      if (!ext) return NextResponse.json({ error: "نوع ملف غير مدعوم (فيديو/صوت/صورة فقط)" }, { status: 400 });
      if (!req.body) return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
      const r = await saveUploadStream(req.body, ext, { declaredSize: Number(req.headers.get("content-length") || 0) });
      if (r.size <= 0) {
        await fs.rm(r.filepath, { force: true }).catch(() => {});
        return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
      }
      saved = r;
      size = r.size;
    } else {
      const parsed = await readFormDataCapped(req);
      if (parsed.response) return parsed.response;
      const file = parsed.form.get("file");
      if (!file || !(file instanceof File)) return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
      if (file.size <= 0) return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
      if (file.size > maxUploadBytes()) return NextResponse.json({ error: "حجم الملف يتجاوز الحد المسموح", code: "LIMIT_EXCEEDED" }, { status: 413 });
      ext = allowedMediaExt(file.name);
      if (!ext) return NextResponse.json({ error: "نوع ملف غير مدعوم (فيديو/صوت/صورة فقط)" }, { status: 400 });
      saved = await saveUpload(file, ext);
      name = file.name;
      size = file.size;
    }
  } catch (e) {
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, code: "LIMIT_EXCEEDED" }, { status: 507 });
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: e.message, code: "LIMIT_EXCEEDED" }, { status: 413 });
    throw e;
  }
  const kind = kindOfExt(ext);
  try {
    const info = await probeMedia(saved.filepath);
    if (kind === "audio" && !info.audio) throw new Error("الملف لا يحتوي مسار صوت");
    if (kind !== "audio" && !info.video) throw new Error("الملف لا يحتوي مسار صورة/فيديو");
    return NextResponse.json({
      id: saved.id,
      ref: uploadRef(saved.id),
      kind,
      name,
      size,
      durationSeconds: kind === "image" ? 0 : info.durationSeconds,
      hasAudio: !!info.audio,
      video: info.video ? { width: info.video.width, height: info.video.height, fps: info.video.fps } : null,
    });
  } catch (e) {
    await fs.rm(saved.filepath, { force: true }).catch(() => {});
    logger.warn("upload.rejected", { name: path.basename(name), size });
    const msg = isEngineError(e) || e instanceof Error ? e.message : "ملف غير صالح";
    return NextResponse.json({ error: `تعذّر قراءة الملف: ${msg}` }, { status: isEngineError(e) && e.code === "DEPENDENCY_MISSING" ? 503 : 400 });
  }
}
