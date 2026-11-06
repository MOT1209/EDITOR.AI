import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { assetsCheckBody } from "@/lib/server/schemas";
import { resolveMediaRef } from "@/lib/server/media-ref";
import { withRoute } from "@/lib/server/with-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {refs: string[]} → {missing: string[]} — يكشف الوسائط التي لم تعد على الخادم (تحذير «وسائط مفقودة»). */
async function handlePOST(req: NextRequest) {
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

export const POST = withRoute("assets.check", handlePOST);
