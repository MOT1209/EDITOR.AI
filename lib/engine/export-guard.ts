// حارس صحة التصدير (T-01): يحوّل الفشل الصامت إلى رفض صريح.
//  - مقاطع من أصل غير مصدر التصدير ⇒ لا تُقطع بصمت من الأصل الخطأ.
//  - صوت إضافي لن يدخل المخرَج ⇒ لا يُسقط بصمت؛ يتطلب إقراراً صريحاً من المستخدم.
// دوال نقية قابلة للاختبار؛ يستخدمها /api/export ومسار MCP معاً.
import type { ProjectState, VideoClip } from "@/lib/types";

export type ExportGuardCode = "UNSUPPORTED_MULTI_SOURCE" | "AUDIO_WOULD_BE_LOST";

export type ExportGuardResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: ExportGuardCode; error: string; details: string[] };

/**
 * مقاطع فيديو من أصل آخر غير الأصل الأساسي. يعمل فقط للمشاريع المُدارة على الخادم (لها `assets`)؛
 * مشاريع الواجهة بلا `assets` تأتي من فيديو مرفوع واحد (معرّفات اصطناعية مثل broll_0 مشتقة منه).
 */
export function findForeignClips(project: ProjectState): VideoClip[] {
  const primary = project.assets?.find((a) => a.type === "video");
  if (!project.assets || !primary) return [];
  return project.clips.filter((c) => c.kind !== "image" && c.assetId !== primary.id && c.assetId !== "main");
}

export const AUDIO_REF_RE = /^audio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp3|wav|m4a|aac|ogg|flac|opus|webm)$/;
export const isAudioRef = (v: unknown): v is string => typeof v === "string" && AUDIO_REF_RE.test(v);

/** صوت إضافي غير مكتوم لن يدخل المخرَج: كل مقطع بلا مرجع أصل خادم صالح (T-13: المقاطع المرفوعة تُمزج). */
export function findLostAudio(project: ProjectState): string[] {
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  const names = project.audioClips.filter((a) => !muted.has(a.trackId) && !isAudioRef(a.ref)).map((a) => a.name || a.id);
  if (project.musicId && project.audioClips.length === 0) names.push(`موسيقى: ${project.musicId}`);
  return names;
}

export function checkExportable(project: ProjectState, opts: { acknowledgeAudioLoss?: boolean } = {}): ExportGuardResult {
  const foreign = findForeignClips(project);
  if (foreign.length > 0) {
    return {
      ok: false,
      code: "UNSUPPORTED_MULTI_SOURCE",
      error: "التصدير يدعم مصدر فيديو واحداً — توجد مقاطع من أصول أخرى كانت ستُقصّ من الأصل الخطأ",
      details: foreign.slice(0, 10).map((c) => `${c.id} (assetId=${c.assetId})`),
    };
  }
  const lost = findLostAudio(project);
  if (lost.length > 0 && !opts.acknowledgeAudioLoss) {
    return {
      ok: false,
      code: "AUDIO_WOULD_BE_LOST",
      error: "الصوت المضاف (موسيقى/تعليق) لن يدخل الملف المصدَّر — أرسل acknowledgeAudioLoss:true للمتابعة بدونه",
      details: lost.slice(0, 10),
    };
  }
  return {
    ok: true,
    warnings: lost.length > 0 ? [`أُقِرّ فقدان ${lost.length} مقطع صوتي من المخرَج`] : [],
  };
}
