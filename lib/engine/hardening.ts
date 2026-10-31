// تصليب تشغيل العمليات الخارجية (FFmpeg/FFprobe). بلا استيرادات من بقية المشروع كي يُستخدم في أي طبقة.
//
// 1) بيئة مصفّاة: لا تُورَّث مفاتيح المزوّدين ولا أسرار البيئة إلى العملية الفرعية.
// 2) -protocol_whitelist file,pipe قبل كل -i: يمنع قوائم تشغيل HLS/concat الخبيثة من فتح http/tcp/… (SSRF/قراءة ملفات).
// 3) حدود موارد عبر prlimit (Linux) إن توفّر: CPU وحجم الملف الناتج وعدد الملفات المفتوحة. بلا shell.
import { existsSync } from "fs";

const ENV_ALLOW = [
  "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TEMP", "TMP", "TZ",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH",
];

export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = {} as NodeJS.ProcessEnv;
  for (const k of ENV_ALLOW) if (base[k] !== undefined) out[k] = base[k];
  return out;
}

export function isFfTool(cmd: string): boolean {
  return /^(ffmpeg|ffprobe)(\.exe)?$/i.test(cmd.split(/[\\/]/).pop() ?? "");
}

/** يُدخل -protocol_whitelist file,pipe قبل كل `-i`. idempotent. */
export function hardenFfmpegArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-i" && args[i - 1] !== "file,pipe") out.push("-protocol_whitelist", "file,pipe");
    out.push(args[i]);
  }
  return out;
}

export interface ProcLimits {
  /** ثوانٍ من وقت المعالج (مجموع الخيوط). */
  cpuSeconds: number;
  /** أقصى حجم لملف ينتجه التنفيذ. */
  fileBytes: number;
  openFiles: number;
}

export function defaultLimits(env: NodeJS.ProcessEnv = process.env): ProcLimits {
  const n = (raw: string | undefined, d: number) => (raw && Number(raw) > 0 ? Number(raw) : d);
  return {
    cpuSeconds: n(env.MONTAGE_PROC_CPU_SECONDS, 4 * 3600 * 8), // 4 ساعات × 8 خيوط
    fileBytes: n(env.MONTAGE_PROC_MAX_FILE_BYTES, 16 * 1024 ** 3),
    openFiles: n(env.MONTAGE_PROC_MAX_OPEN_FILES, 4096),
  };
}

let prlimitPath: string | null | undefined;
export function findPrlimit(): string | null {
  if (prlimitPath !== undefined) return prlimitPath;
  prlimitPath = null;
  if (process.platform === "linux") {
    for (const p of ["/usr/bin/prlimit", "/bin/prlimit", "/usr/local/bin/prlimit"]) {
      if (existsSync(p)) { prlimitPath = p; break; }
    }
  }
  return prlimitPath;
}

/** يلفّ الأمر بـ prlimit إن توفر ولم يُعطَّل (MONTAGE_PROC_LIMITS=off). وإلا يعيده كما هو. */
export function limitCommand(
  cmd: string,
  args: string[],
  limits: ProcLimits = defaultLimits(),
  env: NodeJS.ProcessEnv = process.env
): { cmd: string; args: string[]; limited: boolean } {
  const pl = env.MONTAGE_PROC_LIMITS === "off" ? null : findPrlimit();
  if (!pl) return { cmd, args, limited: false };
  return {
    cmd: pl,
    args: [`--cpu=${Math.floor(limits.cpuSeconds)}`, `--fsize=${Math.floor(limits.fileBytes)}`, `--nofile=${Math.floor(limits.openFiles)}`, "--", cmd, ...args],
    limited: true,
  };
}

/** تصليب كامل لأمر FFmpeg/FFprobe: بروتوكولات + حدود. أي أمر آخر يمرّ بلا تعديل (ما عدا الحدود). */
export function hardenedSpawn(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const a = isFfTool(cmd) ? hardenFfmpegArgs(args) : args;
  const l = limitCommand(cmd, a);
  return { cmd: l.cmd, args: l.args };
}
