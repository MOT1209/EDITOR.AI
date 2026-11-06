import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { skillsBody } from "@/lib/server/schemas";
import { buildExtendedSkillManager } from "@/lib/extensions/skills-bridge";
import type { MediaDocument } from "@/lib/skills";
import { skillProvenance } from "@/lib/skills/provenance";
import { resolveVideoRef } from "@/lib/server/media-ref";
import { hasFfmpeg } from "@/lib/server/ffmpeg-export";
import { probeMedia } from "@/lib/engine/media";
import { realAnalysisFields } from "@/lib/engine/skill-doc";
import { routeError } from "@/lib/server/with-route";

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
//   + sourceRef:"upload:<uuid>" ⇒ صمت/مشاهد حقيقية (ffmpeg) تدخل المستند كتحليل مسبق فتُوسم real-analysis
export async function POST(req: NextRequest) {
  try {
    const parsedBody = await parseJsonBody(req, skillsBody);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as RunBody;
    // مدير معزول لكل طلب: لا تتسرب إعدادات طلب إلى طلبات أخرى، ولا سجل أخطاء ينمو بلا حد.
    const { manager: m } = await buildExtendedSkillManager();
    const config = safeConfig(body.config);
    const doc: MediaDocument = { duration: 30, ...(body.document ?? {}) };
    const notes: string[] = [];
    if (parsedBody.data.sourceRef !== undefined) {
      const file = await resolveVideoRef(parsedBody.data.sourceRef);
      if (!file) {
        return NextResponse.json({ error: "sourceRef يجب أن يشير إلى فيديو مرفوع (ارفع الفيديو أولاً)", code: "INVALID_INPUT" }, { status: 400 });
      }
      if (!hasFfmpeg()) {
        notes.push("ffmpeg غير مثبت — بلا تحليل حقيقي (ستُوسم النتائج الاستدلالية simulated)");
      } else {
        try {
          const info = await probeMedia(file, req.signal);
          doc.duration = info.durationSeconds > 0 ? info.durationSeconds : doc.duration;
          const real = await realAnalysisFields(file, doc.duration, req.signal);
          // ما أرسله العميل صراحةً (silences/scenes) يبقى؛ التحليل الحقيقي يملأ الغائب فقط.
          if (real.silences && doc.silences === undefined && info.audio) doc.silences = real.silences;
          if (real.scenes && doc.scenes === undefined) doc.scenes = real.scenes;
          notes.push(...real.notes);
        } catch (e) {
          notes.push(`تعذّر التحليل الحقيقي: ${e instanceof Error ? e.message : "خطأ"}`);
        }
      }
    }

    if (body.mode === "skill") {
      if (!body.skill || !m.has(body.skill)) {
        return NextResponse.json(
          { error: `Skill غير موجودة: ${body.skill ?? "(غير محدد)"}` },
          { status: 400 }
        );
      }
      const ctx = m.createContext(doc, { config });
      // M-5: المرّر config كمعامل مؤقت لـ runSkill (apply → run → restore)
      // بدل configure() الدائم الذي كان يلوّث حالة المهارة المفردة
      // ويُسرّب الإعدادات إلى الطلبات اللاحقة بلا config.
      const result = await m.runSkill(body.skill, doc, ctx, config);
      const provenance = skillProvenance(body.skill, result.logs);
      return NextResponse.json({ result, provenance, simulated: provenance === "simulated", notes, metrics: m.getMetrics(body.skill) });
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
    return NextResponse.json({ result, simulatedSteps, notes, metrics: m.allMetrics() });
  } catch (err: unknown) {
    return routeError("skills", err);
  }
}
