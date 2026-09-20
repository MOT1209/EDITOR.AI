import { NextResponse } from "next/server";
import { getBudgetState } from "@/lib/server/cost-guard";

export const runtime = "nodejs";

/** GET /api/budget → حالة الإنفاق الحالية (للعرض في الواجهة). */
export async function GET() {
  const state = getBudgetState();
  return NextResponse.json({
    spentUsd: Number(state.spentUsd.toFixed(4)),
    capUsd: state.capUsd,
    remainingUsd:
      state.remainingUsd === Infinity ? null : Number(state.remainingUsd.toFixed(4)),
  });
}
