// فحص الحزمة قبل الحفظ/التفعيل: بنية، توافقية، تكامل، تبعيات، صلاحيات، مراجع الوسائط.
import { buildSkillManager } from "@/lib/skills";
import { getAction } from "./actions";
import { externalEnabled, loadAllowlist, type ExternalEntry } from "./external";
import { PLATFORM_VERSION, FORMAT_VERSION, runtimeName, verifyIntegrity, type ExtensionPackage, type Permission, type SkillManifest, type ToolManifest } from "./manifest";
import { getNativeEntry } from "./native";
import { lintSchema } from "./schema";
import { satisfiesRange } from "./semver";
import { refsOf } from "./template";

export interface Issue {
  level: "error" | "warn";
  code: "SCHEMA" | "COMPAT" | "INTEGRITY" | "DEPENDENCY" | "PERMISSION" | "ARGS" | "FILES" | "EXTERNAL";
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: Issue[];
  requiredPermissions: Permission[];
}

type Dep = { skills: Set<string>; actions: Set<string>; native: Set<string> };

/** الصلاحيات التي يتطلبها التنفيذ فعلياً (تُقارَن بالمعلنة وبالممنوحة). */
export async function requiredPermissions(pkg: ExtensionPackage): Promise<Permission[]> {
  const req = new Set<Permission>();
  const m = pkg.manifest;
  if (m.kind === "skill") {
    const ex = m.execution;
    if (ex.type === "prompt") req.add("ai.invoke");
    else if (ex.type === "workflow") {
      for (const s of ex.steps) {
        if (s.use.startsWith("skill:")) req.add("skills.run");
        else getAction(s.use.slice(7))?.permissions.forEach((p) => req.add(p));
      }
    } else if (ex.type === "native") getNativeEntry(ex.entry)?.permissions.forEach((p) => req.add(p));
    else {
      req.add("exec.external");
      (await loadAllowlist().catch((): Record<string, ExternalEntry> => ({})))[ex.entry]?.permissions.forEach((p) => req.add(p));
    }
  } else {
    const ex = m.execution;
    if (ex.type === "declarative") getAction(ex.action)?.permissions.forEach((p) => req.add(p));
    else {
      req.add("exec.external");
      (await loadAllowlist().catch((): Record<string, ExternalEntry> => ({})))[ex.entry]?.permissions.forEach((p) => req.add(p));
    }
  }
  return [...req];
}

function checkArgs(
  where: string,
  action: NonNullable<ReturnType<typeof getAction>>,
  args: Record<string, string | number | boolean | null>,
  inputProps: Set<string>,
  stepIndex: number,
  issues: Issue[]
) {
  const props = new Set(Object.keys(action.input.properties));
  for (const k of Object.keys(args)) {
    if (!props.has(k)) issues.push({ level: "error", code: "ARGS", message: `${where}: الوسيط «${k}» غير معرّف في الإجراء ${action.id}` });
  }
  for (const r of action.input.required ?? []) {
    if (!(r in args)) issues.push({ level: "error", code: "ARGS", message: `${where}: الوسيط المطلوب «${r}» مفقود للإجراء ${action.id}` });
  }
  checkRefs(where, args, inputProps, stepIndex, issues);
}

function checkRefs(where: string, args: Record<string, string | number | boolean | null>, inputProps: Set<string>, stepIndex: number, issues: Issue[]) {
  for (const ref of refsOf(args)) {
    const [root, second] = ref.split(".");
    if (root === "input") {
      if (!second || !inputProps.has(second)) issues.push({ level: "error", code: "ARGS", message: `${where}: المرجع {{${ref}}} يشير لحقل غير معرّف في input` });
    } else if (root === "steps") {
      const n = Number(second);
      if (!Number.isInteger(n) || n < 0 || n >= stepIndex) issues.push({ level: "error", code: "ARGS", message: `${where}: المرجع {{${ref}}} يجب أن يشير لخطوة سابقة` });
    } else issues.push({ level: "error", code: "ARGS", message: `${where}: مرجع غير مدعوم {{${ref}}}` });
  }
}

