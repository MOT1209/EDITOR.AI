// تصليب تشغيل العمليات الخارجية (FFmpeg/FFprobe). بلا استيرادات من بقية المشروع كي يُستخدم في أي طبقة.
//
// 1) بيئة مصفّاة: لا تُورَّث مفاتيح المزوّدين ولا أسرار البيئة إلى العملية الفرعية.
// 2) -protocol_whitelist file,pipe قبل كل -i: يمنع قوائم تشغيل HLS/concat الخبيثة من فتح http/tcp/… (SSRF/قراءة ملفات).
// 3) حدود موارد عبر prlimit (Linux) إن توفّر: CPU وحجم الملف الناتج وعدد الملفات المفتوحة. بلا shell.
// 4) عزل ffmpeg/ffprobe (T-09) عبر unshare: بلا شبكة + إخفاء ملفات الأسرار ومجلد المنزل (انظر sandboxCommand).
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

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

// ---------------------------------------------------------------- عزل ffmpeg (T-09)
//
// MONTAGE_FFMPEG_SANDBOX=auto|unshare|off (الافتراضي auto):
//   auto    → unshare إن كانت user+net+mount namespaces تعمل، وإلا بلا عزل + تحذير واحد (التدهور الأنيق).
//   unshare → يفرضه؛ غير متاح ⇒ خطأ صريح بدل التشغيل بلا عزل.
//   off     → بلا عزل.
// ما يوفّره unshare بصدق: لا شبكة (net namespace فارغ) + إخفاء ملفات الأسرار (.env*، قاعدة SQLite) بـ
// /dev/null ومجلد المنزل بـ tmpfs. لا يمنع قراءة بقية نظام الملفات (bwrap لعزل كامل — غير مُنفَّذ بعد).
// كل الطبقات تستعمل exec ⇒ الـ pid النهائي هو ffmpeg نفسه وسطر أوامره يبقى كما هو (يتضمن مسار المخرَج).

export type FfSandboxPolicy = "auto" | "unshare" | "off";

export function ffSandboxPolicy(env: NodeJS.ProcessEnv = process.env): FfSandboxPolicy {
  const v = (env.MONTAGE_FFMPEG_SANDBOX || "auto").toLowerCase();
  return v === "unshare" || v === "off" ? v : "auto";
}

let unshareOk: boolean | undefined;
/** هل تعمل user+net+mount namespaces مع mount فعلي؟ (يُفحص مرة ويُخزَّن). */
export function unshareAvailable(refresh = false): boolean {
  if (unshareOk !== undefined && !refresh) return unshareOk;
  unshareOk = false;
  if (process.platform !== "linux") return unshareOk;
  let probeDir: string | null = null;
  try {
    // نفس عمليتي الإخفاء الفعليتين: tmpfs فوق مجلد، و/dev/null فوق ملف.
    probeDir = mkdtempSync(path.join(os.tmpdir(), "montage-ns-"));
    const probeFile = path.join(probeDir, "f");
    writeFileSync(probeFile, "x");
    const sub = path.join(probeDir, "d");
    mkdirSync(sub);
    const r = spawnSync("unshare", ["-r", "-n", "-m", "--propagation", "private", "--", "sh", "-c", 'mount --bind /dev/null "$1" && mount -t tmpfs tmpfs "$2"', "sh", probeFile, sub], { timeout: 5000, stdio: "ignore" });
    unshareOk = r.status === 0;
  } catch {
    unshareOk = false;
  } finally {
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
  }
  return unshareOk;
}

/** يخفي كل وسيط: مجلد ⇒ tmpfs فارغ، ملف ⇒ /dev/null. فشل أي إخفاء ⇒ لا تشغيل (فشل مغلق). */
const HIDE_SCRIPT =
  'while [ "$1" != "--" ]; do ' +
  'if [ -d "$1" ]; then mount -t tmpfs tmpfs "$1" || exit 97; ' +
  'elif [ -e "$1" ]; then mount --bind /dev/null "$1" || exit 97; fi; ' +
  "shift; done; shift; exec \"$@\"";

function resolveOnPath(cmd: string, env: NodeJS.ProcessEnv): string {
  if (cmd.includes("/")) return path.resolve(cmd);
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* التالي */
    }
  }
  return cmd;
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + path.sep);

/** ملفات ومجلدات تُخفى عن ffmpeg: أسرار cwd + القاعدة + المنزل (إن لم يحتوِ ما يحتاجه الأمر). */
export function ffHiddenPaths(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const out: string[] = [];
  try {
    for (const n of readdirSync(cwd)) if (/^\.env(\..+)?$/.test(n) && n !== ".env.example") out.push(path.join(cwd, n));
  } catch {
    /* لا شيء */
  }
  const dbFile = env.MONTAGE_DB_FILE ? path.resolve(env.MONTAGE_DB_FILE) : path.join(cwd, ".montage_ai", "montage.db");
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) if (existsSync(f)) out.push(f);
  const needed = [resolveOnPath(cmd, env), cwd, ...args.filter((a) => path.isAbsolute(a)).map((a) => path.resolve(a))];
  const home = path.resolve(os.homedir());
  if (home !== path.parse(home).root && !needed.some((n) => inside(n, home))) out.push(home);
  return out.filter((p) => existsSync(p));
}

let warned = false;

/** يلفّ أمر ffmpeg/ffprobe بالعزل حسب السياسة. أي أمر آخر يمرّ كما هو. */
export function sandboxCommand(
  cmd: string,
  args: string[],
  opts: { tool?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}
): { cmd: string; args: string[]; sandbox: "unshare" | "none" } {
  const env = opts.env ?? process.env;
  const tool = opts.tool ?? cmd;
  const policy = ffSandboxPolicy(env);
  if (!isFfTool(tool) || policy === "off") return { cmd, args, sandbox: "none" };
  if (!unshareAvailable()) {
    if (policy === "unshare") {
      throw new Error("عزل ffmpeg المطلوب (MONTAGE_FFMPEG_SANDBOX=unshare) غير متاح: user/net namespaces معطّلة على هذا الخادم");
    }
    if (!warned) {
      warned = true;
      process.emitWarning("عزل ffmpeg غير متاح (user namespaces معطّلة) — يعمل بلا عزل شبكة", { code: "MONTAGE_FFMPEG_NO_SANDBOX" });
    }
    return { cmd, args, sandbox: "none" };
  }
  const hide = ffHiddenPaths(tool, args, env, opts.cwd);
  return {
    cmd: "unshare",
    args: ["-r", "-n", "-m", "--propagation", "private", "--", "sh", "-c", HIDE_SCRIPT, "sh", ...hide, "--", cmd, ...args],
    sandbox: "unshare",
  };
}

/** تصليب كامل لأمر FFmpeg/FFprobe: بروتوكولات + حدود + عزل. أي أمر آخر يمرّ بلا تعديل (ما عدا الحدود). */
export function hardenedSpawn(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const a = isFfTool(cmd) ? hardenFfmpegArgs(args) : args;
  const l = limitCommand(cmd, a);
  const s = sandboxCommand(l.cmd, l.args, { tool: cmd });
  return { cmd: s.cmd, args: s.args };
}
