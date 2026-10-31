import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fsp } from "fs";
import path from "path";
import { Readable } from "stream";
import { assetPath, findAsset, getProject } from "@/lib/engine/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac", ".opus": "audio/ogg",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

/** يبث وسيطاً من مجلد media للمشروع فقط (المسار يُحل من الأصل المسجّل، لا من العميل). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  const params = await ctx.params;
  try {
    const project = await getProject(params.id);
    const file = assetPath(project.id, findAsset(project, params.assetId));
    const st = await fsp.stat(file);
    return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(st.size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
