// مصادقة API اختيارية قابلة للفرض + سياسة «فشل مغلق» للنشر عن بُعد. منطق نقي (يعمل في Edge middleware).
//
// - التشغيل المحلي الافتراضي (localhost فقط، بلا MONTAGE_API_TOKEN): لا مصادقة (كما كان) — حارس Host/Origin يبقى.
// - MONTAGE_API_TOKEN مضبوط ⇒ كل /api يتطلب `Authorization: Bearer <token>` أو `x-montage-token` أو كوكي `montage_token`.
// - MONTAGE_ALLOWED_HOSTS يضيف مضيفاً غير محلي بلا رمز صالح ⇒ كل الطلبات مرفوضة (لا نشر عن بُعد بلا مصادقة).
// - رمز أقصر من 16 حرفاً يُعدّ خطأ تهيئة ⇒ رفض الكل (لا رمز ضعيف يُقبل بصمت).


import { MIN_TOKEN_LENGTH, parseTokens, roleForToken, safeEqual, type Role } from "./auth-roles";
export { MIN_TOKEN_LENGTH, safeEqual };

export interface AuthEnv {
  token?: string;
  /** MONTAGE_API_TOKENS="tok:admin,tok2:viewer" (T-04) */
  tokens?: string;
  remoteHosts?: string;
}

export function authEnv(): AuthEnv {
  return { token: process.env.MONTAGE_API_TOKEN, tokens: process.env.MONTAGE_API_TOKENS, remoteHosts: process.env.MONTAGE_ALLOWED_HOSTS };
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
): { ok: true; role: Role; tokenId: string } | { ok: false; status: 401 | 503; reason: string } {
  const { entries, errors } = parseTokens(env.tokens, env.token);
  if (errors.length > 0) return { ok: false, status: 503, reason: `خطأ تهيئة رموز الوصول: ${errors[0]}` };
  if (entries.length === 0) {
    if (isRemoteConfigured(env)) return { ok: false, status: 503, reason: "النشر عن بُعد (MONTAGE_ALLOWED_HOSTS) يتطلب MONTAGE_API_TOKEN أو MONTAGE_API_TOKENS" };
    return { ok: true, role: "admin", tokenId: "local" };
  }
  const given = extractToken(headers);
  const role = given ? roleForToken(entries, given) : null;
  if (!role) return { ok: false, status: 401, reason: "رمز الوصول مفقود أو غير صحيح" };
  return { ok: true, role, tokenId: given.slice(0, 12) };
}
