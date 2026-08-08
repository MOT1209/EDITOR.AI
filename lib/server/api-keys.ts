import { NextRequest } from "next/server";

// Per-request key resolution: prefers a key the client sent via the "إعدادات API"
// settings modal (stored client-side, forwarded as a header) over the server's
// own .env.local value. This lets a user's own key work even when the server
// has none configured, without requiring env vars for local development.
export function getOpencodeKey(req: NextRequest): string | undefined {
  return req.headers.get("x-opencode-key") || process.env.OPENCODE_API_KEY || undefined;
}

export function getHfToken(req: NextRequest): string | undefined {
  return req.headers.get("x-hf-token") || process.env.HF_TOKEN || undefined;
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
  return req.headers.get("x-pexels-key") || process.env.PEXELS_API_KEY || undefined;
}
