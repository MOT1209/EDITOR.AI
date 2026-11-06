// سياسة أمان المحتوى (T-11): nonce لكل طلب بدل 'unsafe-inline' في script-src.
// منطق نقي يعمل في Edge middleware. Next يقرأ CSP من ترويسة الطلب ويضع nonce على سكربتاته تلقائياً.
// style-src يبقى 'unsafe-inline' (React/framer-motion تضع style مضمّناً) — خطره أقل بكثير من السكربتات.
// connect-src يسمح بـ huggingface.co فقط لزر «اختبار التوكن» في إعدادات API.

export function buildPageCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    `connect-src 'self' blob: https://huggingface.co${isDev ? " ws:" : ""}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** استجابات API (JSON/وسائط) لا تحتاج تحميل أي شيء. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** nonce عشوائي 128-bit بترميز base64 (Web Crypto — متاح في Edge وNode). */
export function makeNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
