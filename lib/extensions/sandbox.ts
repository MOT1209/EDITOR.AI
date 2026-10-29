// ====================================================================
// عزل البرامج الخارجية (طبقة فوق التقييد في external.ts).
//
// السياسة MONTAGE_EXT_SANDBOX:
//   auto (الافتراضي) → أفضل مُتاح: bwrap ثم unshare؛ إن لم يتوفر أيٌّ منهما ⇒ رفض التشغيل (لا تدهور صامت).
//   bwrap | unshare  → يفرض هذا الأسلوب أو يرفض.
//   none             → إلغاء العزل صراحةً (قرار المالك، يُوسم تحذيراً في كل نتيجة).
//
// ما يوفّره كل أسلوب (بصدق):
//   bwrap   : لا شبكة، نظام ملفات للقراءة فقط، مساحة العمل والمنزل مخفيّان، /tmp خاص، يموت مع الأب.
//   unshare : لا شبكة (user+net namespace) وإخفاء مساحة العمل والمنزل وجذر المستودع بـ tmpfs.
//             لا يمنع قراءة بقية نظام الملفات ولا الكتابة خارج المخفي — أضعف من bwrap.
// لا يوفّر أيٌّ منهما حدود ذاكرة/CPU (استخدم cgroups/حاوية للمزيد).
// ====================================================================
import { spawnSync } from "child_process";
import os from "os";
import path from "path";
import { workspaceRoot } from "@/lib/engine/store";
import { EngineError } from "@/lib/engine/errors";

export type SandboxKind = "bwrap" | "unshare" | "none";
export type SandboxPolicy = "auto" | SandboxKind;

export interface SandboxPlan {
  kind: SandboxKind;
  command: string;
  args: string[];
  /** وصف صادق لما يوفّره الأسلوب (يُعرض في سجل التنفيذ). */
  note: string;
}

export function sandboxPolicy(): SandboxPolicy {
  const v = (process.env.MONTAGE_EXT_SANDBOX || "auto").toLowerCase();
  return v === "bwrap" || v === "unshare" || v === "none" ? v : "auto";
}

let detected: { bwrap: string | null; unshare: boolean } | null = null;

function which(bin: string): string | null {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf-8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

export function detectSandboxes(refresh = false): { bwrap: string | null; unshare: boolean } {
  if (detected && !refresh) return detected;
  const bwrap = process.platform === "linux" ? which("bwrap") : null;
  let unshare = false;
  if (process.platform === "linux" && which("unshare")) {
    // يجب أن تعمل user+net namespaces فعلاً (قد تُعطَّل في بعض الحاويات).
    unshare = spawnSync("unshare", ["-r", "-n", "-m", "true"], { timeout: 5000 }).status === 0;
  }
  detected = { bwrap, unshare };
  return detected;
}

const HIDE_SCRIPT = 'while [ "$1" != "--" ]; do [ -d "$1" ] && mount -t tmpfs tmpfs "$1"; shift; done; shift; exec "$@"';

/** مجلدات حسّاسة تُخفى — ما عدا ما يحتوي البرنامج أو وسائطه المسارية. */
function hiddenDirs(command: string, args: string[]): string[] {
  const needed = [command, ...args.filter((a) => path.isAbsolute(a))].map((p) => path.resolve(p));
  const cands = [workspaceRoot(), os.homedir(), process.cwd()].map((d) => path.resolve(d));
  return [...new Set(cands)].filter((d) => d !== path.parse(d).root && !needed.some((n) => n === d || n.startsWith(d + path.sep)));
}

export function planSandbox(command: string, args: string[], cwd?: string): SandboxPlan {
  const policy = sandboxPolicy();
  const det = detectSandboxes();
  const hide = hiddenDirs(command, args);
  const pick: SandboxKind =
    policy === "none" ? "none"
    : policy === "bwrap" ? (det.bwrap ? "bwrap" : "none")
    : policy === "unshare" ? (det.unshare ? "unshare" : "none")
    : det.bwrap ? "bwrap" : det.unshare ? "unshare" : "none";

  if (policy !== "none" && pick === "none") {
    throw new EngineError(
      "UNSUPPORTED",
      policy === "auto" ? "لا يتوفر أسلوب عزل (bwrap/unshare) على هذا الخادم — رُفض تشغيل البرنامج الخارجي" : `أسلوب العزل المطلوب «${policy}» غير متاح`,
      "ثبّت bubblewrap (apt install bubblewrap) أو فعّل user namespaces، أو اضبط MONTAGE_EXT_SANDBOX=none إن قبلت تشغيله بلا عزل (على مسؤوليتك)."
    );
  }
  if (pick === "bwrap") {
    const a = ["--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
    for (const d of hide) a.push("--tmpfs", d);
    if (cwd) a.push("--bind", cwd, cwd, "--chdir", cwd); // /tmp مخفي: نُعيد ربط مجلد العمل المؤقت فقط
    return { kind: "bwrap", command: det.bwrap as string, args: [...a, "--", command, ...args], note: "bwrap: بلا شبكة، نظام ملفات للقراءة فقط، مساحة العمل والمنزل مخفيّان" };
  }
  if (pick === "unshare") {
    return {
      kind: "unshare", command: "unshare",
      args: ["-r", "-n", "-m", "--propagation", "private", "--", "sh", "-c", HIDE_SCRIPT, "sh", ...hide, "--", command, ...args],
      note: "unshare: بلا شبكة + إخفاء مساحة العمل والمنزل (لا يقيّد بقية نظام الملفات)",
    };
  }
  return { kind: "none", command, args, note: "⚠ بلا عزل (MONTAGE_EXT_SANDBOX=none) — البرنامج بصلاحيات مستخدم الخادم" };
}
