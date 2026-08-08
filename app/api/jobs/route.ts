import { NextRequest, NextResponse } from "next/server";
import { aiJobs } from "@/lib/mockAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: aiJobs.list() });
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
