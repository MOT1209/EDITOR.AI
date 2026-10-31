// يبني SourceMap (مصادر الرندر المتحقَّقة) من مشروع + مراجع معتمة.
// كل مسار يأتي من مرجع معتم يُحلّ على الخادم حصراً؛ لا مسارات من العميل (T-03).
import { probeMedia } from "@/lib/engine/media";
import { assetPath } from "@/lib/engine/store";
import type { SourceInfo, SourceMap } from "@/lib/engine/render-plan";
import type { ProjectState } from "@/lib/types";
import { resolveImageRef, resolveMediaRef } from "@/lib/server/media-ref";

export interface SourceBuildOptions {
  /** assetId → مرجع معتم (من الواجهة). */
  refs?: Record<string, string>;
  /** مصدر الفيديو الأساسي (للمشاريع القديمة ذات المعرّفات الاصطناعية بلا assets). */
  primaryPath?: string;
}

const MAX_REFS = 64;

async function infoFor(file: string, kind: SourceInfo["kind"], cache: Map<string, SourceInfo>): Promise<SourceInfo> {
  const hit = cache.get(`${kind}:${file}`);
  if (hit) return hit;
  const m = await probeMedia(file);
  const info: SourceInfo = {
    path: file,
    kind,
    hasAudio: kind !== "image" && !!m.audio,
    duration: kind === "image" ? 0 : m.durationSeconds,
  };
  cache.set(`${kind}:${file}`, info);
  return info;
}

/**
 * يحلّ مصادر كل مقاطع المشروع. المفقود يبقى غائباً من الخريطة (فتُبلِّغ buildRenderPlan
 * بخطأ صريح) — لا يُستبدل بمصدر آخر إلا لمشاريع الواجهة القديمة بلا assets.
 */
export async function buildSourceMap(project: ProjectState, opts: SourceBuildOptions = {}): Promise<{ map: SourceMap; unresolved: string[] }> {
  const map: SourceMap = {};
  const unresolved: string[] = [];
  const cache = new Map<string, SourceInfo>();
  const refs = Object.entries(opts.refs ?? {}).slice(0, MAX_REFS);
  const refMap = new Map(refs);

  for (const c of project.clips as Array<ProjectState["clips"][number] & { _removed?: boolean }>) {
    if (c._removed) continue;
    // صور B-roll المستوردة: مرجع asset:/مسار قديم داخل ASSETS_DIR.
    if (c.kind === "image" && c.imageUrl) {
      const p = resolveImageRef(c.imageUrl);
      if (p) {
        try { map[`img:${c.id}`] = await infoFor(p, "image", cache); continue; } catch { unresolved.push(c.id); continue; }
      }
    }
    if (map[c.assetId]) continue;
    try {
      const ref = refMap.get(c.assetId);
      if (ref) {
        const r = await resolveMediaRef(ref);
        if (r && (r.kind === "video" || r.kind === "image")) { map[c.assetId] = await infoFor(r.path, r.kind, cache); continue; }
        unresolved.push(c.assetId);
        continue;
      }
      const asset = project.assets?.find((a) => a.id === c.assetId);
      if (asset && (asset.type === "video" || asset.type === "image")) {
        map[c.assetId] = await infoFor(assetPath(project.id, asset), asset.type, cache);
        continue;
      }
      if (!project.assets && opts.primaryPath && c.kind !== "image") {
        map[c.assetId] = await infoFor(opts.primaryPath, "video", cache);
        continue;
      }
      unresolved.push(c.assetId);
    } catch {
      unresolved.push(c.assetId);
    }
  }

  for (const a of project.audioClips) {
    try {
      if (a.ref) {
        const r = await resolveMediaRef(a.ref);
        if (r && (r.kind === "audio" || r.kind === "video")) map[`audio:${a.id}`] = await infoFor(r.path, "audio", cache);
        continue;
      }
      const asset = project.assets?.find((x) => x.url === a.url && (x.type === "audio" || x.type === "music" || x.type === "sfx"));
      if (asset) map[`audio:${a.id}`] = await infoFor(assetPath(project.id, asset), "audio", cache);
    } catch {
      /* يبقى غائباً ⇒ خطأ AUDIO_SOURCE_MISSING في الخطة */
    }
  }
  return { map, unresolved: [...new Set(unresolved)] };
}
