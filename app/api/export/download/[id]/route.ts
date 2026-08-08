import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import { EXPORT_DIR, isPathInside, readJobStatus } from "@/lib/server/ffmpeg-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = await readJobStatus(params.id);
  if (!job) {
    return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
  }
  if (job.status !== "completed") {
    return NextResponse.json({ error: "التصدير لم يكتمل بعد", status: job.status }, { status: 409 });
  }

  const filePath = job.result?.path;
  if (!filePath || !isPathInside(filePath, EXPORT_DIR) || !existsSync(filePath)) {
    return NextResponse.json({ error: "ملف التصدير غير موجود" }, { status: 404 });
  }

  const stat = statSync(filePath);
  const format = job.result?.format || "mp4";
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": MIME[format] || "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="export_${job.id}.${format}"`,
    },
  });
}
