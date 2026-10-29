// ====================================================================
// طبقة الخدمة: كل عمليات إدارة الإضافات (يستخدمها API الواجهة وخادم MCP معاً).
// ====================================================================
import { EngineError } from "@/lib/engine/errors";
import { buildSkillManager } from "@/lib/skills";
import { externalEnabled } from "./external";
import {
  PERMISSIONS, PLATFORM_VERSION, PACKAGE_FORMAT, FORMAT_VERSION, parsePackage, parseManifest, checkFiles, withIntegrity, computeDigest, runtimeName,
  type ExtensionKind, type ExtensionPackage, type Manifest, type Permission,
} from "./manifest";
import { executeSkill, invokeTool, type ApproveFn, type ExecResult } from "./runtime";
import {
  appendRun, getState, listStates, mustGetState, patchState, readActivePackage, readRuns, readVersion, removeExtension, saveVersion,
  type ExtensionState, type Origin, type RunRecord,
} from "./store";
import { validatePackage, type ValidationReport } from "./validate";

export type ExtensionStatus = "enabled" | "disabled" | "needs_grant" | "invalid" | "incompatible" | "unavailable";

export interface ExtensionSummary {
  id: string;
  kind: ExtensionKind;
  runtimeName: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  version: string;
  stability: string;
  origin: Origin | "builtin";
  /** التصنيف المعروض: builtin | user | imported | experimental (التجريبي يغلب على user/imported). */
  label: "builtin" | "user" | "imported" | "experimental";
  executionType: string;
  status: ExtensionStatus;
  enabled: boolean;
  permissions: Permission[];
  grants: Permission[];
  versions: string[];
  lastRun?: RunRecord;
  lastTest?: ExtensionState["lastTest"];
  issues: ValidationReport["issues"];
  updatedAt: string;
}

const norm = (s: string) => s.toLowerCase();

async function summarize(state: ExtensionState, pkg: ExtensionPackage): Promise<ExtensionSummary> {
  const report = await validatePackage(pkg);
  const m = pkg.manifest;
  const missingGrant = report.requiredPermissions.filter((p) => !state.grants.includes(p));
  let status: ExtensionStatus;
  if (report.issues.some((i) => i.code === "COMPAT" && i.level === "error")) status = "incompatible";
  else if (!report.ok) status = "invalid";
  else if (!state.enabled) status = "disabled";
  else if (missingGrant.length) status = "needs_grant";
  else if (m.execution.type === "external" || m.execution.type === "executable") status = externalEnabled() ? "enabled" : "unavailable";
  else status = "enabled";
  return {
    id: m.id, kind: m.kind, runtimeName: runtimeName(m.id), name: m.name, description: m.description, category: m.category, tags: m.tags,
    author: m.author, version: state.activeVersion, stability: m.stability, origin: state.origin,
    label: m.stability === "experimental" ? "experimental" : state.origin,
    executionType: m.execution.type, status, enabled: state.enabled, permissions: m.permissions, grants: state.grants,
    versions: state.versions.map((v) => v.version), lastRun: state.lastRun, lastTest: state.lastTest, issues: report.issues, updatedAt: state.updatedAt,
  };
}

export interface ListFilter {
  q?: string;
  category?: string;
  tag?: string;
  label?: string;
  status?: string;
}

export async function listExtensions(kind: ExtensionKind, f: ListFilter = {}): Promise<ExtensionSummary[]> {
  const out: ExtensionSummary[] = [];
  for (const st of await listStates(kind)) {
    try {
      out.push(await summarize(st, await readVersion(kind, st.id, st.activeVersion)));
    } catch {
      /* حزمة تالفة: تُتخطى في القائمة (تظهر في التدقيق فقط) */
    }
  }
  return out.filter((e) => {
    if (f.category && e.category !== f.category) return false;
    if (f.tag && !e.tags.map(norm).includes(norm(f.tag))) return false;
    if (f.label && e.label !== f.label) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.q) {
      const q = norm(f.q);
      if (![e.id, e.name, e.description, ...e.tags].some((s) => norm(s).includes(q))) return false;
    }
    return true;
  });
}

export async function getExtensionDetail(kind: ExtensionKind, id: string) {
  const { state, pkg } = await readActivePackage(kind, id);
  const [summary, report, runs] = await Promise.all([summarize(state, pkg), validatePackage(pkg), readRuns(kind, id, 30)]);
  return { summary, package: pkg, state, validation: report, runs, versions: state.versions };
}

