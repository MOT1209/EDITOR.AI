import { NextRequest, NextResponse } from "next/server";
import { buildExtendedSkillManager } from "@/lib/extensions/skills-bridge";
import type { MediaDocument } from "@/lib/skills";
import { skillProvenance } from "@/lib/skills/provenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// مفاتيح إعداد لا يحق للعميل ضبطها: توجيه الخادم لعنوان آخر (SSRF).
const FORBIDDEN_CONFIG_KEYS = ["apiBaseUrl", "endpoint"];

function safeConfig(config: unknown): Record<string, unknown> | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>).slice(0, 30)) {
    if (FORBIDDEN_CONFIG_KEYS.includes(k)) continue;
    if (["string", "number", "boolean"].includes(typeof v)) out[k] = typeof v === "string" ? v.slice(0, 500) : v;
  }
  return out;
}

// GET /api/skills            → فهرس كل Skills + Workflows + المقاييس
export async function GET() {
  const { manager: m, skipped } = await buildExtendedSkillManager(); // المدمجة + المخصّصة المفعّلة (ext_*)
  return NextResponse.json({
    skills: m.catalog(),
    skippedCustom: skipped,
    workflows: m.listWorkflows().map((w) => ({
      name: w.name,
      description: w.description,
      steps: w.list(),
    })),
    metrics: m.allMetrics(),
    errors: m.errorLog,
  });
}

interface RunBody {
  mode?: "skill" | "workflow";
  skill?: string;
  workflow?: string;
  document?: Partial<MediaDocument>;
  config?: Record<string, unknown>;
}

// POST /api/skills
//   { mode:"skill",    skill:"SceneDetectionSkill", document:{ duration } }
//   { mode:"workflow", workflow:"default",          document:{ duration } }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunBody;
    // مدير معزول لكل طلب: لا تتسرب إعدادات طلب إلى طلبات أخرى، ولا سجل أخطاء ينمو بلا حد.
    const { manager: m } = await buildExtendedSkillManager();
    const config = safeConfig(body.config);
    const doc: MediaDocument = { duration: 30, ...(body.document ?? {}) };

    if (body.mode === "skill") {
      if (!body.skill || !m.has(body.skill)) {
        return NextResponse.json(
          { error: `Skill غير موجودة: ${body.skill ?? "(غير محدد)"}` },
          { status: 400 }
        );
      }
      const ctx = m.createContext(doc, { config });
      if (config) m.get(body.skill)!.configure(config);
      const result = await m.runSkill(body.skill, doc, ctx);
      const provenance = skillProvenance(body.skill, result.logs);
      return NextResponse.json({ result, provenance, simulated: provenance === "simulated", metrics: m.getMetrics(body.skill) });
    }

    // الافتراضي: تشغيل Workflow.
    const wfName = body.workflow ?? "default";
    if (!m.getWorkflow(wfName)) {
      return NextResponse.json(
        { error: `Workflow غير موجود: ${wfName}` },
        { status: 400 }
      );
    }
    const result = await m.runWorkflow(wfName, doc, { config });
    // خطوات أعطت بيانات محاكاة (بلا تحليل حقيقي) — تعرضها الواجهة كتحذير.
    const simulatedSteps = result.steps.filter((s) => skillProvenance(s.skill, s.logs) === "simulated").map((s) => s.skill);
    return NextResponse.json({ result, simulatedSteps, metrics: m.allMetrics() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
