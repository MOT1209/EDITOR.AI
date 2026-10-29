// متحكمات إلغاء التصدير الجارية داخل عملية Next (المهمة نفسها تعمل في الخلفية).
// ملاحظة: في وضع التطوير قد يُعاد تحميل الوحدة؛ نثبّت الخريطة على globalThis.
const g = globalThis as unknown as { __montageExportControllers?: Map<string, AbortController> };
const controllers = (g.__montageExportControllers ??= new Map<string, AbortController>());

export function registerExportController(id: string): AbortController {
  const c = new AbortController();
  controllers.set(id, c);
  return c;
}

export function releaseExportController(id: string): void {
  controllers.delete(id);
}

export function cancelExport(id: string): boolean {
  const c = controllers.get(id);
  if (!c) return false;
  c.abort();
  return true;
}