// ---------------------------------------------------------------- إنشاء/تحديث/استيراد
function toPackage(raw: unknown, kindHint?: ExtensionKind): ExtensionPackage {
  // يقبل حزمة كاملة أو {manifest, files}.
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const candidate = obj.format ? obj : { format: PACKAGE_FORMAT, formatVersion: FORMAT_VERSION, kind: (obj.manifest as { kind?: string } | undefined)?.kind ?? kindHint, manifest: obj.manifest, files: obj.files };
  const r = parsePackage(candidate);
  if (!r.ok) throw new EngineError("INVALID_INPUT", `حزمة غير صالحة: ${r.errors.slice(0, 8).join("؛ ")}`, "راجع docs/EXTENSIONS.md لصيغة الحزمة.");
  if (kindHint && r.pkg.kind !== kindHint) throw new EngineError("INVALID_INPUT", `نوع الحزمة ${r.pkg.kind} لا يطابق المتوقع ${kindHint}`);
  return { ...r.pkg, manifest: withIntegrity(r.pkg.manifest, r.pkg.files) };
}

export async function validateRaw(raw: unknown, kindHint?: ExtensionKind) {
  try {
    const pkg = toPackage(raw, kindHint);
    return { parsed: true, ...(await validatePackage(pkg)) };
  } catch (e) {
    if (e instanceof EngineError) return { parsed: false, ok: false, issues: [{ level: "error" as const, code: "SCHEMA" as const, message: e.message }], requiredPermissions: [] as Permission[] };
    throw e;
  }
}

export async function saveExtension(raw: unknown, opts: { kind?: ExtensionKind; origin: Origin; update: boolean; note?: string }): Promise<{ summary: ExtensionSummary; validation: ValidationReport }> {
  const pkg = toPackage(raw, opts.kind);
  const report = await validatePackage(pkg);
  if (!report.ok) {
    throw new EngineError("INVALID_INPUT", `فشل التحقق: ${report.issues.filter((i) => i.level === "error").map((i) => i.message).slice(0, 6).join("؛ ")}`, "أصلح الأخطاء ثم أعد المحاولة. لم يُحفظ شيء.");
  }
  // تحديث إضافة قائمة يحافظ على أصلها؛ استيراد فوق إضافة موجودة يُرفض ما لم يكن تحديثاً صريحاً لنفس الأصل.
  const existing = await getState(pkg.kind, pkg.manifest.id);
  if (existing && opts.update && existing.origin !== opts.origin && opts.origin === "imported") {
    throw new EngineError("CONFLICT", `«${pkg.manifest.id}» أُنشئت محلياً — لا يُكتب عليها بحزمة مستوردة`, "غيّر معرّف الحزمة أو استورد باسم آخر.");
  }
  const state = await saveVersion(pkg, { origin: existing?.origin ?? opts.origin, note: opts.note, allowNewVersion: opts.update });
  return { summary: await summarize(state, await readVersion(pkg.kind, pkg.manifest.id, state.activeVersion)), validation: report };
}

export async function duplicateExtension(kind: ExtensionKind, id: string, newId: string): Promise<ExtensionSummary> {
  const { pkg } = await readActivePackage(kind, id);
  const m = { ...pkg.manifest, id: newId, name: `${pkg.manifest.name} (نسخة)`, version: "0.1.0" } as Manifest;
  const res = await saveExtension({ manifest: m, files: pkg.files }, { kind, origin: "user", update: false, note: `نسخة من ${id}@${pkg.manifest.version}` });
  return res.summary;
}

export async function exportExtension(kind: ExtensionKind, id: string, version?: string): Promise<ExtensionPackage> {
  const state = await mustGetState(kind, id);
  const pkg = await readVersion(kind, id, version ?? state.activeVersion);
  return { ...pkg, manifest: withIntegrity(pkg.manifest, pkg.files) };
}

// ---------------------------------------------------------------- الحالة والمنح والإصدارات
export async function grantPermissions(kind: ExtensionKind, id: string, perms: string[]): Promise<ExtensionSummary> {
  const { pkg } = await readActivePackage(kind, id);
  const valid = perms.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
  if (valid.length !== perms.length) throw new EngineError("INVALID_INPUT", "صلاحية غير معروفة");
  const undeclared = valid.filter((p) => !pkg.manifest.permissions.includes(p));
  if (undeclared.length) throw new EngineError("FORBIDDEN_PATH", `لا يُمنح ما لم يُعلنه البيان: ${undeclared.join(", ")}`);
  const st = await patchState(kind, id, (s) => ({ ...s, grants: [...new Set(valid)] }));
  return summarize(st, pkg);
}

export async function setConfig(kind: ExtensionKind, id: string, config: Record<string, unknown>): Promise<ExtensionSummary> {
  const { pkg } = await readActivePackage(kind, id);
  const merged = { ...pkg.manifest.config.defaults, ...config };
  const { validateAgainst } = await import("./schema");
  const r = validateAgainst(pkg.manifest.config.schema, merged);
  if (!r.ok) throw new EngineError("INVALID_INPUT", `إعدادات غير صالحة: ${r.errors.join("؛ ")}`);
  const st = await patchState(kind, id, (s) => ({ ...s, config }));
  return summarize(st, pkg);
}

