import { NextRequest, NextResponse } from "next/server";
import { getOpencodeKey, getOpencodeBaseUrl } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const maxDuration = 120;

// تحويل صوت واجهة المستخدم إلى أصوات OpenAI-compatible TTS.
const VOICE_MAP: Record<string, string> = {
  "ar-male-1": "onyx",
  "ar-female-1": "nova",
  "en-male-1": "echo",
  "en-female-1": "shimmer",
  clone: "alloy",
};

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const { text, voice = "ar-male-1", speed = 1 } = await req.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "النص مطلوب" }, { status: 400 });
    }
    if (!OPENCODE_API_KEY) {
      return NextResponse.json(
        { error: "OPENCODE_API_KEY غير مضبوط — لا يمكن توليد الصوت", mock: true },
        { status: 503 }
      );
    }

    const res = await fetch(`${OPENCODE_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENCODE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: String(text).slice(0, 3000),
        voice: VOICE_MAP[voice] || "onyx",
        speed: Math.max(0.5, Math.min(2, Number(speed) || 1)),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `TTS API error: ${errText}` }, { status: res.status });
    }

    const audioBuf = await res.arrayBuffer();
    const base64 = Buffer.from(audioBuf).toString("base64");

    return NextResponse.json({
      audioBase64: base64,
      mime: (res.headers.get("content-type") || "audio/mpeg").split(";")[0],
      durationEst: Math.max(2, String(text).trim().split(/\s+/).length * 0.45),
      text: String(text),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
