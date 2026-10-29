// مصدر نتيجة المهارة — لوسم النتائج المحاكاة بصدق في الواجهة وMCP.
import type { SkillLogEntry } from "./types";

/** مهارات تنتج دائماً بيانات مصنّعة (لا تحليل حقيقي خلفها حالياً). */
export const ALWAYS_SIMULATED_SKILLS = new Set(["SpeechRecognitionSkill"]);

export type SkillProvenance = "simulated" | "real-analysis" | "computed" | "ai-model";

/**
 * simulated: بديل استدلالي/عشوائي (سجل «المصدر: heuristic») أو مهارة مصنّعة دائماً.
 * real-analysis: نتيجة من تحليل حقيقي مسبق أو من مسار API أعاد بيانات حقيقية.
 * computed: حساب حتمي على مدخلات المستند (جودته = جودة المدخلات).
 * ai-model: ناتج نموذج توليدي (مهارات الإضافات من نوع prompt) — ليس تحليلاً للوسائط.
 * الإضافات تعلن مصدرها صراحة بسطر سجل «[provenance:<value>]» وله الأولوية.
 */
export function skillProvenance(name: string, logs: Pick<SkillLogEntry, "message">[]): SkillProvenance {
  if (ALWAYS_SIMULATED_SKILLS.has(name)) return "simulated";
  const text = logs.map((l) => l.message).join(" ");
  const declared = name.startsWith("ext_") && /\[provenance:(simulated|real-analysis|computed|ai-model)\]/.exec(text);
  if (declared) return declared[1] as SkillProvenance;
  if (/heuristic/.test(text)) return "simulated";
  if (/تحليل مسبق|المصدر: API/.test(text)) return "real-analysis";
  return "computed";
}