export async function setEnabled(kind: ExtensionKind, id: string, enabled: boolean, opts: { acknowledgeUntested?: boolean } = {}): Promise<ExtensionSummary> {
  const { state, pkg } = await readActivePackage(kind, id);
  if (enabled) {
    const report = await validatePackage(pkg);
    if (!report.ok) throw new EngineError("INVALID_INPUT", `لا يمكن التفعيل: ${report.issues.filter((i) => i.level === "error")[0]?.message}`, "أصلح أخطاء التحقق أولاً.");
    const missing = report.requiredPermissions.filter((p) => !state.grants.includes(p));
    if (missing.length) throw new EngineError("APPROVAL_DENIED", `امنح الصلاحيات أولاً: ${missing.join(", ")}`);
    const tested = state.lastTest?.ok && state.lastTest.version === state.activeVersion;
    if (!tested && !opts.acknowledgeUntested) {
      throw new EngineError("CONFLICT", "لم تُختبر هذه النسخة بنجاح بعد", "شغّل اختباراً بمدخلات تجريبية ناجحاً، أو أكّد التفعيل دون اختبار (acknowledgeUntested).");
    }
  }
  const st = await patchState(kind, id, (s) => ({ ...s, enabled }));
  return summarize(st, pkg);
}

export async function activateVersion(kind: ExtensionKind, id: string, version: string): Promise<ExtensionSummary> {
  const state = await mustGetState(kind, id);
  if (!state.versions.some((v) => v.version === version)) throw new EngineError("NOT_FOUND", `الإصدار ${version} غير موجود`);
  const pkg = await readVersion(kind, id, version);
  const report = await validatePackage(pkg);
  if (!report.ok) throw new EngineError("INVALID_INPUT", `الإصدار ${version} غير صالح/غير متوافق: ${report.issues.filter((i) => i.level === "error")[0]?.message}`, "لم يتغيّر الإصدار الفعّال.");
  // تبديل الإصدار يلغي الاختبار السابق ويعطّل الإضافة حتى يُعاد اختبارها — لا تفعيل لنسخة غير مختبَرة ضمنياً.
  const st = await patchState(kind, id, (s) => ({ ...s, activeVersion: version, enabled: false, lastTest: undefined, grants: s.grants.filter((p) => pkg.manifest.permissions.includes(p)) }));
  return summarize(st, pkg);
}

export async function deleteExtension(kind: ExtensionKind, id: string): Promise<void> {
  await removeExtension(kind, id);
}

// ---------------------------------------------------------------- التشغيل والاختبار
export interface RunOptions {
  mode: "run" | "test" | "mcp";
  apiKey?: string;
  signal?: AbortSignal;
  approve?: ApproveFn;
}

/** يشغّل إضافة (مهارة أو أداة) ويسجّل النتيجة. mode=test يسمح بالتشغيل وهي معطّلة، لكنه لا يتجاوز المنح/الصلاحيات. */
export async function runExtension(kind: ExtensionKind, id: string, input: unknown, opts: RunOptions): Promise<ExecResult & { version: string }> {
  const { state, pkg } = await readActivePackage(kind, id);
  if (opts.mode !== "test" && !state.enabled) {
    throw new EngineError("UNSUPPORTED", `الإضافة «${id}» معطّلة`, "فعّلها من مدير الإضافات.");
  }
  const execOpts = { granted: state.grants, config: state.config, apiKey: opts.apiKey, signal: opts.signal, approve: opts.approve };
  const res = kind === "skill" ? await executeSkill(pkg, input, execOpts) : await invokeTool(pkg, input, execOpts);
  await appendRun(kind, id, {
    at: new Date().toISOString(), version: state.activeVersion, mode: opts.mode, ok: res.ok, durationMs: res.durationMs,
    provenance: res.provenance, code: res.error?.code, error: res.error?.message, logs: [...res.logs, ...res.warnings.map((w) => `⚠ ${w}`)],
  });
  return { ...res, version: state.activeVersion };
}

export async function listRuns(kind: ExtensionKind, id: string, limit = 50) {
  await mustGetState(kind, id);
  return readRuns(kind, id, limit);
}

// ---------------------------------------------------------------- مدمج (للقراءة فقط)
export function listBuiltinSkills() {
  return buildSkillManager().catalog().map((d) => ({
    id: d.name, runtimeName: d.name, kind: "skill" as const, name: d.name, description: d.description, category: d.category,
    origin: "builtin" as const, label: "builtin" as const, version: PLATFORM_VERSION, status: "enabled" as const, inputSpec: d.inputSpec, outputSpec: d.outputSpec,
  }));
}

export { checkFiles, parseManifest, computeDigest };
