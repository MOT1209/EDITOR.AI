// جسر المهارات المخصّصة إلى إطار lib/skills الحالي (لا إطار ثانٍ):
// كل مهارة مخصّصة مفعّلة تصبح BaseSkill عادية باسم ext_<id> في SkillManager،
// فتعمل مع Workflow والمقاييس وسجل الأخطاء كأي مهارة مدمجة.
import { BaseSkill } from "@/lib/skills/BaseSkill";
import { buildSkillManager } from "@/lib/skills";
import type { SkillManager } from "@/lib/skills/SkillManager";
import type { MediaDocument, SkillCategory, SkillContext } from "@/lib/skills/types";
import { runtimeName, type SkillManifest } from "./manifest";
import { executeSkill } from "./runtime";
import { listStates, readVersion, type ExtensionState } from "./store";
import { validatePackage } from "./validate";
import type { ExtensionPackage } from "./manifest";
import { externalEnabled } from "./external";

class DynamicSkill extends BaseSkill {
  readonly name: string;
  readonly description: string;
  readonly category: SkillCategory;
  readonly inputSpec: Record<string, string>;
  readonly outputSpec: Record<string, string>;

  constructor(private readonly pkg: ExtensionPackage, private readonly state: ExtensionState) {
    super();
    const m = pkg.manifest as SkillManifest;
    this.name = runtimeName(m.id);
    this.description = m.description;
    this.category = m.category;
    this.inputSpec = Object.fromEntries(Object.entries(m.input.properties).map(([k, f]) => [k, f.type]));
    this.outputSpec = Object.fromEntries(Object.entries(m.output.properties).map(([k, f]) => [k, f.type]));
  }

  protected async execute(input: MediaDocument, ctx: SkillContext): Promise<Record<string, unknown>> {
    const m = this.pkg.manifest as SkillManifest;
    const picked: Record<string, unknown> = {};
    for (const k of Object.keys(m.input.properties)) if (input[k] !== undefined) picked[k] = input[k];
    // approve غير متاح داخل SkillManager: الإجراءات المكلفة/الكاتبة والبرامج الخارجية تُرفض هنا بأمان.
    const res = await executeSkill(this.pkg, picked, { granted: this.state.grants, config: this.state.config, signal: ctx.signal });
    for (const l of res.logs) this.log("info", l);
    for (const w of res.warnings) this.log("warn", w);
    if (!res.ok) throw new Error(res.error?.message ?? "فشل غير معروف");
    // ملاحظة: الإخراج يُدمج في المستند المشترك؛ نضعه تحت اسم المهارة لمنع الكتابة فوق حقول أخرى.
    return { [this.name]: res.output, [`${this.name}_provenance`]: res.provenance };
  }
}

/** مدير المهارات الكامل: المدمجة + المخصّصة المفعّلة والصالحة والمُنحت صلاحياتها. */
export async function buildExtendedSkillManager(): Promise<{ manager: SkillManager; skipped: Array<{ id: string; reason: string }> }> {
  const manager = buildSkillManager();
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const st of await listStates("skill")) {
    if (!st.enabled) continue;
    try {
      const pkg = await readVersion("skill", st.id, st.activeVersion);
      const report = await validatePackage(pkg);
      if (!report.ok) { skipped.push({ id: st.id, reason: report.issues.find((i) => i.level === "error")?.message ?? "غير صالحة" }); continue; }
      const missing = report.requiredPermissions.filter((p) => !st.grants.includes(p));
      if (missing.length) { skipped.push({ id: st.id, reason: `صلاحيات غير ممنوحة: ${missing.join(", ")}` }); continue; }
      const t = pkg.manifest.execution.type;
      if ((t === "external") && !externalEnabled()) { skipped.push({ id: st.id, reason: "التنفيذ الخارجي معطّل على الخادم" }); continue; }
      if (manager.has(runtimeName(st.id))) { skipped.push({ id: st.id, reason: "تعارض اسم" }); continue; }
      manager.register(new DynamicSkill(pkg, st));
    } catch (e) {
      skipped.push({ id: st.id, reason: (e as Error).message });
    }
  }
  return { manager, skipped };
}
