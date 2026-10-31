// مصادقة API اختيارية قابلة للفرض + سياسة «فشل مغلق» للنشر عن بُعد. منطق نقي (يعمل في Edge middleware).
//
// - التشغيل المحلي الافتراضي (localhost فقط، بلا MONTAGE_API_TOKEN): لا مصادقة (كما كان) — حارس Host/Origin يبقى.
// - MONTAGE_API_TOKEN مضبوط ⇒ كل /api يتطلب `Authorization: Bearer <token>` أو `x-montage-token` أو كوكي `montage_token`.
// - MONTAGE_ALLOWED_HOSTS يضيف مضيفاً غير محلي بلا رمز صالح ⇒ كل الطلبات مرفوضة (لا نشر عن بُعد بلا مصادقة).
// - رمز أقصر من 16 حرفاً يُعدّ خطأ تهيئة ⇒ رفض الكل (لا رمز ضعيف يُقبل بصمت).

export const MIN_TOKEN_LENGTH = 16;

export interface AuthEnv {
  token?: string;
  remoteHosts?: string;
}

export function authEnv(): AuthEnv {
  return { token: process.env.MONTAGE_API_TOKEN, remoteHosts: process.env.MONTAGE_ALLOWED_HOSTS };
}

/** مقارنة بزمن ثابت (لا تسرّب طول البادئة المتطابقة). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function isRemoteConfigured(env: AuthEnv = authEnv()): boolean {
  return (env.remoteHosts || "").split(",").some((h) => h.trim() !== "");
}

function extractToken(headers: { authorization: string | null; xToken: string | null; cookie: string | null }): string {
  const auth = headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  if (headers.xToken) return headers.xToken.trim();
  const c = /(?:^|;\s*)montage_token=([^;]+)/.exec(headers.cookie || "");
  return c ? decodeURIComponent(c[1]) : "";
}

export function checkAuth(
  headers: { authorization: string | null; xToken: string | null; cookie: string | null },
  env: AuthEnv = authEnv()
): { ok: true } | { ok: false; status: 401 | 503; reason: string } {
  const token = (env.token || "").trim();
  if (token && token.length < MIN_TOKEN_LENGTH) {
    return { ok: false, status: 503, reason: `MONTAGE_API_TOKEN أقصر من ${MIN_TOKEN_LENGTH} حرفاً — خطأ تهيئة` };
  }
  if (!token) {
    if (isRemoteConfigured(env)) return { ok: false, status: 503, reason: "النشر عن بُعد (MONTAGE_ALLOWED_HOSTS) يتطلب MONTAGE_API_TOKEN" };
    return { ok: true };
  }
  const given = extractToken(headers);
  if (!given || !safeEqual(given, token)) return { ok: false, status: 401, reason: "رمز الوصول مفقود أو غير صحيح" };
  return { ok: true };
}
