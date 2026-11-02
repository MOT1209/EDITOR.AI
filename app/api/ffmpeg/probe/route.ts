import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { validateVideoUpload } from "@/lib/server/validate";
import { probeMedia } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { UPLOAD_DIR } from "@/lib/server/ffmpeg-export";
import { uploadRef } from "@/lib/server/media-ref";
import {
  BodyTooLargeError,
  QuotaError,
  UPLOAD_EXTS,
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
 * POST: رفع فيديو إلى الخادم المحلي (.montage_ai/uploads) + فحصه فعلياً بـ ffprobe.
 * صيغتان: رفع خام متدفق (`Content-Type: application/octet-stream` + `x-upload-name`) يُكتب للقرص مباشرة
 * بلا ذاكرة — تستخدمه الواجهة؛ أو multipart (حقل `file`) بسقف بايتات حقيقي — للسكربتات والتوافق.
 * الملف الذي لا يتعرّف عليه ffprobe كفيديو يُحذف ويُرفض (لا يبقى على القرص).
 */
export async function POST(req: NextRequest) {
  const tooBig = rejectOversizedRequest(req);
  if (tooBig) return tooBig;

  let saved: { id: string; filename: string; filepath: string };
  let name: string;
  let size: number;
  try {
    if (isRawUpload(req)) {
      name = rawUploadName(req);
      const e = path.extname(name).toLowerCase();
      const ext = (UPLOAD_EXTS as readonly string[]).includes(e)
        ? e
        : (req.headers.get("x-upload-type") || "").startsWith("video/") ? ".mp4" : null;
      if (!ext) return NextResponse.json({ error: `نوع ملف غير مدعوم — المسموح: ${UPLOAD_EXTS.join(", ")}` }, { status: 400 });
      if (!req.body) return NextResponse.json({ error: "ملف الفيديو مطلوب" }, { status: 400 });
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
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "ملف الفيديو مطلوب" }, { status: 400 });
      }
      const check = validateVideoUpload(file);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
      saved = await saveUpload(file);
      name = file.name;
      size = file.size;
    }
  } catch (e) {
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, code: "LIMIT_EXCEEDED" }, { status: 507 });
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: e.message, code: "LIMIT_EXCEEDED" }, { status: 413 });
    throw e;
  }
  const { id, filename, filepath } = saved;

  try {
    const info = await probeMedia(filepath);
    if (!info.video) throw new Error("الملف لا يحتوي مسار فيديو");
    return NextResponse.json({ id, ref: uploadRef(id), filename, size, name, info });
  } catch (e) {
    await fs.rm(filepath, { force: true }).catch(() => {});
    logger.warn("upload.rejected", { name: path.basename(name), size });
    const msg = isEngineError(e) || e instanceof Error ? e.message : "ملف غير صالح";
    const status = isEngineError(e) && e.code === "DEPENDENCY_MISSING" ? 503 : 400;
    return NextResponse.json({ error: `تعذّر قراءة الفيديو: ${msg}` }, { status });
  }
}

/** GET: إحصاء بسيط لمجلد الرفع (بلا مسارات مطلقة). */
export async function GET() {
  const files = await fs.readdir(UPLOAD_DIR).catch(() => []);
  return NextResponse.json({ files: files.length });
}
