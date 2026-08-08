import { promises as fsp } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

export const ASSETS_DIR = path.join(process.cwd(), ".montage_ai", "assets");

export async function ensureAssetsDir() {
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
}

function extFromContentType(contentType: string | null): string {
  if (!contentType) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

// Downloads a remote image (e.g. a Pexels photo URL) once and stores it under
// ASSETS_DIR, returning a local path. Export needs a real file on disk — a
// remote URL could change or disappear, and ffmpeg shouldn't depend on network
// access at render time.
export async function importRemoteImage(imageUrl: string): Promise<{ path: string; size: number }> {
  await ensureAssetsDir();
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`تعذّر تحميل الصورة: ${res.status}`);
  const ext = extFromContentType(res.headers.get("content-type"));
  const filePath = path.join(ASSETS_DIR, `${uuid()}${ext}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(filePath, buffer);
  return { path: filePath, size: buffer.length };
}
