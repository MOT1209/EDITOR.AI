import { projectRef } from "@/lib/server/media-ref";
import { NextRequest, NextResponse } from "next/server";
import { parseProject } from "@/lib/engine/project-schema";
import { parseJsonBody } from "@/lib/server/request";
import { projectPutBody, EXPORT_MAX_JSON_BYTES } from "@/lib/server/schemas";
import { getProject, mutateProject, primaryVideoAsset } from "@/lib/engine/store";
import { routeError } from "@/lib/server/with-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorResponse = (e: unknown) => routeError("projects", e);

/** GET → المشروع + الوسيط الأساسي (رابط بث + مسار المصدر على الخادم لاستخدامه في التصدير). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const project = await getProject(params.id);
    let media: { assetId: string; url: string; sourceRef: string; name: string } | null = null;
    try {
      const a = primaryVideoAsset(project);
      media = { assetId: a.id, name: a.name, url: `/api/projects/${project.id}/media/${a.id}`, sourceRef: projectRef(project.id, a.id) };
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
    const parsedBody = await parseJsonBody(req, projectPutBody, { maxBytes: EXPORT_MAX_JSON_BYTES });
    if (!parsedBody.ok) return parsedBody.response;
    const parsed = parseProject(parsedBody.data.project);
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
