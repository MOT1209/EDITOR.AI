// مدة الصوت الحقيقية لضابط التكلفة (L3): الملف يُكتب مؤقتاً ويُفحص بـ ffprobe (مصلَّب عبر probeMedia).
// عند تعذّر الفحص: تقدير محافظ من الحجم بافتراض 16kbps (≈2000 بايت/ث) — يميل للأعلى لا للأسفل.
import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import { v4 as uuid } from "uuid";
import { probeMedia } from "@/lib/engine/media";

export const CONSERVATIVE_BYTES_PER_SEC = 2000;

export function conservativeAudioSeconds(sizeBytes: number): number {
  return Math.max(1, sizeBytes / CONSERVATIVE_BYTES_PER_SEC);
}

export async function estimateAudioSeconds(file: File): Promise<{ seconds: number; measured: boolean }> {
  const tmp = path.join(os.tmpdir(), `montage_dur_${uuid()}`);
  try {
    await fsp.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    const info = await probeMedia(tmp);
    if (info.durationSeconds > 0) return { seconds: info.durationSeconds, measured: true };
  } catch {
    /* ffprobe غائب أو ملف غير قابل للفحص ⇒ التقدير المحافظ */
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
  return { seconds: conservativeAudioSeconds(file.size), measured: false };
}
