import { NextRequest, NextResponse } from "next/server";
import { readJobStatus } from "@/lib/server/ffmpeg-export";
import { isExportActive } from "@/lib/server/export-jobs";
import { jobsStore } from "@/lib/server/jobs-store";
import { withRoute } from "@/lib/server/with-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  if (!/^job_\d+_\d+$/.test(params.id)) {
    return NextResponse.json({ error: "معرّف مهمة غير صالح" }, { status: 400 });
  }
  const status = await readJobStatus(params.id);
  if (!status) {
    return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
  }
  // مهمة «running» على القرص لكن ليست جارية في هذه العملية = توقف الخادم أثناء الرندر (لا استئناف) — تُبلَّغ فاشلة بوضوح.
  if (status.status === "running" && !isExportActive(params.id)) {
    return NextResponse.json({ id: status.id, status: "failed", progress: status.progress, message: "توقفت عملية الخادم أثناء التصدير — أعد التصدير", retryable: jobsStore.getRequest(params.id) !== undefined });
  }
  // لا مسارات قرص للعميل (T-03): التنزيل يتم بمعرّف المهمة عبر /api/export/download/<id>.
  const { result, ...rest } = status;
  // retryable: فاشلة/ملغاة ولها طلب محفوظ ⇒ POST /api/export/retry/<id> يعيدها كمهمة جديدة.
  const retryable = (status.status === "failed" || status.status === "cancelled") && jobsStore.getRequest(params.id) !== undefined;
  return NextResponse.json(result ? { ...rest, result: { size: result.size, format: result.format } } : { ...rest, ...(retryable ? { retryable } : {}) });
}

export const GET = withRoute("export.status", handleGET);
