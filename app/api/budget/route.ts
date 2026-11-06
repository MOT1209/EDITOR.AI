import { NextResponse } from "next/server";
import { getBudgetState } from "@/lib/server/cost-guard";
import { withRoute } from "@/lib/server/with-route";

export const runtime = "nodejs";
// يجب أن يُقرأ عند كل طلب — كان يُبنى ثابتاً فيعرض إنفاق لحظة البناء.
export const dynamic = "force-dynamic";

/** GET /api/budget → حالة الإنفاق الحالية (للعرض في الواجهة). */
async function handleGET() {
  const state = getBudgetState();
  return NextResponse.json({
    spentUsd: Number(state.spentUsd.toFixed(4)),
    capUsd: state.capUsd,
    remainingUsd:
      state.remainingUsd === Infinity ? null : Number(state.remainingUsd.toFixed(4)),
  });
}

export const GET = withRoute("budget", handleGET);
