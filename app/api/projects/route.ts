import { NextResponse } from "next/server";
import { listProjects, workspaceRoot } from "@/lib/engine/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects → مشاريع مساحة العمل على الخادم (نفسها التي يعدّلها خادم MCP). */
export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects(), workspace: workspaceRoot() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, projects: [] }, { status: 500 });
  }
}
