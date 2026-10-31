import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { validateVideoUpload } from "@/lib/server/validate";
import { probeMedia } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { UPLOAD_DIR } from "@/lib/server/ffmpeg-export";
import { uploadRef } from "@/lib/server/media-ref";
import { saveUpload, rejectOversizedRequest, QuotaError } from "@/lib/server/uploads";
import { logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: رفع فيديو إلى الخادم المحلي (.montage_ai/uploads) + فحصه فعلياً بـ ffprobe.
 * الملف الذي لا يتعرّف عليه ffprobe كفيديو يُحذف ويُرفض (لا يبقى على القرص).
 */
export async function POST(req: NextRequest) {
  const tooBig = rejectOversizedRequest(req);
  if (tooBig) return tooBig;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "طلب multipart غير صالح" }, { status: 400 });
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "ملف الفيديو مطلوب" }, { status: 400 });
  }
  const check = validateVideoUpload(file);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  let saved;
  try {
    saved = await saveUpload(file);
  } catch (e) {
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message, code: "LIMIT_EXCEEDED" }, { status: 507 });
    throw e;
  }
  const { id, filename, filepath } = saved;

  try {
    const info = await probeMedia(filepath);
    if (!info.video) throw new Error("الملف لا يحتوي مسار فيديو");
    return NextResponse.json({ id, ref: uploadRef(id), filename, size: file.size, name: file.name, info });
  } catch (e) {
    await fs.rm(filepath, { force: true }).catch(() => {});
    logger.warn("upload.rejected", { name: path.basename(file.name), size: file.size });
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
