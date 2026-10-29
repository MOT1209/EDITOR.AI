// ====================================================================
// صيغة حزمة الإضافة (Extension Package) — موثّقة في docs/EXTENSIONS.md
//
// حزمة = بيان (manifest) + ملفات نصية اختيارية (instructions.md ...).
// تُتداول إما كمجلد على القرص (manifest.json + ملفاته) أو كحزمة JSON واحدة
// {format:"montage-extension", formatVersion:1, kind, manifest, files} للاستيراد/التصدير.
//
// البيان بيانات خالصة: لا يحمل شيفرة قابلة للتنفيذ. التنفيذ إما عبر سجل
// إجراءات داخلية معتمد، أو نصوص تعليمات لنموذج، أو مدخل مسمّى في قوائم يتحكم بها المالك.
// ====================================================================
import { createHash } from "crypto";
import { z } from "zod";
import { isSemver, isValidRange } from "./semver";
import { lintSchema, EMPTY_OBJECT_SCHEMA, type ObjectSchema } from "./schema";
import { SignatureSchema, type PackageSignature } from "./signing";

export const PACKAGE_FORMAT = "montage-extension" as const;
export const FORMAT_VERSION = 1 as const;
/** إصدار المنصة الذي تُفحص التوافقية مقابله (يُزامَن مع SERVER_VERSION في MCP). */
export const PLATFORM_VERSION = "0.2.0";

export const ID_RE = /^[a-z][a-z0-9_]{2,47}$/;
/** بادئة اسم التشغيل (مهارة في SkillManager / أداة في MCP) — تمنع تصادم المدمج بنيوياً. */
export const RUNTIME_PREFIX = "ext_";
export const runtimeName = (id: string) => `${RUNTIME_PREFIX}${id}`;

export const PERMISSIONS = [
  "project.read", // قراءة مشاريع مساحة العمل
  "project.write", // تعديل مشروع (يتطلب موافقة)
  "render.export", // تصدير فيديو كامل (مكلف زمنياً؛ يتطلب موافقة)
  "media.read", // تحليل وسائط المشروع (ffprobe/ffmpeg ببنية ثابتة)
  "skills.run", // تشغيل مهارات/مسارات مدمجة
  "ai.invoke", // استدعاء نموذج مدفوع (يمرّ عبر ضابط التكلفة)
  "exec.external", // تشغيل برنامج مُدرج في قائمة المالك فقط
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const CATEGORIES = ["analysis", "editing", "audio", "visual", "text", "generation", "export", "utility"] as const;

const jsonValue: z.ZodType = z.lazy(() => z.union([z.string().max(5000), z.number(), z.boolean(), z.null(), z.array(jsonValue).max(100), z.record(z.string(), jsonValue)]));

const objectSchema = z.custom<ObjectSchema>((v) => lintSchema(v).length === 0 && (v as ObjectSchema).type === "object", { message: "مخطط كائن غير صالح" });

const common = {
  id: z.string().regex(ID_RE, "id: snake_case صغيرة، 3-48 حرفاً، تبدأ بحرف"),
  version: z.string().refine(isSemver, "version: major.minor.patch"),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().regex(/^[\p{L}\p{N}_-]{1,30}$/u)).max(12).default([]),
  author: z.string().max(80).default(""),
  license: z.string().max(40).optional(),
  stability: z.enum(["stable", "experimental"]).default("experimental"),
  compat: z
    .object({
      formatVersion: z.literal(FORMAT_VERSION),
      montage: z.string().refine(isValidRange, "نطاق إصدار غير صالح").default(">=0.2.0"),
    })
    .default({ formatVersion: FORMAT_VERSION, montage: ">=0.2.0" }),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
  dependencies: z
    .object({
      skills: z.array(z.string().max(64)).max(20).default([]),
      actions: z.array(z.string().max(64)).max(20).default([]),
      native: z.array(z.string().max(64)).max(5).default([]),
    })
    .default({ skills: [], actions: [], native: [] }),
  config: z
    .object({ schema: objectSchema.default(EMPTY_OBJECT_SCHEMA), defaults: z.record(z.string(), jsonValue).default({}) })
    .default({ schema: EMPTY_OBJECT_SCHEMA, defaults: {} }),
  limits: z
    .object({ timeoutMs: z.number().int().min(500).max(120_000).default(30_000), maxOutputBytes: z.number().int().min(1024).max(1_000_000).default(200_000) })
    .default({ timeoutMs: 30_000, maxOutputBytes: 200_000 }),
  input: objectSchema.default(EMPTY_OBJECT_SCHEMA),
  output: objectSchema.default(EMPTY_OBJECT_SCHEMA),
};

/** قيم الوسائط: حرف ثابت أو إشارة {{input.x}} / {{steps.<i>.<key>}} — بلا تعبيرات ولا شيفرة. */
const argValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
export const ArgMap = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,59}$/), argValue).default({});

const skillExecution = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    instructionsFile: z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/).default("instructions.md"),
    temperature: z.number().min(0).max(1).default(0.3),
    maxTokens: z.number().int().min(64).max(4096).default(1024),
  }),
  z.object({
    type: z.literal("workflow"),
    steps: z
      .array(
        z.object({
          use: z.string().regex(/^(skill|action):[A-Za-z0-9_.]{1,64}$/),
          with: ArgMap,
          optional: z.boolean().default(false),
        })
      )
      .min(1)
      .max(12),
  }),
  z.object({ type: z.literal("native"), entry: z.string().regex(/^[a-z][a-z0-9_]{2,47}$/) }),
  z.object({ type: z.literal("external"), entry: z.string().regex(/^[a-z][a-z0-9_]{2,47}$/) }),
]);

