// حارس الـ API المحلي (Host/Origin) — منطق نقي قابل للاختبار، يستخدمه middleware.ts.
// - DNS rebinding: مضيف خارجي يُحلّ إلى 127.0.0.1 ⇒ ترويسة Host غير مسموحة ⇒ رفض.
// - CSRF: صفحة من موقع آخر ترسل طلباً إلى localhost ⇒ Origin لا يطابق Host ⇒ رفض.
// أدوات سطر الأوامر (curl) لا ترسل Origin — تُقبل ما دام Host محلياً.
// للنشر على مضيف آخر: MONTAGE_ALLOWED_HOSTS=host1,host2 (مع مصادقة أمامية — التطبيق بلا حسابات).

const DEFAULT_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function allowedHosts(env: string | undefined = process.env.MONTAGE_ALLOWED_HOSTS): string[] {
  const extra = (env || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_HOSTS, ...extra];
}

/** يزيل المنفذ من "host:port" مع دعم IPv6 بين أقواس. */
export function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function checkRequest(
  host: string | null,
  origin: string | null,
  hosts: string[] = allowedHosts()
): { ok: true } | { ok: false; reason: string } {
  if (!host || !hosts.includes(hostname(host))) return { ok: false, reason: "مضيف غير مسموح" };
  if (origin === null) return { ok: true };
  if (origin === "null") return { ok: false, reason: "Origin معتم (null)" };
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return { ok: false, reason: "Origin غير صالح" };
  }
  if (o.host.toLowerCase() !== host.trim().toLowerCase()) return { ok: false, reason: "طلب من أصل آخر (cross-origin)" };
  return { ok: true };
}
