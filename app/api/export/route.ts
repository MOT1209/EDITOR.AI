import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { exportBody, EXPORT_MAX_JSON_BYTES } from "@/lib/server/schemas";
import { cancelExport } from "@/lib/server/export-jobs";
import { withRoute } from "@/lib/server/with-route";
import { startExport } from "@/lib/server/export-start";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** DELETE /api/export?id=<jobId> → إلغاء تصدير جارٍ (يقتل ffmpeg ويحذف المخرَج الجزئي). */
async function handleDELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^job_\d+_\d+$/.test(id)) {
    return NextResponse.json({ error: "معرّف مهمة غير صالح" }, { status: 400 });
  }
  const cancelled = cancelExport(id);
  if (!cancelled) {
    return NextResponse.json({ error: "لا توجد مهمة تصدير جارية بهذا المعرّف" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

async function handlePOST(req: NextRequest) {
  const parsedBody = await parseJsonBody(req, exportBody, { maxBytes: EXPORT_MAX_JSON_BYTES });
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.data;
  return startExport(body);
}

export const POST = withRoute("export", handlePOST);
export const DELETE = withRoute("export", handleDELETE);
