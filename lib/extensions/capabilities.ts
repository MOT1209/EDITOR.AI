// قدرات البيئة المطلوبة (required capabilities): ما يحتاجه الامتداد من **المضيف** (ثنائيات/مفاتيح)
// بخلاف الصلاحيات (permissions) التي هي ما يُسمح له بفعله. تُعلَن في البيان وتُفحص على الخادم
// عند التفعيل والتشغيل (تدهور أنيق: القدرة المفقودة ⇒ DEPENDENCY_MISSING برسالة واضحة، لا نتيجة مختلقة).
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolveFfmpegPath } from "@/lib/server/ffmpeg-export";
import { resolvePython } from "@/lib/engine/plans";
import { CAPABILITIES, type Capability, type ExtensionPackage } from "./manifest";

export { CAPABILITIES, type Capability };

export const CAPABILITY_LABELS: Record<Capability, string> = {
  ffmpeg: "FFmpeg غير مثبت على الخادم",
  python: "Python غير متاح لمسار الوكلاء",
  "ai.chat": "لا مفتاح لنموذج المحادثة (OPENCODE_API_KEY أو ترويسة x-opencode-key)",
  workspace: "مساحة العمل غير قابلة للكتابة",
};

export interface CapabilityContext {
  /** مفتاح مُرسَل مع الطلب (يُعدّ توفراً لـ ai.chat). */
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
}

let ffmpegOk: boolean | null = null;
let pythonOk: boolean | null = null;

function probe(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { stdio: "ignore", timeout: 4000 }).status === 0;
  } catch {
    return false;
  }
}

export function hasCapability(c: Capability, ctx: CapabilityContext = {}): boolean {
  const env = ctx.env ?? process.env;
  switch (c) {
    case "ffmpeg":
      return (ffmpegOk ??= probe(resolveFfmpegPath(), ["-version"]));
    case "python":
      return (pythonOk ??= probe(resolvePython(), ["--version"]));
    case "ai.chat":
      return Boolean(ctx.apiKey || env.OPENCODE_API_KEY);
    case "workspace": {
      const root = env.MONTAGE_WORKSPACE;
      return !root || existsSync(root);
    }
  }
}

/** القدرات المفقودة من المعلنة (فارغة = كل شيء متاح). */
export function missingCapabilities(declared: readonly Capability[], ctx: CapabilityContext = {}): Capability[] {
  return declared.filter((c) => !hasCapability(c, ctx));
}

/** قدرات يستلزمها التنفيذ فعلياً — المُعلَنة يجب أن تغطيها (تحذير إن نقصت). */
export function impliedCapabilities(pkg: ExtensionPackage, actionCaps: (id: string) => Capability[] = () => []): Capability[] {
  const out = new Set<Capability>();
  const m = pkg.manifest;
  if (m.kind === "skill") {
    const ex = m.execution;
    if (ex.type === "prompt") out.add("ai.chat");
    if (ex.type === "workflow") for (const s of ex.steps) if (s.use.startsWith("action:")) actionCaps(s.use.slice(7)).forEach((c) => out.add(c));
  } else if (m.execution.type === "declarative") actionCaps(m.execution.action).forEach((c) => out.add(c));
  return [...out];
}

export function describeMissing(missing: Capability[]): string {
  return missing.map((c) => `${c}: ${CAPABILITY_LABELS[c]}`).join("؛ ");
}
