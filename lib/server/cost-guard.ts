// ====================================================================
// ضابط التكلفة (Cost Guard)
// يقدّر تكلفة كل استدعاء لمزوّد مدفوع (chat / vision / whisper / tts)،
// يتتبّع الإنفاق التراكمي على مستوى العملية، ويفرض سقفاً قبل أي استدعاء.
//
// ⚠️ ملاحظة نطاق: العدّاد هنا على مستوى عملية الخادم (single-process)،
// وهو كافٍ للنموذج المحلي (مستخدم واحد). طبقة SaaS مستقبلاً تستبدل
// المخزن العملي بحصص لكل مستخدم في قاعدة بيانات — بنفس واجهة الدوال.
// ====================================================================

export type CostKind = "chat" | "vision" | "whisper" | "tts";

/** أسعار افتراضية تقريبية (USD). قابلة للتهيئة عبر متغيرات البيئة. */
interface PriceTable {
  /** سعر لكل 1000 توكن (chat/vision) — تقدير مبسّط لا يفرّق مدخل/مخرج. */
  chatPer1kTokens: number;
  visionPer1kTokens: number;
  /** سعر لكل دقيقة صوت (whisper). */
  whisperPerMinute: number;
  /** سعر لكل 1000 حرف (tts). */
  ttsPer1kChars: number;
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** جدول الأسعار الحالي (يُقرأ من البيئة عند كل نداء ليبقى قابلاً للتهيئة في الاختبارات). */
export function priceTable(): PriceTable {
  return {
    chatPer1kTokens: envNum("COST_CHAT_PER_1K", 0.005),
    visionPer1kTokens: envNum("COST_VISION_PER_1K", 0.01),
    whisperPerMinute: envNum("COST_WHISPER_PER_MIN", 0.006),
    ttsPer1kChars: envNum("COST_TTS_PER_1K_CHARS", 0.015),
  };
}

/** السقف الكلي للإنفاق بالدولار (افتراضي 5$). 0 أو أقل = بلا سقف. */
export function budgetCapUsd(): number {
  return envNum("MONTAGE_BUDGET_CAP", 5);
}

export interface EstimateOpts {
  /** عدد الأحرف التقريبي للنص المُدخل + المتوقّع خرجه (chat/vision/tts). */
  chars?: number;
  /** عدد الإطارات/الصور (vision) — كل صورة تُقدَّر بتكلفة توكنات ثابتة. */
  images?: number;
  /** مدة الصوت بالثواني (whisper). */
  durationSec?: number;
}

// تقدير توكنات تقريبي: ~4 أحرف/توكن (عرف شائع، يكفي للتقدير الوقائي).
const CHARS_PER_TOKEN = 4;
// تكلفة توكنات تقريبية لكل صورة مُرسلة لموديل الرؤية.
const TOKENS_PER_IMAGE = 850;

/** يقدّر تكلفة استدعاء واحد بالدولار. تقدير وقائي (يميل للأعلى قليلاً). */
export function estimateCostUsd(kind: CostKind, opts: EstimateOpts = {}): number {
  const p = priceTable();
  switch (kind) {
    case "chat": {
      const tokens = (opts.chars ?? 0) / CHARS_PER_TOKEN;
      return (tokens / 1000) * p.chatPer1kTokens;
    }
    case "vision": {
      const textTokens = (opts.chars ?? 0) / CHARS_PER_TOKEN;
      const imageTokens = (opts.images ?? 0) * TOKENS_PER_IMAGE;
      return ((textTokens + imageTokens) / 1000) * p.visionPer1kTokens;
    }
    case "whisper": {
      const minutes = (opts.durationSec ?? 0) / 60;
      return minutes * p.whisperPerMinute;
    }
    case "tts": {
      return ((opts.chars ?? 0) / 1000) * p.ttsPer1kChars;
    }
    default:
      return 0;
  }
}

// عدّاد الإنفاق على مستوى العملية.
let spentUsd = 0;

export interface BudgetState {
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
}

export function getBudgetState(): BudgetState {
  const cap = budgetCapUsd();
  return {
    spentUsd,
    capUsd: cap,
    remainingUsd: cap > 0 ? Math.max(0, cap - spentUsd) : Infinity,
  };
}

/** يسجّل إنفاقاً فعلياً (يُستدعى بعد نجاح الاستدعاء). */
export function recordSpend(usd: number): void {
  if (Number.isFinite(usd) && usd > 0) spentUsd += usd;
}

/** يصفّر العدّاد — للاختبارات أو بدء جلسة جديدة. */
export function resetBudget(): void {
  spentUsd = 0;
}

export interface GuardResult {
  allowed: boolean;
  estimateUsd: number;
  spentUsd: number;
  capUsd: number;
  /** سبب الرفض (عند allowed=false) برسالة عربية جاهزة للعرض. */
  reason?: string;
}

/**
 * يفحص ما إذا كان استدعاء مقدَّر سيتجاوز السقف. لا يسجّل إنفاقاً —
 * استدعِ recordSpend بعد نجاح الاستدعاء الفعلي.
 */
export function guardCost(kind: CostKind, opts: EstimateOpts = {}): GuardResult {
  const estimateUsd = estimateCostUsd(kind, opts);
  const cap = budgetCapUsd();
  const base: GuardResult = { allowed: true, estimateUsd, spentUsd, capUsd: cap };

  if (cap <= 0) return base; // بلا سقف
  if (spentUsd + estimateUsd > cap) {
    return {
      ...base,
      allowed: false,
      reason:
        `تجاوز سقف التكلفة: الإنفاق الحالي ${spentUsd.toFixed(4)}$ + ` +
        `تقدير هذا الطلب ${estimateUsd.toFixed(4)}$ يتخطى السقف ${cap.toFixed(2)}$. ` +
        `ارفع MONTAGE_BUDGET_CAP أو صفّر الجلسة.`,
    };
  }
  return base;
}
