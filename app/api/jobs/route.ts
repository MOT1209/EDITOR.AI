import { NextRequest, NextResponse } from "next/server";
import { aiJobs } from "@/lib/mockAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // نزع أي مسار قرص من نتائج المهام قبل إرسالها للعميل.
  const jobs = aiJobs.list().map((j) => {
    const r = j.result as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object" || !("path" in r)) return j;
    const { path: _omit, ...safe } = r;
    void _omit;
    return { ...j, result: safe };
  });
  return NextResponse.json({ jobs });
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
