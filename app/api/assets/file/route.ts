import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fsp } from "fs";
import path from "path";
import { Readable } from "stream";
import { resolveMediaRef } from "@/lib/server/media-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac", ".opus": "audio/ogg",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

/** GET ?ref=upload:<uuid> → بث الملف (يدعم Range للتشغيل/التمرير). المسار لا يُكشف أبداً: المرجع معتم ويُحلّ على الخادم. */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref") || "";
  const r = ref.length <= 256 ? await resolveMediaRef(ref) : null;
  if (!r) return NextResponse.json({ error: "الوسيط غير موجود" }, { status: 404 });
  const stat = await fsp.stat(r.path).catch(() => null);
  if (!stat?.isFile()) return NextResponse.json({ error: "الوسيط غير موجود" }, { status: 404 });
  const type = MIME[path.extname(r.path).toLowerCase()] || "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, stat.size - Number(range[2]));
    }
    if (start > end || start >= stat.size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    status = 206;
  }
  const stream = Readable.toWeb(createReadStream(r.path, { start, end })) as ReadableStream;
  return new NextResponse(stream, {
    status,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
    },
  });
}
