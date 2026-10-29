import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { validateVideoUpload } from "@/lib/server/validate";
import { probeMedia } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { UPLOAD_DIR } from "@/lib/server/ffmpeg-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

/**
 * POST: رفع فيديو إلى الخادم المحلي (.montage_ai/uploads) + فحصه فعلياً بـ ffprobe.
 * الملف الذي لا يتعرّف عليه ffprobe كفيديو يُحذف ويُرفض (لا يبقى على القرص).
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "ملف الفيديو مطلوب" }, { status: 400 });
  }
  const check = validateVideoUpload(file);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const id = uuid();
  const rawExt = path.extname(file.name).toLowerCase();
  const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : ".mp4";
  const filename = `${id}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filepath, buffer);

  try {
    const info = await probeMedia(filepath);
    if (!info.video) throw new Error("الملف لا يحتوي مسار فيديو");
    return NextResponse.json({ id, filename, size: buffer.length, path: filepath, name: file.name, info });
  } catch (e) {
    await fs.rm(filepath, { force: true }).catch(() => {});
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
