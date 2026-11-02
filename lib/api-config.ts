const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || "https://zen.opencode.ai/v1";

function getKey(key: string): string | undefined {
  if (typeof window === "undefined") return process.env[key];
  try {
    return localStorage.getItem(key) || undefined;
  } catch { return undefined; }
}

function setKey(key: string, value: string) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(key, value); } catch {}
  }
}

export const apiConfig = {
  get opencodeKey(): string | undefined { return getKey("OPENCODE_API_KEY"); },
  set opencodeKey(v: string) { setKey("OPENCODE_API_KEY", v); },

  get hfToken(): string | undefined { return getKey("HF_TOKEN"); },
  set hfToken(v: string) { setKey("HF_TOKEN", v); },


  get hfMcpUrl() { return "https://huggingface.co/mcp"; },

  opencodeBaseUrl: OPENCODE_BASE_URL,

  get ready() { return !!this.opencodeKey; },
  get hfReady() { return !!this.hfToken; },
};

// Attaches any user-supplied key from the "إعدادات API" modal so it can override
// the server's own env-var key. Server routes fall back to process.env when absent,
// so this is purely an optional per-request override, not a requirement.
export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiConfig.opencodeKey) headers["x-opencode-key"] = apiConfig.opencodeKey;
  if (apiConfig.hfToken) headers["x-hf-token"] = apiConfig.hfToken;
  return headers;
}

// ---------- جلسة الخادم (رمز MONTAGE_API_TOKEN) ----------
// الرمز لا يُحفظ في المتصفح إطلاقاً: يُرسل مرة إلى /api/session فيضع الخادم كوكي HttpOnly
// (SameSite=Strict) يرافق كل الطلبات وروابط <video src> تلقائياً ولا يقرؤه أي سكربت.

export interface SessionState {
  required: boolean;
  authenticated: boolean;
  role: string | null;
}

/** ترحيل: يحذف رمزاً قديماً حُفظ في localStorage قبل الانتقال لكوكي HttpOnly. */
export function purgeLegacyToken(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem("MONTAGE_API_TOKEN"); } catch {}
}

export async function getServerSession(): Promise<SessionState | null> {
  try {
    const r = await fetch("/api/session", { credentials: "same-origin" });
    return r.ok ? ((await r.json()) as SessionState) : null;
  } catch { return null; }
}

/** تسجيل الدخول برمز الوصول — يعيد رسالة خطأ عربية أو null عند النجاح. */
export async function loginServerSession(token: string): Promise<string | null> {
  purgeLegacyToken();
  try {
    const r = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (r.ok) return null;
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    return data.error || "تعذّر تسجيل الدخول";
  } catch { return "تعذّر الاتصال بالخادم"; }
}

export async function logoutServerSession(): Promise<void> {
  purgeLegacyToken();
  await fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
}

/** حدث يُطلق عندما يعيد مسار API نتيجة محاكاة (simulated:true) — المحرّر يعرضه كتحذير. */
export const SIMULATED_EVENT = "montage-simulated";

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers as Record<string, string> | undefined), ...authHeaders() },
  });
  if (typeof window !== "undefined" && (res.headers.get("content-type") || "").includes("application/json")) {
    res
      .clone()
      .json()
      .then((data: { simulated?: boolean; warning?: string }) => {
        if (data?.simulated) {
          window.dispatchEvent(new CustomEvent(SIMULATED_EVENT, { detail: { url, warning: data.warning ?? "" } }));
        }
      })
      .catch(() => {});
  }
  return res;
}

// ملاحظة: استدعاء المزوّدين مباشرة من المتصفح أُزيل عمداً — كل استدعاء مدفوع يمر عبر
// مسارات /api/ai/* على الخادم حتى يطبّق ضابط التكلفة (lib/server/cost-guard.ts).

// ترحيل لمرة واحدة عند تحميل الواجهة: لا رمز وصول في localStorage بعد الآن.
purgeLegacyToken();
