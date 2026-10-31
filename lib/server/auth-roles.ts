// أدوار الوصول وتحديد المعدل (T-04). منطق نقي يعمل في Edge middleware.
//
// MONTAGE_API_TOKENS="tokA:admin,tokB:editor,tokC:viewer"  (≥16 حرفاً لكل رمز؛ MONTAGE_API_TOKEN القديم = admin)
//   viewer: قراءة فقط (GET/HEAD)
//   editor: كل شيء عدا إدارة الإضافات (POST/PUT/DELETE على /api/extensions)
//   admin : كل شيء
// MONTAGE_RATE_LIMIT_PER_MIN=N: حد طلبات/دقيقة لكل رمز (0/غير مضبوط = بلا حد). ذاكرة العملية (best-effort لكل نسخة).

export const MIN_TOKEN_LENGTH = 16;

/** مقارنة بزمن ثابت (لا تسرّب طول البادئة المتطابقة). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export type Role = "viewer" | "editor" | "admin";
const ROLES: readonly Role[] = ["viewer", "editor", "admin"];

export interface TokenEntry {
  token: string;
  role: Role;
}

export function parseTokens(multi: string | undefined, single: string | undefined): { entries: TokenEntry[]; errors: string[] } {
  const entries: TokenEntry[] = [];
  const errors: string[] = [];
  for (const raw of (multi || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = raw.lastIndexOf(":");
    const token = i > 0 ? raw.slice(0, i) : raw;
    const role = (i > 0 ? raw.slice(i + 1) : "viewer") as Role;
    if (!ROLES.includes(role)) errors.push(`دور غير معروف: ${role}`);
    else if (token.length < MIN_TOKEN_LENGTH) errors.push(`رمز أقصر من ${MIN_TOKEN_LENGTH} حرفاً`);
    else entries.push({ token, role });
  }
  const s = (single || "").trim();
  if (s) {
    if (s.length < MIN_TOKEN_LENGTH) errors.push(`MONTAGE_API_TOKEN أقصر من ${MIN_TOKEN_LENGTH} حرفاً`);
    else entries.push({ token: s, role: "admin" });
  }
  return { entries, errors };
}

/** يطابق الرمز المُقدَّم بزمن ثابت عبر كل المدخلات. */
export function roleForToken(entries: TokenEntry[], given: string): Role | null {
  let found: Role | null = null;
  for (const e of entries) if (safeEqual(given, e.token) && !found) found = e.role;
  return found;
}

export function isAllowed(role: Role, method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (role === "admin") return true;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  if (role === "viewer") return false;
  return !pathname.startsWith("/api/extensions"); // editor
}

const buckets = new Map<string, { start: number; count: number }>();
/** نافذة ثابتة 60 ثانية لكل مفتاح. true = مسموح. */
export function rateLimit(key: string, limitPerMin: number, now = Date.now()): boolean {
  if (!(limitPerMin > 0)) return true;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start > 60_000) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || now - b.start >= 60_000) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  b.count++;
  return b.count <= limitPerMin;
}

export function _resetRateLimit(): void {
  buckets.clear();
}
