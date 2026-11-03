import { NextRequest, NextResponse } from "next/server";
import { jobsStore } from "@/lib/server/jobs-store";
import { exportBody } from "@/lib/server/schemas";
import { startExport } from "@/lib/server/export-start";
import { withRoute } from "@/lib/server/with-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/export/retry/<jobId> → يعيد تشغيل تصدير فاشل/منقطع/ملغى من طلبه المحفوظ كمهمة جديدة (تبدأ من الصفر لا من
 * منتصف الملف). الطلب يُعاد التحقق منه كاملاً (المراجع قد تكون حُذفت بالتنظيف) — فلا مسار أقل أماناً من POST /api/export.
 */
async function handlePOST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^job_\d+_\d+$/.test(id)) return NextResponse.json({ error: "معرّف مهمة غير صالح" }, { status: 400 });
  const job = jobsStore.get(id);
  if (!job || job.kind !== "export") return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
  if (job.status === "running") return NextResponse.json({ error: "المهمة ما زالت جارية", code: "CONFLICT" }, { status: 409 });
  if (job.status === "completed") return NextResponse.json({ error: "المهمة اكتملت بنجاح — لا حاجة لإعادة المحاولة", code: "CONFLICT" }, { status: 409 });
  const saved = exportBody.safeParse(jobsStore.getRequest(id));
  if (!saved.success) {
    return NextResponse.json({ error: "لا يوجد طلب محفوظ لهذه المهمة — أعد التصدير من المحرّر", code: "NOT_FOUND" }, { status: 404 });
  }
  return startExport(saved.data);
}

export const POST = withRoute("export.retry", handlePOST);
