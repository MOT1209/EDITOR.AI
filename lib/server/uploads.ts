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
/** كل الامتدادات المسموحة لمسار الرفع العام (فيديو + صوت + صورة). */
export const UPLOAD_AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"] as const;
export const UPLOAD_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"] as const;
export const UPLOAD_ALL_EXTS = [...UPLOAD_EXTS, ...UPLOAD_AUDIO_EXTS, ...UPLOAD_IMAGE_EXTS] as const;

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

/** امتداد من القائمة الموسّعة (فيديو/صوت/صورة) أو null إن لم يُسمح به. */
export function allowedMediaExt(name: string): string | null {
  const e = path.extname(name).toLowerCase();
  return (UPLOAD_ALL_EXTS as readonly string[]).includes(e) ? e : null;
}

export class QuotaError extends Error {}

/** يحفظ File في UPLOAD_DIR باسم عشوائي. يرمي QuotaError عند تجاوز السقف. */
export async function saveUpload(file: File, extOverride?: string): Promise<{ id: string; filename: string; filepath: string }> {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  void maybeCleanup();
  try {
    await ensureStorageQuota(file.size);
  } catch (e) {
    logger.warn("upload.quota_exceeded", { size: file.size });
    throw new QuotaError((e as Error).message);
  }
  const id = uuid();
  const filename = `${id}${extOverride ?? safeUploadExt(file.name)}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await pipeline(Readable.fromWeb(file.stream() as import("stream/web").ReadableStream), createWriteStream(filepath, { mode: 0o600 }));
  return { id, filename, filepath };
}

// ====================================================================
// سقف حقيقي للجسم (T-26): يعدّ البايتات الفعلية لا Content-Length المعلن، فلا يتجاوزه طلب chunked.
// ====================================================================

export class BodyTooLargeError extends Error {
  constructor() {
    super("حجم الطلب يتجاوز الحد المسموح");
  }
}

/** يلفّ تدفقاً بعدّاد يقطعه بـ BodyTooLargeError فور تجاوز maxBytes. */
export function cappedStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new BodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

const tooLarge = () => NextResponse.json({ error: "حجم الطلب يتجاوز الحد المسموح", code: "LIMIT_EXCEEDED" }, { status: 413 });

/**
 * بديل req.formData() بسقف حقيقي: الرفض المبكر بالحجم المعلن، ثم عدّ البايتات أثناء القراءة.
 * يعيد { form } أو { response } جاهزة (413 للتجاوز، 400 لجسم multipart غير صالح).
 */
export async function readFormDataCapped(
  req: NextRequest,
  maxBytes: number = maxUploadBytes() + 1024 * 1024
): Promise<{ form: FormData; response?: undefined } | { form?: undefined; response: NextResponse }> {
  if (Number(req.headers.get("content-length") || 0) > maxBytes) return { response: tooLarge() };
  if (!req.body) return { response: NextResponse.json({ error: "طلب multipart غير صالح" }, { status: 400 }) };
  try {
    const capped = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: cappedStream(req.body, maxBytes),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return { form: await capped.formData() };
  } catch (e) {
    if (e instanceof BodyTooLargeError || (e instanceof Error && e.cause instanceof BodyTooLargeError)) return { response: tooLarge() };
    return { response: NextResponse.json({ error: "طلب multipart غير صالح" }, { status: 400 }) };
  }
}

/** هل الطلب رفع خام (جسم = بايتات الملف مباشرة) لا multipart؟ */
export function isRawUpload(req: NextRequest): boolean {
  return (req.headers.get("content-type") || "").toLowerCase().startsWith("application/octet-stream");
}

/** اسم الملف الأصلي من ترويسة x-upload-name (مرمّزة URI) — للعرض والامتداد فقط، لا يدخل أي مسار. */
export function rawUploadName(req: NextRequest): string {
  const raw = req.headers.get("x-upload-name") || "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* اسم مشوّه ⇒ يُستعمل كما هو */
  }
  return path.basename(name).slice(0, 255) || "upload";
}

/**
 * حفظ متدفق من جسم الطلب إلى القرص مباشرة (بلا ذاكرة): سقف بالبايتات الفعلية، حصة تخزين بالحجم المعلن،
 * وحذف الملف الجزئي عند أي فشل. يرمي BodyTooLargeError أو QuotaError.
 */
export async function saveUploadStream(
  body: ReadableStream<Uint8Array>,
  ext: string,
  opts: { maxBytes?: number; declaredSize?: number } = {}
): Promise<{ id: string; filename: string; filepath: string; size: number }> {
  const maxBytes = opts.maxBytes ?? maxUploadBytes();
  if ((opts.declaredSize ?? 0) > maxBytes) throw new BodyTooLargeError();
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  void maybeCleanup();
  try {
    await ensureStorageQuota(opts.declaredSize && opts.declaredSize > 0 ? opts.declaredSize : maxBytes);
  } catch (e) {
    logger.warn("upload.quota_exceeded", { size: opts.declaredSize ?? null });
    throw new QuotaError((e as Error).message);
  }
  const id = uuid();
  const filename = `${id}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  let size = 0;
  const counted = cappedStream(body, maxBytes).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        controller.enqueue(chunk);
      },
    })
  );
  try {
    await pipeline(Readable.fromWeb(counted as import("stream/web").ReadableStream), createWriteStream(filepath, { mode: 0o600 }));
  } catch (e) {
    await fsp.rm(filepath, { force: true }).catch(() => {});
    if (e instanceof BodyTooLargeError || (e instanceof Error && e.cause instanceof BodyTooLargeError)) throw new BodyTooLargeError();
    throw e;
  }
  return { id, filename, filepath, size };
}
