import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { assetsCheckBody } from "@/lib/server/schemas";
import { resolveMediaRef } from "@/lib/server/media-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {refs: string[]} → {missing: string[]} — يكشف الوسائط التي لم تعد على الخادم (تحذير «وسائط مفقودة»). */
export async function POST(req: NextRequest) {
  const parsedBody = await parseJsonBody(req, assetsCheckBody);
  if (!parsedBody.ok) return parsedBody.response;
  const refs: string[] = parsedBody.data.refs;
  const missing: string[] = [];
  for (const r of refs) {
    if (typeof r !== "string" || r.length > 256) continue;
    if (!(await resolveMediaRef(r))) missing.push(r);
  }
  return NextResponse.json({ missing });
}