const toolExecution = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("declarative"),
    action: z.string().regex(/^[a-z]+\.[a-z_]+$/),
    args: ArgMap,
  }),
  z.object({ type: z.literal("executable"), entry: z.string().regex(/^[a-z][a-z0-9_]{2,47}$/) }),
]);

const integrity = z.object({ algorithm: z.literal("sha256"), digest: z.string().regex(/^[a-f0-9]{64}$/) }).optional();

export const SkillManifestSchema = z.object({ kind: z.literal("skill"), ...common, execution: skillExecution, integrity });
export const ToolManifestSchema = z.object({
  kind: z.literal("tool"),
  ...common,
  /** يُعلن لعملاء MCP: الأداة للقراءة فقط؟ تُشتق عند الاستدعاء من خطورة الإجراء ولا تُقبل من البيان. */
  requiresApproval: z.boolean().default(false),
  execution: toolExecution,
  integrity,
});
export const ManifestSchema = z.discriminatedUnion("kind", [SkillManifestSchema, ToolManifestSchema]);

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type ToolManifest = z.infer<typeof ToolManifestSchema>;
export type Manifest = SkillManifest | ToolManifest;
export type ExtensionKind = Manifest["kind"];

export interface ExtensionPackage {
  format: typeof PACKAGE_FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  kind: ExtensionKind;
  manifest: Manifest;
  files: Record<string, string>;
  /** توقيع Ed25519 اختياري على مستوى الحزمة (signing.ts) — خارج البيان فلا يغيّر البصمة. */
  signature?: PackageSignature;
}

export const FILE_LIMITS = { maxFiles: 8, maxFileBytes: 64_000, maxPackageBytes: 256_000 } as const;
const FILE_NAME_RE = /^[A-Za-z0-9_.-]{1,60}$/;

export function parseManifest(raw: unknown): { ok: true; manifest: Manifest } | { ok: false; errors: string[] } {
  const r = ManifestSchema.safeParse(raw);
  if (r.success) return { ok: true, manifest: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).slice(0, 25) };
}

/** JSON قانوني (مفاتيح مرتّبة) لحساب بصمة ثابتة. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** بصمة SHA-256 للبيان (دون حقل integrity) + الملفات. */
export function computeDigest(manifest: Manifest, files: Record<string, string>): string {
  const { integrity: _i, ...rest } = manifest as Manifest & { integrity?: unknown };
  return createHash("sha256").update(canonicalJson({ manifest: rest, files })).digest("hex");
}

export function withIntegrity(manifest: Manifest, files: Record<string, string>): Manifest {
  return { ...manifest, integrity: { algorithm: "sha256", digest: computeDigest(manifest, files) } } as Manifest;
}

export function verifyIntegrity(manifest: Manifest, files: Record<string, string>): "ok" | "missing" | "mismatch" {
  if (!manifest.integrity) return "missing";
  return manifest.integrity.digest === computeDigest(manifest, files) ? "ok" : "mismatch";
}

export function checkFiles(files: unknown): { ok: true; files: Record<string, string> } | { ok: false; errors: string[] } {
  if (files === undefined) return { ok: true, files: {} };
  if (!files || typeof files !== "object" || Array.isArray(files)) return { ok: false, errors: ["files: كائن {اسم: نص} مطلوب"] };
  const entries = Object.entries(files as Record<string, unknown>);
  const errors: string[] = [];
  if (entries.length > FILE_LIMITS.maxFiles) errors.push(`files: حتى ${FILE_LIMITS.maxFiles} ملفات`);
  let total = 0;
  const out: Record<string, string> = {};
  for (const [name, content] of entries) {
    if (!FILE_NAME_RE.test(name) || name === "manifest.json" || name.startsWith(".")) errors.push(`files.${name}: اسم ملف غير مسموح`);
    else if (typeof content !== "string") errors.push(`files.${name}: النص فقط`);
    else if (Buffer.byteLength(content) > FILE_LIMITS.maxFileBytes) errors.push(`files.${name}: أكبر من ${FILE_LIMITS.maxFileBytes} بايت`);
    else {
      total += Buffer.byteLength(content);
      out[name] = content;
    }
  }
  if (total > FILE_LIMITS.maxPackageBytes) errors.push("files: حجم الحزمة يتجاوز الحد");
  return errors.length ? { ok: false, errors } : { ok: true, files: out };
}

/** يفكّ حزمة JSON مستوردة (لا يثق بشيء قبل التحقق). */
export function parsePackage(raw: unknown): { ok: true; pkg: ExtensionPackage } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["الحزمة يجب أن تكون كائن JSON"] };
  const r = raw as Record<string, unknown>;
  if (r.format !== PACKAGE_FORMAT) return { ok: false, errors: [`format يجب أن يكون «${PACKAGE_FORMAT}»`] };
  if (r.formatVersion !== FORMAT_VERSION) return { ok: false, errors: [`formatVersion غير مدعوم (المدعوم ${FORMAT_VERSION}) — حدّث المنصة أو حوّل الحزمة`] };
  const m = parseManifest(r.manifest);
  if (!m.ok) return m;
  if (r.kind !== m.manifest.kind) return { ok: false, errors: ["kind لا يطابق manifest.kind"] };
  const f = checkFiles(r.files);
  if (!f.ok) return f;
  let signature: PackageSignature | undefined;
  if (r.signature !== undefined) {
    const sg = SignatureSchema.safeParse(r.signature);
    if (!sg.success) return { ok: false, errors: ["signature: صيغة توقيع غير صالحة"] };
    signature = sg.data;
  }
  return { ok: true, pkg: { format: PACKAGE_FORMAT, formatVersion: FORMAT_VERSION, kind: m.manifest.kind, manifest: m.manifest, files: f.files, ...(signature ? { signature } : {}) } };
}
