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
export function findForeignClips(project: ProjectState, resolved?: Set<string>): VideoClip[] {
  const primary = project.assets?.find((a) => a.type === "video");
  if (!project.assets || !primary) return [];
  // أصول حُلّت مصادرها (مركِّب متعدد المصادر) لم تعد «أجنبية».
  return project.clips.filter((c) => c.kind !== "image" && c.assetId !== primary.id && c.assetId !== "main" && !resolved?.has(c.assetId));
}

/** صوت إضافي غير مكتوم لا يضمّنه تصدير الواجهة (لا مسار رفع صوت بعد — F-12/F-13). */
export function findLostAudio(project: ProjectState, resolved?: Set<string>): string[] {
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  // مقاطع صوت حُلّ ملفها على الخادم (مرجع معتم) تدخل المخرَج ولا تُعدّ مفقودة.
  const names = project.audioClips.filter((a) => !muted.has(a.trackId) && !resolved?.has(a.id)).map((a) => a.name || a.id);
  const anyAudio = project.audioClips.some((a) => !muted.has(a.trackId));
  if (project.musicId && names.length === 0 && !anyAudio) names.push(`موسيقى: ${project.musicId}`);
  return names;
}

export function checkExportable(
  project: ProjectState,
  opts: { acknowledgeAudioLoss?: boolean; resolvedAssets?: Set<string>; resolvedAudio?: Set<string> } = {}
): ExportGuardResult {
  const foreign = findForeignClips(project, opts.resolvedAssets);
  if (foreign.length > 0) {
    return {
      ok: false,
      code: "UNSUPPORTED_MULTI_SOURCE",
      error: "التصدير يدعم مصدر فيديو واحداً — توجد مقاطع من أصول أخرى كانت ستُقصّ من الأصل الخطأ",
      details: foreign.slice(0, 10).map((c) => `${c.id} (assetId=${c.assetId})`),
    };
  }
  const lost = findLostAudio(project, opts.resolvedAudio);
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
