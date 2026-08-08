import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), ".montage_ai", "uploads");

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

export async function POST(req: NextRequest) {
  await ensureDir();
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  const id = uuid();
  const ext = path.extname(file.name) || ".mp4";
  const filename = `${id}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filepath, buffer);

  return NextResponse.json({
    id,
    filename,
    size: buffer.length,
    path: filepath,
    name: file.name,
  });
}

export async function GET() {
  await ensureDir();
  const files = await fs.readdir(UPLOAD_DIR).catch(() => []);
  return NextResponse.json({
    uploadDir: UPLOAD_DIR,
    tempDir: path.join(os.tmpdir(), "montage_ai"),
    files: files.length,
  });
}
