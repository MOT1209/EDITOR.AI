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

  // رمز الوصول لخادم مفروض عليه MONTAGE_API_TOKEN (يُحفظ محلياً في المتصفح ويُرسل كترويسة فقط).
  get montageToken(): string | undefined { return getKey("MONTAGE_API_TOKEN"); },
  set montageToken(v: string) {
    setKey("MONTAGE_API_TOKEN", v);
    // كوكي Strict كي تعمل روابط <video src>/<a href> التي لا تستطيع إرسال ترويسات.
    if (typeof document !== "undefined") {
      document.cookie = v
        ? `montage_token=${encodeURIComponent(v)}; Path=/; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`
        : "montage_token=; Path=/; Max-Age=0; SameSite=Strict";
    }
  },

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
  if (apiConfig.montageToken) headers["x-montage-token"] = apiConfig.montageToken;
  return headers;
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
