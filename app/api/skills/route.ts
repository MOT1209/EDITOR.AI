import { NextRequest, NextResponse } from "next/server";
import { getSkillManager } from "@/lib/skills";
import type { MediaDocument } from "@/lib/skills";

export const runtime = "nodejs";

// GET /api/skills            → فهرس كل Skills + Workflows + المقاييس
export async function GET() {
  const m = getSkillManager();
  return NextResponse.json({
    skills: m.catalog(),
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
    const m = getSkillManager();
    const doc: MediaDocument = { duration: 30, ...(body.document ?? {}) };

    if (body.mode === "skill") {
      if (!body.skill || !m.has(body.skill)) {
        return NextResponse.json(
          { error: `Skill غير موجودة: ${body.skill ?? "(غير محدد)"}` },
          { status: 400 }
        );
      }
      const ctx = m.createContext(doc, { config: body.config });
      if (body.config) m.get(body.skill)!.configure(body.config);
      const result = await m.runSkill(body.skill, doc, ctx);
      return NextResponse.json({ result, metrics: m.getMetrics(body.skill) });
    }

    // الافتراضي: تشغيل Workflow.
    const wfName = body.workflow ?? "default";
    if (!m.getWorkflow(wfName)) {
      return NextResponse.json(
        { error: `Workflow غير موجود: ${wfName}` },
        { status: 400 }
      );
    }
    const result = await m.runWorkflow(wfName, doc, { config: body.config });
    return NextResponse.json({ result, metrics: m.allMetrics() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
