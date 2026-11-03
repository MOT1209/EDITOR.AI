import { NextRequest, NextResponse } from "next/server";
import { jobsStore, toAIJob } from "@/lib/server/jobs-store";
import { withRoute } from "@/lib/server/with-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  // نزع أي مسار قرص من نتائج المهام قبل إرسالها للعميل.
  const jobs = jobsStore.list().map(toAIJob).map((j) => {
    const r = j.result as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object" || !("path" in r)) return j;
    const { path: _omit, ...safe } = r;
    void _omit;
    return { ...j, result: safe };
  });
  return NextResponse.json({ jobs });
}

async function handleDELETE() {
  return NextResponse.json({ ok: true });
}

export const GET = withRoute("jobs", handleGET);
export const DELETE = withRoute("jobs", handleDELETE);
