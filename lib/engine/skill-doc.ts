// بناء مستند المهارة من مشروع حقيقي — مصدر واحد لـ MCP والإضافات (مبدأ: منطق واحد).
import { analyzeScenes, detectSilence } from "./media";
import { assetPath, getProject, primaryVideoAsset } from "./store";
import { timelineDuration } from "./timeline";

/**
 * تحليل حقيقي لملف فيديو (ffmpeg) كحقول لمستند المهارة: `silences` و`scenes` تأخذها المهارات من مسار «تحليل مسبق»
 * فيُوسم ناتجها real-analysis. درجة المشهد 0.5 محايدة عمداً: لا إشارة جودة حقيقية بلا نموذج رؤية.
 * كل فشل ⇒ ملاحظة صريحة وحقل غائب (لا بيانات مختلقة).
 */
export async function realAnalysisFields(
  file: string,
  durationSeconds: number,
  signal?: AbortSignal
): Promise<{ silences?: { start: number; end: number }[]; scenes?: { start: number; end: number; score: number }[]; notes: string[] }> {
  const notes: string[] = [];
  const silences = await detectSilence(file, { durationSeconds, signal }).catch((e) => {
    notes.push(`تعذّر كشف الصمت: ${(e as Error).message}`);
    return undefined;
  });
  const sc = await analyzeScenes(file, durationSeconds, { signal }).catch((e) => {
    notes.push(`تعذّر كشف المشاهد: ${(e as Error).message}`);
    return null;
  });
  return { silences, scenes: sc ? sc.scenes.map((x) => ({ ...x, score: 0.5 })) : undefined, notes };
}

export async function buildSkillDocument(
  pid: string | undefined,
  useRealAnalysis: boolean,
  extra: Record<string, unknown>,
  signal?: AbortSignal
) {
  const doc: Record<string, unknown> & { duration: number } = { duration: 30, ...extra };
  const notes: string[] = [];
  if (pid) {
    const p = await getProject(pid);
    doc.duration = timelineDuration(p) || p.duration || 30;
    doc.aspect = p.aspect;
    if (useRealAnalysis) {
      const a = primaryVideoAsset(p);
      const file = assetPath(pid, a);
      const real = await realAnalysisFields(file, a.duration, signal);
      doc.silences = real.silences;
      if (real.scenes) doc.scenes = real.scenes;
      notes.push(...real.notes);
      doc.duration = a.duration;
    }
  }
  return { doc, notes };
}
