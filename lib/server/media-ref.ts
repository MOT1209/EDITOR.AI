// مراجع وسائط معتمة (T-03): العميل يرى معرّفات فقط ولا يرى/يرسل مسارات القرص أبداً.
//   upload:<uuid>          فيديو مرفوع في .montage_ai/uploads
//   project:<pid>:<aid>    أصل فيديو داخل مشروع مُدار على الخادم
//   asset:<uuid>.<ext>     صورة مستوردة في .montage_ai/assets
// كل مرجع يُحلّ إلى مسار داخل جذره حصراً؛ أي شكل آخر (بما فيه المسارات المطلقة) يُرفض.
import { existsSync } from "fs";
import path from "path";
import { ASSETS_DIR } from "@/lib/server/assets";
import { UPLOAD_DIR, isPathInside } from "@/lib/server/ffmpeg-export";
import { UPLOAD_EXTS } from "@/lib/server/uploads";
import { assetPath, findAsset, getProject } from "@/lib/engine/store";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOAD_RE = new RegExp(`^upload:(${UUID})$`);
const PROJECT_RE = /^project:([A-Za-z0-9_-]{1,80}):([A-Za-z0-9_-]{1,80})$/;
const ASSET_RE = new RegExp(`^asset:(${UUID}\\.(?:jpg|jpeg|png|webp|gif))$`);

export const uploadRef = (id: string) => `upload:${id}`;
export const projectRef = (projectId: string, assetId: string) => `project:${projectId}:${assetId}`;
export const assetRef = (filename: string) => `asset:${filename}`;

/** يحلّ مرجع فيديو (upload:/project:) إلى مسار آمن، أو null. */
export async function resolveVideoRef(ref: unknown): Promise<string | null> {
  if (typeof ref !== "string") return null;
  const u = UPLOAD_RE.exec(ref);
  if (u) {
    for (const ext of UPLOAD_EXTS) {
      const p = path.join(UPLOAD_DIR, `${u[1]}${ext}`);
      if (isPathInside(p, UPLOAD_DIR) && existsSync(p)) return p;
    }
    return null;
  }
  const pr = PROJECT_RE.exec(ref);
  if (pr) {
    try {
      const project = await getProject(pr[1]);
      const asset = findAsset(project, pr[2]);
      if (asset.type !== "video") return null;
      const p = assetPath(pr[1], asset);
      return existsSync(p) ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** صورة: مرجع asset: أو مسار قديم مطلق محفوظ في مشاريع سابقة (يبقى مقبولاً فقط داخل ASSETS_DIR). */
export function resolveImageRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const m = ASSET_RE.exec(ref);
  if (m) return path.join(ASSETS_DIR, m[1]);
  return isPathInside(ref, ASSETS_DIR) ? ref : null;
}