export async function validatePackage(pkg: ExtensionPackage): Promise<ValidationReport> {
  const issues: Issue[] = [];
  const m = pkg.manifest;
  const err = (code: Issue["code"], message: string) => issues.push({ level: "error", code, message });
  const warn = (code: Issue["code"], message: string) => issues.push({ level: "warn", code, message });

  // بنية المخططات
  for (const [label, sch] of [["input", m.input], ["output", m.output], ["config.schema", m.config.schema]] as const) {
    for (const i of lintSchema(sch, label)) err("SCHEMA", i);
  }

  // توافقية
  if (m.compat.formatVersion !== FORMAT_VERSION) err("COMPAT", `formatVersion ${m.compat.formatVersion} غير مدعوم`);
  try {
    if (!satisfiesRange(PLATFORM_VERSION, m.compat.montage)) err("COMPAT", `يتطلب المنصة ${m.compat.montage} والمثبّت ${PLATFORM_VERSION}`);
  } catch (e) {
    err("COMPAT", (e as Error).message);
  }

  // تكامل
  const integ = verifyIntegrity(m, pkg.files);
  if (integ === "mismatch") err("INTEGRITY", "بصمة SHA-256 لا تطابق المحتوى — الحزمة عُدّلت بعد توقيعها أو تالفة");
  else if (integ === "missing") warn("INTEGRITY", "لا توجد بصمة سلامة (integrity) في الحزمة");

  // تبعيات
  const builtin = new Set(buildSkillManager().list().map((s) => s.name));
  const dep: Dep = { skills: new Set(m.dependencies.skills), actions: new Set(m.dependencies.actions), native: new Set(m.dependencies.native) };
  for (const s of dep.skills) if (!builtin.has(s)) err("DEPENDENCY", `تبعية مهارة مفقودة: ${s}`);
  for (const a of dep.actions) if (!getAction(a)) err("DEPENDENCY", `تبعية إجراء مفقودة: ${a}`);
  for (const n of dep.native) if (!getNativeEntry(n)) err("DEPENDENCY", `تبعية أصلية مفقودة: ${n}`);

  const inputProps = new Set(Object.keys(m.input.properties));

  if (m.kind === "skill") {
    const ex = (m as SkillManifest).execution;
    if (ex.type === "prompt") {
      if (!pkg.files[ex.instructionsFile]) err("FILES", `ملف التعليمات «${ex.instructionsFile}» غير موجود في الحزمة`);
      else if (!pkg.files[ex.instructionsFile].trim()) err("FILES", "ملف التعليمات فارغ");
      if (Object.keys(m.output.properties).length === 0) warn("SCHEMA", "لا مخطط مخرجات — لن يُتحقق من شكل ناتج النموذج");
    } else if (ex.type === "workflow") {
      ex.steps.forEach((s, i) => {
        const where = `الخطوة ${i}`;
        if (s.use.startsWith("skill:")) {
          const name = s.use.slice(6);
          if (!builtin.has(name)) err("DEPENDENCY", `${where}: مهارة مدمجة غير موجودة «${name}»`);
          if (!dep.skills.has(name)) warn("DEPENDENCY", `${where}: «${name}» غير مذكورة في dependencies.skills`);
          checkRefs(where, s.with, inputProps, i, issues);
        } else {
          const a = getAction(s.use.slice(7));
          if (!a) err("DEPENDENCY", `${where}: إجراء غير معروف «${s.use.slice(7)}» (مرفوض)`);
          else {
            checkArgs(where, a, s.with, inputProps, i, issues);
            if (!dep.actions.has(a.id)) warn("DEPENDENCY", `${where}: «${a.id}» غير مذكور في dependencies.actions`);
          }
        }
      });
    } else if (ex.type === "native") {
      if (!getNativeEntry(ex.entry)) err("DEPENDENCY", `الإدخال الأصلي غير مسجّل في التطبيق: ${ex.entry}`);
    } else {
      await externalChecks(ex.entry, err, warn);
    }
  } else {
    const ex = (m as ToolManifest).execution;
    if (ex.type === "declarative") {
      const a = getAction(ex.action);
      if (!a) err("DEPENDENCY", `إجراء غير معروف «${ex.action}» — الأدوات الإعلانية تنفّذ إجراءات السجل فقط`);
      else {
        checkArgs("args", a, ex.args, inputProps, 0, issues);
        if (!dep.actions.has(a.id)) warn("DEPENDENCY", `«${a.id}» غير مذكور في dependencies.actions`);
        if (a.risk !== "read") warn("PERMISSION", `الإجراء ${a.id} بخطورة ${a.risk}: سيطلب موافقة المستخدم عند كل استدعاء`);
      }
    } else {
      await externalChecks(ex.entry, err, warn);
    }
  }

  // صلاحيات
  const required = await requiredPermissions(pkg);
  const missing = required.filter((p) => !m.permissions.includes(p));
  if (missing.length) err("PERMISSION", `صلاحيات يتطلبها التنفيذ وغير معلنة في permissions: ${missing.join(", ")}`);
  const extra = m.permissions.filter((p) => !required.includes(p));
  if (extra.length) warn("PERMISSION", `صلاحيات معلنة لا يحتاجها التنفيذ: ${extra.join(", ")}`);

  return { ok: !issues.some((i) => i.level === "error"), issues, requiredPermissions: required };
}

async function externalChecks(entry: string, err: (c: Issue["code"], m: string) => void, warn: (c: Issue["code"], m: string) => void) {
  if (!externalEnabled()) {
    warn("EXTERNAL", "التنفيذ الخارجي معطّل على هذا الخادم (MONTAGE_EXT_EXTERNAL) — لن تعمل الإضافة حتى يفعّله المالك");
    return;
  }
  try {
    if (!(await loadAllowlist())[entry]) err("EXTERNAL", `الإدخال «${entry}» غير مُدرج في قائمة سماح المالك`);
  } catch (e) {
    err("EXTERNAL", (e as Error).message);
  }
}

export { runtimeName };
