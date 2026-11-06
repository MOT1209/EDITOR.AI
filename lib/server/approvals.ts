// مصافحة موافقة من جهة الخادم: «confirmed:true» من العميل لا تكفي وحدها.
// الطلب الأول غير المؤكَّد يُسجّل موافقة معلّقة (مفتاح = نوع/معرّف/إجراء)، ولا يُقبل التأكيد إلا إن
// وُجدت معلّقة غير منتهية، وتُستهلك لمرة واحدة. هذا يغلق «طلب تأكيد أعمى» في خطوة واحدة؛
// الحد الفاصل الحقيقي ضد مستدعٍ خبيث هو المصادقة (lib/server/auth.ts) وحارس Host/Origin.

const TTL_MS = 5 * 60_000;
const MAX_PENDING = 500;
const pending = new Map<string, number>();

function sweep(now: number) {
  for (const [k, exp] of pending) if (exp <= now) pending.delete(k);
  while (pending.size > MAX_PENDING) {
    const first = pending.keys().next().value as string | undefined;
    if (first === undefined) break;
    pending.delete(first);
  }
}

/** يسجّل طلب موافقة معلّقاً (يُستدعى عند أول محاولة بلا تأكيد). */
export function requestApproval(key: string, now = Date.now()): void {
  sweep(now);
  pending.set(key, now + TTL_MS);
}

/** يستهلك موافقة معلّقة؛ false إن لم توجد أو انتهت. */
export function consumeApproval(key: string, now = Date.now()): boolean {
  sweep(now);
  const exp = pending.get(key);
  if (exp === undefined || exp <= now) return false;
  pending.delete(key);
  return true;
}

export function _resetApprovals(): void {
  pending.clear();
}
