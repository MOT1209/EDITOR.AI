import { NextRequest, NextResponse } from "next/server";
import { resolveMediaRef } from "@/lib/server/media-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {refs: string[]} → {missing: string[]} — يكشف الوسائط التي لم تعد على الخادم (تحذير «وسائط مفقودة»). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const refs: unknown[] = Array.isArray(body?.refs) ? body.refs.slice(0, 200) : [];
  const missing: string[] = [];
  for (const r of refs) {
    if (typeof r !== "string" || r.length > 256) continue;
    if (!(await resolveMediaRef(r))) missing.push(r);
  }
  return NextResponse.json({ missing });
}
