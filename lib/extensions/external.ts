// ====================================================================
// التنفيذ الخارجي المقيَّد (مهارات external / أدوات executable).
//
// الأمان بالتصميم:
//  - معطّل افتراضياً؛ يتطلب MONTAGE_EXT_EXTERNAL=1 يضبطه المالك في بيئة الخادم.
//  - البرامج المسموحة تُعرَّف فقط في ملف يشير إليه MONTAGE_EXT_ALLOWLIST، ويجب أن يقع
//    خارج مساحة العمل (فلا تستطيع الواجهة ولا MCP ولا حزمة مستوردة تعديله).
//  - البيان يشير إلى إدخال بالاسم؛ command/args ثابتة من الملف — لا شيء من المدخلات يصل إليها.
//  - spawn بلا shell، بيئة مصفّاة (لا مفاتيح)، cwd مؤقت فارغ، مهلة وسقف مخرجات، المدخل عبر stdin JSON.
//  - العزل (sandbox.ts): bwrap/unshare بلا شبكة وبإخفاء مساحة العمل — مطلوب افتراضياً (MONTAGE_EXT_SANDBOX).
//    لا حدود ذاكرة/CPU. اسمح فقط ببرامج تثق بها.
// ====================================================================
import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { EngineError } from "@/lib/engine/errors";
import { workspaceRoot } from "@/lib/engine/store";
import { isPathInside } from "@/lib/server/ffmpeg-export";
import type { Permission } from "./manifest";
import { planSandbox } from "./sandbox";

export interface ExternalEntry {
  command: string;
  args: string[];
  description: string;
  permissions: Permission[];
  timeoutMs?: number;
}

export function externalEnabled(): boolean {
  return process.env.MONTAGE_EXT_EXTERNAL === "1";
}

export async function loadAllowlist(): Promise<Record<string, ExternalEntry>> {
  const file = process.env.MONTAGE_EXT_ALLOWLIST;
  if (!externalEnabled() || !file) return {};
  const abs = path.resolve(file);
  if (isPathInside(abs, workspaceRoot())) {
    throw new EngineError("FORBIDDEN_PATH", "قائمة السماح يجب أن تقع خارج مساحة العمل");
  }
  let raw: { entries?: Record<string, Partial<ExternalEntry>> };
  try {
    raw = JSON.parse(await fsp.readFile(abs, "utf-8"));
  } catch {
    throw new EngineError("DEPENDENCY_MISSING", "تعذّرت قراءة قائمة السماح للتنفيذ الخارجي", "تحقق من MONTAGE_EXT_ALLOWLIST (JSON: {entries:{id:{command,args,permissions}}}).");
  }
  const out: Record<string, ExternalEntry> = {};
  for (const [id, e] of Object.entries(raw.entries ?? {})) {
    if (!/^[a-z][a-z0-9_]{2,47}$/.test(id) || typeof e.command !== "string" || !path.isAbsolute(e.command)) continue; // مسارات مطلقة فقط
    out[id] = {
      command: e.command,
      args: Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === "string") : [],
      description: typeof e.description === "string" ? e.description : "",
      permissions: Array.isArray(e.permissions) ? (e.permissions as Permission[]) : [],
      timeoutMs: typeof e.timeoutMs === "number" ? e.timeoutMs : undefined,
    };
  }
  return out;
}

export async function getExternalEntry(id: string): Promise<ExternalEntry | undefined> {
  return (await loadAllowlist())[id];
}

const SAFE_ENV_KEYS = ["PATH", "LANG", "LC_ALL", "TZ", "SYSTEMROOT"];

export async function runExternal(
  entryId: string,
  input: Record<string, unknown>,
  opts: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }
): Promise<{ output: unknown; stderr: string; sandbox: string }> {
  if (!externalEnabled()) {
    throw new EngineError("UNSUPPORTED", "التنفيذ الخارجي معطّل", "اضبط MONTAGE_EXT_EXTERNAL=1 و MONTAGE_EXT_ALLOWLIST في بيئة الخادم (بقرار المالك فقط).");
  }
  const entry = await getExternalEntry(entryId);
  if (!entry) throw new EngineError("DEPENDENCY_MISSING", `الإدخال الخارجي غير مُدرج في قائمة السماح: ${entryId}`);
  planSandbox(entry.command, entry.args); // فحص مبكر: يرمي UNSUPPORTED قبل إنشاء أي شيء إن لم يتوفر عزل والسياسة تطلبه
  const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "montage_ext_"));
  const plan = planSandbox(entry.command, entry.args, cwd);
  const env = {} as NodeJS.ProcessEnv;
  for (const k of SAFE_ENV_KEYS) if (process.env[k]) env[k] = process.env[k];
  const timeoutMs = Math.min(opts.timeoutMs, entry.timeoutMs ?? opts.timeoutMs);
  try {
    return await new Promise((resolve, reject) => {
      const proc = spawn(plan.command, plan.args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let over = false;
      let why: "timeout" | "cancel" | null = null;
      const kill = (w: "timeout" | "cancel") => {
        if (why) return;
        why = w;
        proc.kill("SIGKILL");
      };
      const timer = setTimeout(() => kill("timeout"), timeoutMs);
      const onAbort = () => kill("cancel");
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      proc.stdout.on("data", (b: Buffer) => {
        if (out.length + b.length > opts.maxOutputBytes) {
          over = true;
          kill("cancel");
        } else out += b.toString("utf-8");
      });
      proc.stderr.on("data", (b: Buffer) => (err = (err + b.toString("utf-8")).slice(-4000)));
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(new EngineError("DEPENDENCY_MISSING", `تعذّر تشغيل البرنامج الخارجي: ${e.message}`));
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        if (over) return reject(new EngineError("LIMIT_EXCEEDED", "مخرجات البرنامج الخارجي تتجاوز الحد"));
        if (why === "timeout") return reject(new EngineError("TIMEOUT", `تجاوز البرنامج الخارجي المهلة (${timeoutMs}ms)`));
        if (why === "cancel") return reject(new EngineError("CANCELLED", "أُلغي التنفيذ الخارجي"));
        if (code !== 0) return reject(new EngineError("EXECUTION_FAILED", `انتهى البرنامج الخارجي بالرمز ${code}`, err.slice(-300) || undefined));
        try {
          resolve({ output: JSON.parse(out), stderr: err, sandbox: `${plan.kind}: ${plan.note}` });
        } catch {
          reject(new EngineError("EXECUTION_FAILED", "مخرجات البرنامج الخارجي ليست JSON صالحاً"));
        }
      });
      proc.stdin.on("error", () => {});
      proc.stdin.end(JSON.stringify(input));
    });
  } finally {
    await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
