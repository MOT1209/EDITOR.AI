import { NextRequest, NextResponse } from "next/server";
import { getOpencodeKey, getOpencodeBaseUrl, getWhisperModel } from "@/lib/server/api-keys";


export const runtime = "nodejs";
export const maxDuration = 120;

interface Word {
  text: string;
  start: number;
  end: number;
}

// نسخ بتوقيتات على مستوى الكلمة (Whisper word-level timestamps)
// مطلوب لِترجمة الكاريوكي المتحركة كلمة-بكلمة.
export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const form = await req.formData();
    const audio = form.get("audio") as File | null;
    const language = (form.get("language") as string) || "";
    if (!audio) {
      return NextResponse.json({ error: "الملف الصوتي مطلوب" }, { status: 400 });
    }

    if (!OPENCODE_API_KEY) {
      return NextResponse.json(
        { error: "OPENCODE_API_KEY غير مضبوط — لا يمكن تشغيل Whisper الحقيقي", mock: true },
        { status: 503 }
      );
    }

    const whisperForm = new FormData();
    whisperForm.append("file", audio);
    whisperForm.append("model", getWhisperModel());
    whisperForm.append("response_format", "verbose_json");
    whisperForm.append("timestamp_granularities[]", "word");
    whisperForm.append("timestamp_granularities[]", "segment");
    if (language) whisperForm.append("language", language);

    const res = await fetch(`${OPENCODE_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENCODE_API_KEY}` },
      body: whisperForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Whisper API error: ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    const rawWords: Array<{ word?: string; text?: string; start: number; end: number }> =
      data.words || [];
    const words: Word[] = rawWords
      .map((w) => ({
        text: (w.word ?? w.text ?? "").trim(),
        start: w.start,
        end: w.end,
      }))
      .filter((w) => w.text.length > 0);

    const segments = (data.segments || []).map(
      (s: { id?: number; start: number; end: number; text: string }, i: number) => ({
        id: s.id ?? i,
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      })
    );

    return NextResponse.json({
      text: data.text || "",
      language: data.language || language || "ar",
      duration: data.duration,
      words,
      segments,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
