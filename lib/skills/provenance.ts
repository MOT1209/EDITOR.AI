// مصدر نتيجة المهارة — لوسم النتائج المحاكاة بصدق في الواجهة وMCP.
import type { SkillLogEntry } from "./types";

/** مهارات تنتج دائماً بيانات مصنّعة (لا تحليل حقيقي خلفها حالياً). */
export const ALWAYS_SIMULATED_SKILLS = new Set(["SpeechRecognitionSkill"]);

export type SkillProvenance = "simulated" | "real-analysis" | "computed";

/**
 * simulated: بديل استدلالي/عشوائي (سجل «المصدر: heuristic») أو مهارة مصنّعة دائماً.
 * real-analysis: نتيجة من تحليل حقيقي مسبق أو من مسار API أعاد بيانات حقيقية.
 * computed: حساب حتمي على مدخلات المستند (جودته = جودة المدخلات).
 */
export function skillProvenance(name: string, logs: Pick<SkillLogEntry, "message">[]): SkillProvenance {
  if (ALWAYS_SIMULATED_SKILLS.has(name)) return "simulated";
  const text = logs.map((l) => l.message).join(" ");
  if (/heuristic/.test(text)) return "simulated";
  if (/تحليل مسبق|المصدر: API/.test(text)) return "real-analysis";
  return "computed";
}
