import { NextRequest } from "next/server";

// Per-request key resolution: prefers a key the client sent via the "إعدادات API"
// settings modal (stored client-side, forwarded as a header) over the server's
// own .env.local value. This lets a user's own key work even when the server
// has none configured, without requiring env vars for local development.
//
// سياسة أمان: في النشر عن بُعد (MONTAGE_ALLOWED_HOSTS) أو عند MONTAGE_ACCEPT_CLIENT_KEYS=0 تُتجاهل
// مفاتيح المتصفح كلياً ولا تُستخدم إلا مفاتيح الخادم من البيئة — فلا تمرّ أسرار المزوّد عبر المتصفح.
export function clientKeysAccepted(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MONTAGE_ACCEPT_CLIENT_KEYS === "0") return false;
  return !(env.MONTAGE_ALLOWED_HOSTS || "").split(",").some((h) => h.trim() !== "");
}

function fromClient(req: NextRequest, header: string): string | undefined {
  return clientKeysAccepted() ? req.headers.get(header) || undefined : undefined;
}

export function getOpencodeKey(req: NextRequest): string | undefined {
  return fromClient(req, "x-opencode-key") || process.env.OPENCODE_API_KEY || undefined;
}

export function getHfToken(req: NextRequest): string | undefined {
  return fromClient(req, "x-hf-token") || process.env.HF_TOKEN || undefined;
}

export function getOpencodeBaseUrl(): string {
  return process.env.OPENCODE_BASE_URL || "https://zen.opencode.ai/v1";
}

/** موديل المحادثة/التحليل النصي — قابل للتهيئة عبر OPENCODE_MODEL. */
export function getChatModel(): string {
  return process.env.OPENCODE_MODEL || "gpt-4o";
}

/** موديل الرؤية (صور/فريمات) — OPENCODE_VISION_MODEL. */
export function getVisionModel(): string {
  return process.env.OPENCODE_VISION_MODEL || process.env.OPENCODE_MODEL || "gpt-4o";
}

/** موديل التفريغ الصوتي (Whisper) — WHISPER_MODEL. */
export function getWhisperModel(): string {
  return process.env.WHISPER_MODEL || "whisper-1";
}

export function getPexelsKey(req: NextRequest): string | undefined {
  return fromClient(req, "x-pexels-key") || process.env.PEXELS_API_KEY || undefined;
}
