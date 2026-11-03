import { NextResponse } from "next/server";
import { listProjects } from "@/lib/engine/store";
import { routeError } from "@/lib/server/with-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects → مشاريع مساحة العمل على الخادم (نفسها التي يعدّلها خادم MCP). */
export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() }); // لا مسار قرص في الاستجابة
  } catch (e) {
    const r = routeError("projects", e);
    return NextResponse.json({ ...(await r.json()), projects: [] }, { status: r.status });
  }
}
