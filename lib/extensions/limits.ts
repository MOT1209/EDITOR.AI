// حدود الموارد لكل إضافة وعلى مستوى الخادم: تزامن + معدّل (نافذة منزلقة دقيقة). داخل العملية (محلي، مستخدم واحد).
// لا يحدّ الذاكرة/CPU (انظر sandbox.ts). تجاوز الحد ⇒ LIMIT_EXCEEDED برسالة وتلميح، دون تنفيذ شيء.
import { EngineError } from "@/lib/engine/errors";

const num = (k: string, d: number) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};
export const limitsConfig = () => ({
  maxConcurrent: num("MONTAGE_EXT_MAX_CONCURRENT", 4),
  maxPerExtension: num("MONTAGE_EXT_MAX_PER_EXT", 2),
  ratePerMinute: num("MONTAGE_EXT_RATE_PER_MIN", 60),
});

let active = 0;
const perExt = new Map<string, number>();
const stamps = new Map<string, number[]>();

/** يحجز خانة تنفيذ؛ يُعيد دالة إفراج (تُستدعى مرة واحدة في finally). */
export function acquireSlot(key: string, now = Date.now()): () => void {
  const c = limitsConfig();
  const recent = (stamps.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= c.ratePerMinute) {
    throw new EngineError("LIMIT_EXCEEDED", `تجاوزت الإضافة «${key}» معدّل ${c.ratePerMinute} تشغيلاً/دقيقة`, "انتظر قليلاً أو ارفع MONTAGE_EXT_RATE_PER_MIN.");
  }
  if (active >= c.maxConcurrent) {
    throw new EngineError("LIMIT_EXCEEDED", `الحد الأقصى للتشغيل المتزامن للإضافات ${c.maxConcurrent}`, "أعد المحاولة بعد انتهاء تشغيل جارٍ (MONTAGE_EXT_MAX_CONCURRENT).");
  }
  if ((perExt.get(key) ?? 0) >= c.maxPerExtension) {
    throw new EngineError("LIMIT_EXCEEDED", `الإضافة «${key}» تعمل بالحد الأقصى المتزامن (${c.maxPerExtension})`, "MONTAGE_EXT_MAX_PER_EXT");
  }
  recent.push(now);
  stamps.set(key, recent);
  active++;
  perExt.set(key, (perExt.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    const n = (perExt.get(key) ?? 1) - 1;
    if (n <= 0) perExt.delete(key);
    else perExt.set(key, n);
  };
}

/** للاختبارات. */
export function resetLimits(): void {
  active = 0;
  perExt.clear();
  stamps.clear();
}
