import { promises as fsp } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

export const ASSETS_DIR = path.join(process.cwd(), ".montage_ai", "assets");

export async function ensureAssetsDir() {
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
}

/** مضيفات CDN المسموحة للاستيراد البعيد (pexels فقط) — يُعاد فحصها بعد كل تحويل. */
const IMPORT_HOSTS = [/(^|\.)pexels\.com$/i];
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export function isAllowedImportUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    return IMPORT_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** امتداد من توقيع البايتات الفعلي (لا من ترويسة الخادم البعيد) — null إن لم تكن صورة مدعومة. */
export function sniffImageExt(b: Uint8Array): ".jpg" | ".png" | ".webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ".png";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) return ".webp";
  return null;
}

async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > max) throw new Error("الصورة أكبر من الحد المسموح");
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error("الصورة أكبر من الحد المسموح");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Downloads a remote image (e.g. a Pexels photo URL) once and stores it under
// ASSETS_DIR, returning a local path. Export needs a real file on disk — a
// remote URL could change or disappear, and ffmpeg shouldn't depend on network
// access at render time.
// تصليب: التحويلات تُتبع يدوياً مع إعادة فحص المضيف (لا تجاوز لقائمة السماح عبر redirect)، مهلة، سقف حجم
// متدفق، والنوع يُحدَّد من توقيع البايتات لا من Content-Type.
export async function importRemoteImage(
  imageUrl: string,
  opts: { fetchImpl?: typeof fetch; maxBytes?: number } = {}
): Promise<{ path: string; size: number }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let url = imageUrl;
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImportUrl(url)) throw new Error("رابط صورة غير مسموح");
    res = await doFetch(url, { redirect: "manual", signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("تحويل بلا وجهة");
      url = new URL(loc, url).toString();
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new Error("تحويلات كثيرة");
  if (!res.ok) throw new Error(`تعذّر تحميل الصورة: ${res.status}`);
  const buffer = await readCapped(res, opts.maxBytes ?? IMPORT_MAX_BYTES);
  const ext = sniffImageExt(buffer);
  if (!ext) throw new Error("الملف ليس صورة مدعومة (JPEG/PNG/WebP)");
  await ensureAssetsDir();
  const filePath = path.join(ASSETS_DIR, `${uuid()}${ext}`);
  await fsp.writeFile(filePath, buffer);
  return { path: filePath, size: buffer.length };
}
