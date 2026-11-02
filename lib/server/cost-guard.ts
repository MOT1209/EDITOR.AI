// ====================================================================
// ضابط التكلفة (Cost Guard)
// يقدّر تكلفة كل استدعاء لمزوّد مدفوع (chat / vision / whisper / tts)،
// يتتبّع الإنفاق اليومي (UTC)، ويفرض سقفاً قبل أي استدعاء.
//
// - guardCost يحجز التقدير فوراً عند السماح، فلا تتجاوز طلبات متزامنة السقف معاً
//   (سباق «تحقق ثم سجّل»). recordSpend يستهلك أقدم حجز ويسجّل الإنفاق الفعلي؛
//   الحجز الذي لم يُسجَّل (فشل الاستدعاء) ينتهي بعد RESERVATION_TTL_MS.
// - الإنفاق يُحفظ ذرياً في .montage_ai/budget.json (أو MONTAGE_BUDGET_FILE) فلا تصفّره
//   إعادة تشغيل الخادم. داخل Vitest الحفظ معطّل ما لم يُضبط MONTAGE_BUDGET_FILE صراحةً.
// ⚠️ النطاق: عملية خادم واحدة (النموذج المحلي). طبقة متعددة المستخدمين تستبدل المخزن بقاعدة بيانات.
// ====================================================================

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

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

/** سقف الإنفاق اليومي (UTC) بالدولار (افتراضي 5$). 0 أو أقل = بلا سقف. */
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

// ---------- الحالة: إنفاق اليوم + حجوزات معلّقة ----------

const RESERVATION_TTL_MS = 10 * 60_000;
let spentUsd = 0;
let spentDay = "";
let loaded = false;
let reservations: { usd: number; at: number }[] = [];

function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function budgetFile(): string | null {
  if (process.env.MONTAGE_BUDGET_FILE) return path.resolve(process.env.MONTAGE_BUDGET_FILE);
  if (process.env.VITEST) return null;
  return path.join(process.cwd(), ".montage_ai", "budget.json");
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const file = budgetFile();
  if (!file) return;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as { day?: unknown; spentUsd?: unknown };
    if (typeof raw.day === "string" && typeof raw.spentUsd === "number" && Number.isFinite(raw.spentUsd) && raw.spentUsd >= 0) {
      spentDay = raw.day;
      spentUsd = raw.spentUsd;
    }
  } catch {
    /* لا ملف بعد أو تالف ⇒ نبدأ من صفر */
  }
}

function persist(): void {
  const file = budgetFile();
  if (!file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ day: spentDay, spentUsd }));
    renameSync(tmp, file);
  } catch {
    /* التدهور الأنيق: يبقى العدّاد في الذاكرة */
  }
}

/** يحمّل الحالة، يصفّر عند تغيّر اليوم، ويحذف الحجوزات المنتهية. */
function sync(now = Date.now()): void {
  load();
  const d = today(now);
  if (spentDay !== d) {
    spentDay = d;
    spentUsd = 0;
    persist();
  }
  reservations = reservations.filter((r) => now - r.at < RESERVATION_TTL_MS);
}

function reservedUsd(): number {
  return reservations.reduce((a, r) => a + r.usd, 0);
}

export interface BudgetState {
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
}

export function getBudgetState(): BudgetState {
  sync();
  const cap = budgetCapUsd();
  return {
    spentUsd,
    capUsd: cap,
    remainingUsd: cap > 0 ? Math.max(0, cap - spentUsd) : Infinity,
  };
}

/** يسجّل إنفاقاً فعلياً (يُستدعى بعد نجاح الاستدعاء) ويحرّر أقدم حجز معلّق. */
export function recordSpend(usd: number): void {
  sync();
  reservations.shift();
  if (Number.isFinite(usd) && usd > 0) {
    spentUsd += usd;
    persist();
  }
}

/** يحرّر أقدم حجز دون تسجيل إنفاق (استدعاء فشل قبل الوصول للمزوّد). */
export function releaseReservation(): void {
  reservations.shift();
}

/** يصفّر العدّاد والحجوزات — للاختبارات أو بدء جلسة جديدة. */
export function resetBudget(): void {
  loaded = true;
  spentDay = today();
  spentUsd = 0;
  reservations = [];
  persist();
}

/** يعيد قراءة الحالة من الملف عند الطلب التالي (لاختبار الاستمرار بعد إعادة التشغيل). */
export function reloadBudgetForTests(): void {
  loaded = false;
  spentDay = "";
  spentUsd = 0;
  reservations = [];
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
 * يفحص ما إذا كان استدعاء مقدَّر سيتجاوز السقف (محتسباً الحجوزات المعلّقة)، ويحجز
 * التقدير عند السماح. استدعِ recordSpend بعد نجاح الاستدعاء الفعلي.
 */
export function guardCost(kind: CostKind, opts: EstimateOpts = {}): GuardResult {
  sync();
  const estimateUsd = estimateCostUsd(kind, opts);
  const cap = budgetCapUsd();
  const base: GuardResult = { allowed: true, estimateUsd, spentUsd, capUsd: cap };

  if (cap <= 0) return base; // بلا سقف
  const committed = spentUsd + reservedUsd();
  if (committed + estimateUsd > cap) {
    return {
      ...base,
      allowed: false,
      reason:
        `تجاوز سقف التكلفة: الإنفاق الحالي ${committed.toFixed(4)}$ + ` +
        `تقدير هذا الطلب ${estimateUsd.toFixed(4)}$ يتخطى السقف ${cap.toFixed(2)}$. ` +
        `ارفع MONTAGE_BUDGET_CAP أو انتظر اليوم التالي (UTC).`,
    };
  }
  reservations.push({ usd: estimateUsd, at: Date.now() });
  return base;
}
