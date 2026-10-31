import { NextRequest, NextResponse } from "next/server";
import { readJobStatus } from "@/lib/server/ffmpeg-export";

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
  return NextResponse.json(status);
}
