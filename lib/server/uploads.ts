// حفظ الملفات المرفوعة بأمان: امتداد من قائمة سماح، سقف تخزين، كتابة بالبث، صلاحيات 0600.
import { createWriteStream, promises as fsp } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse, type NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { UPLOAD_DIR } from "@/lib/server/ffmpeg-export";
import { ensureStorageQuota, maybeCleanup } from "@/lib/server/storage";
import { maxUploadBytes } from "@/lib/server/validate";
import { logger } from "@/lib/server/logger";

export const UPLOAD_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"] as const;

/** رفض مبكر قبل قراءة الجسم إن أعلن Content-Length حجماً يتجاوز الحد. */
export function rejectOversizedRequest(req: NextRequest): NextResponse | null {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxUploadBytes() + 1024 * 1024) {
    return NextResponse.json({ error: "حجم الطلب يتجاوز الحد المسموح", code: "LIMIT_EXCEEDED" }, { status: 413 });
  }
  return null;
}

export function safeUploadExt(name: string): string {
  const e = path.extname(name).toLowerCase();
  return (UPLOAD_EXTS as readonly string[]).includes(e) ? e : ".mp4";
}

export class QuotaError extends Error {}

/** يحفظ File في UPLOAD_DIR باسم عشوائي. يرمي QuotaError عند تجاوز السقف. */
export async function saveUpload(file: File): Promise<{ id: string; filename: string; filepath: string }> {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  void maybeCleanup();
  try {
    await ensureStorageQuota(file.size);
  } catch (e) {
    logger.warn("upload.quota_exceeded", { size: file.size });
    throw new QuotaError((e as Error).message);
  }
  const id = uuid();
  const filename = `${id}${safeUploadExt(file.name)}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await pipeline(Readable.fromWeb(file.stream() as import("stream/web").ReadableStream), createWriteStream(filepath, { mode: 0o600 }));
  return { id, filename, filepath };
}
