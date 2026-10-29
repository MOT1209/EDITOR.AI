// بناء مستند المهارة من مشروع حقيقي — مصدر واحد لـ MCP والإضافات (مبدأ: منطق واحد).
import { analyzeScenes, detectSilence } from "./media";
import { assetPath, getProject, primaryVideoAsset } from "./store";
import { timelineDuration } from "./timeline";

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
      doc.silences = await detectSilence(file, { durationSeconds: a.duration, signal }).catch((e) => {
        notes.push(`تعذّر كشف الصمت: ${(e as Error).message}`);
        return undefined;
      });
      const sc = await analyzeScenes(file, a.duration, { signal }).catch((e) => {
        notes.push(`تعذّر كشف المشاهد: ${(e as Error).message}`);
        return null;
      });
      if (sc) doc.scenes = sc.scenes.map((s) => ({ ...s, score: 0.5 }));
      doc.duration = a.duration;
    }
  }
  return { doc, notes };
}
