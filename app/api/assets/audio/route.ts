import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, promises as fsp } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuid } from "uuid";
import { validateAudioUpload } from "@/lib/server/validate";
import { AUDIO_DIR, audioRef } from "@/lib/server/media-ref";
import { ensureStorageQuota } from "@/lib/server/storage";
import { rejectOversizedRequest } from "@/lib/server/uploads";
import { probeMedia } from "@/lib/engine/media";
import { isEngineError } from "@/lib/engine/errors";
import { logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus", ".webm"];

/**
 * POST multipart {file}: يحفظ ملفاً صوتياً كأصل على الخادم (T-13) ويعيد مرجعاً معتماً audio:<uuid>.<ext>.
 * ffprobe يتحقق فعلياً من وجود مسار صوت (الملف المزيّف يُحذف). قيد الحجم والامتداد وسقف التخزين كالفيديو.
 */
export async function POST(req: NextRequest) {
  const tooBig = rejectOversizedRequest(req);
  if (tooBig) return tooBig;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !file || !(file instanceof File)) {
    return NextResponse.json({ error: "ملف الصوت مطلوب" }, { status: 400 });
  }
  const check = validateAudioUpload(file);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const rawExt = path.extname(file.name).toLowerCase();
  const ext = AUDIO_EXTS.includes(rawExt) ? rawExt : ".webm"; // تسجيلات المتصفح عادةً webm/ogg
  try {
    await ensureStorageQuota(file.size);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, code: "LIMIT_EXCEEDED" }, { status: 507 });
  }
  await fsp.mkdir(AUDIO_DIR, { recursive: true });
  const filename = `${uuid()}${ext}`;
  const filepath = path.join(AUDIO_DIR, filename);
  await pipeline(Readable.fromWeb(file.stream() as import("stream/web").ReadableStream), createWriteStream(filepath, { mode: 0o600 }));
  try {
    const info = await probeMedia(filepath);
    if (!info.audio) throw new Error("الملف لا يحتوي مسار صوت");
    return NextResponse.json({ ref: audioRef(filename), size: file.size, durationSeconds: info.durationSeconds });
  } catch (e) {
    await fsp.rm(filepath, { force: true }).catch(() => {});
    logger.warn("audio_upload.rejected", { name: path.basename(file.name), size: file.size });
    const msg = isEngineError(e) || e instanceof Error ? e.message : "ملف غير صالح";
    const status = isEngineError(e) && e.code === "DEPENDENCY_MISSING" ? 503 : 400;
    return NextResponse.json({ error: `تعذّر قراءة الصوت: ${msg}` }, { status });
  }
}
