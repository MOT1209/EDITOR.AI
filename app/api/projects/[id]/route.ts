import { NextRequest, NextResponse } from "next/server";
import { isEngineError } from "@/lib/engine/errors";
import { parseProject } from "@/lib/engine/project-schema";
import { assetPath, getProject, mutateProject, primaryVideoAsset } from "@/lib/engine/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(e: unknown) {
  if (isEngineError(e)) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "INVALID_INPUT" ? 400 : e.code === "CONFLICT" ? 409 : 500;
    return NextResponse.json({ error: e.message, code: e.code, hint: e.hint }, { status });
  }
  return NextResponse.json({ error: (e as Error).message }, { status: 500 });
}

/** GET → المشروع + الوسيط الأساسي (رابط بث + مسار المصدر على الخادم لاستخدامه في التصدير). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const project = await getProject(params.id);
    let media: { assetId: string; url: string; sourcePath: string; name: string } | null = null;
    try {
      const a = primaryVideoAsset(project);
      media = { assetId: a.id, name: a.name, url: `/api/projects/${project.id}/media/${a.id}`, sourcePath: assetPath(project.id, a) };
    } catch {
      /* مشروع بلا فيديو بعد */
    }
    return NextResponse.json({ project, media });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PUT → حفظ تعديلات المحرّر في مساحة العمل كعملية واحدة قابلة للتراجع (يراها MCP).
 * الأصول (assets) لا يغيّرها العميل: تُؤخذ دائماً من نسخة الخادم.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const body = await req.json().catch(() => null);
    const parsed = parseProject(body?.project);
    if (!parsed.ok) return NextResponse.json({ error: "مشروع غير صالح", details: parsed.errors }, { status: 400 });
    if (parsed.project.id !== params.id) return NextResponse.json({ error: "معرّف المشروع لا يطابق المسار" }, { status: 400 });
    const { project, historyId } = await mutateProject(params.id, "ui_save", "حفظ من المحرّر", (server) => ({
      project: { ...parsed.project, assets: server.assets },
      result: null,
    }));
    return NextResponse.json({ ok: true, historyId, updatedAt: project.updatedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
