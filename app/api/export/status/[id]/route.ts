import { NextRequest, NextResponse } from "next/server";
import { readJobStatus } from "@/lib/server/ffmpeg-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const status = await readJobStatus(params.id);
  if (!status) {
    return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
  }
  return NextResponse.json(status);
}
