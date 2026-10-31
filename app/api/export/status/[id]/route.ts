import { NextRequest, NextResponse } from "next/server";
import { readJobStatus } from "@/lib/server/ffmpeg-export";
import { isExportActive } from "@/lib/server/export-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ id: status.id, status: "failed", progress: status.progress, message: "توقفت عملية الخادم أثناء التصدير — أعد التصدير" });
  }
  // لا مسارات قرص للعميل (T-03): التنزيل يتم بمعرّف المهمة عبر /api/export/download/<id>.
  const { result, ...rest } = status;
  return NextResponse.json(result ? { ...rest, result: { size: result.size, format: result.format } } : rest);
}
