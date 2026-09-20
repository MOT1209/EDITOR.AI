// ====================================================================
// تحقق المدخلات وحدود الرفع (موحّد لمسارات API)
// دوال نقية قابلة للاختبار — لا تعرف شيئاً عن Next.js.
// ====================================================================

/** الحد الأقصى الافتراضي لحجم الفيديو المرفوع (2GB) — قابل للتهيئة عبر البيئة. */
export function maxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 2 * 1024 * 1024 * 1024;
}

export interface FileLike {
  name: string;
  size: number;
  type?: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];
const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** تحقق ملف فيديو مرفوع: نوع MIME أو الامتداد ضمن المسموح + الحجم ضمن الحد. */
export function validateVideoUpload(
  file: FileLike | null | undefined,
  maxBytes: number = maxUploadBytes()
): ValidationResult {
  if (!file) return { ok: false, error: "ملف الفيديو مطلوب" };
  if (file.size <= 0) return { ok: false, error: "الملف فارغ" };
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    return { ok: false, error: `حجم الملف يتجاوز الحد المسموح (${mb}MB)` };
  }
  const typeOk = (file.type || "").startsWith("video/");
  const extOk = VIDEO_EXTS.includes(ext(file.name));
  if (!typeOk && !extOk) {
    return { ok: false, error: `نوع ملف غير مدعوم — المسموح: ${VIDEO_EXTS.join(", ")}` };
  }
  return { ok: true };
}

/** تحقق ملف صوتي مرفوع (لمسارات التفريغ). */
export function validateAudioUpload(
  file: FileLike | null | undefined,
  maxBytes: number = maxUploadBytes()
): ValidationResult {
  if (!file) return { ok: false, error: "الملف الصوتي مطلوب" };
  if (file.size <= 0) return { ok: false, error: "الملف فارغ" };
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    return { ok: false, error: `حجم الملف يتجاوز الحد المسموح (${mb}MB)` };
  }
  const typeOk = (file.type || "").startsWith("audio/") || (file.type || "").startsWith("video/");
  const extOk = AUDIO_EXTS.includes(ext(file.name)) || VIDEO_EXTS.includes(ext(file.name));
  if (!typeOk && !extOk) {
    return { ok: false, error: `نوع ملف غير مدعوم — المسموح: ${AUDIO_EXTS.join(", ")}` };
  }
  return { ok: true };
}

/** يقصّ نصاً لطول أقصى مع تحويل آمن. */
export function clampString(value: unknown, maxLen: number, fallback = ""): string {
  const s = value === undefined || value === null ? fallback : String(value);
  return s.slice(0, maxLen);
}

/** يتحقق أن قيمة ضمن قائمة مسموحة وإلا يرجع الافتراضي. */
export function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const s = String(value ?? "");
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** تحقق نص مطلوب (غير فارغ) بحد أقصى. يرجع {ok,value?} أو {ok:false,error}. */
export function requireText(
  value: unknown,
  field: string,
  maxLen: number
): { ok: true; value: string } | { ok: false; error: string } {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return { ok: false, error: `${field} مطلوب` };
  return { ok: true, value: s.slice(0, maxLen) };
}
