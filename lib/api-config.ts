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

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers as Record<string, string> | undefined), ...authHeaders() },
  });
}

export async function opencodeChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts?: { model?: string; maxTokens?: number; responseFormat?: { type: string } },
) {
  const key = apiConfig.opencodeKey;
  if (!key) throw new Error("OPENCODE_API_KEY غير مضبوط");
  const res = await fetch(`${apiConfig.opencodeBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts?.model || "gpt-4o",
      messages,
      max_tokens: opts?.maxTokens || 2048,
      response_format: opts?.responseFormat,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

export async function opencodeVision(
  prompt: string,
  imageBase64: string,
  opts?: { model?: string; maxTokens?: number },
) {
  const key = apiConfig.opencodeKey;
  if (!key) throw new Error("OPENCODE_API_KEY غير مضبوط");
  const res = await fetch(`${apiConfig.opencodeBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts?.model || "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      }],
      max_tokens: opts?.maxTokens || 2048,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Vision error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

export async function opencodeWhisper(
  audioBlob: Blob,
  opts?: { model?: string; language?: string },
) {
  const key = apiConfig.opencodeKey;
  if (!key) throw new Error("OPENCODE_API_KEY غير مضبوط");
  const form = new FormData();
  form.append("file", audioBlob, "audio.mp3");
  form.append("model", opts?.model || "whisper-1");
  form.append("response_format", "verbose_json");
  if (opts?.language) form.append("language", opts.language);
  const res = await fetch(`${apiConfig.opencodeBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whisper error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function huggingfaceInference(
  model: string,
  inputs: unknown,
) {
  const token = apiConfig.hfToken;
  if (!token) throw new Error("HF_TOKEN غير مضبوط");
  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF Inference error ${res.status}: ${text}`);
  }
  return res.json();
}
