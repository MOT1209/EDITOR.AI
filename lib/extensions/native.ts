// ====================================================================
// واجهة الامتداد الأصلي (Native TypeScript) المضبوطة.
//
// لا تُحمَّل شيفرة من مسارات أو من حزم: الإدخالات هنا تُسجَّل في كود التطبيق نفسه (مراجعة
// وتجميع عادية). بيان المهارة يشير إلى إدخال بالاسم فقط (execution.entry) ولا يستطيع
// تعريف إدخال جديد. لإضافة إدخال: سجّله في NATIVE_ENTRIES ثم أنشئ مهارة تشير إليه.
// ====================================================================
import type { Permission } from "./manifest";
import type { Provenance } from "./actions";

export interface NativeContext {
  signal?: AbortSignal;
  config: Record<string, unknown>;
  log: (msg: string) => void;
}

export interface NativeEntry {
  id: string;
  description: string;
  /** صلاحيات يتطلبها الإدخال — يجب أن يعلنها بيان المهارة ويمنحها المالك. */
  permissions: Permission[];
  provenance: Provenance;
  run(input: Record<string, unknown>, ctx: NativeContext): Promise<Record<string, unknown>>;
}

const entries = new Map<string, NativeEntry>();

export function registerNativeEntry(e: NativeEntry): void {
  if (!/^[a-z][a-z0-9_]{2,47}$/.test(e.id)) throw new Error(`معرّف إدخال أصلي غير صالح: ${e.id}`);
  if (entries.has(e.id)) throw new Error(`إدخال أصلي مسجّل مسبقاً: ${e.id}`);
  entries.set(e.id, e);
}

export const getNativeEntry = (id: string) => entries.get(id);
export const listNativeEntries = () => [...entries.values()].map(({ run: _r, ...rest }) => rest);

// ---- إدخالات مرجعية مضمّنة ----
registerNativeEntry({
  id: "text_stats",
  description: "إحصاءات نص (كلمات، حروف، مدة نطق تقديرية). حساب حتمي محلي.",
  permissions: [],
  provenance: "computed",
  async run(input, ctx) {
    const text = typeof input.text === "string" ? input.text : "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const wpm = typeof ctx.config.wordsPerMinute === "number" && ctx.config.wordsPerMinute > 0 ? ctx.config.wordsPerMinute : 150;
    ctx.log(`words=${words}`);
    return { words, characters: text.length, estimatedSpeechSeconds: Math.round((words / wpm) * 60 * 10) / 10 };
  },
});
