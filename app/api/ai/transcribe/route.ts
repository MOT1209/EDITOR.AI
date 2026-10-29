import { NextRequest, NextResponse } from "next/server";
import { getOpencodeKey, getOpencodeBaseUrl, getWhisperModel } from "@/lib/server/api-keys";
import { guardCost, recordSpend, estimateCostUsd } from "@/lib/server/cost-guard";
import { validateAudioUpload } from "@/lib/server/validate";


export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const form = await req.formData();
    const audio = form.get("audio") as File | null;
    if (!audio) return NextResponse.json({ error: "الملف الصوتي مطلوب" }, { status: 400 });
    const check = validateAudioUpload(audio);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    if (!OPENCODE_API_KEY) {
      return NextResponse.json({
        text: "(مُعاينة) هذا نص تجريبي من الترجمة الصوتية. اضبط API key للترجمة الحقيقية.",
        segments: [
          { id: 1, start: 0, end: 2, text: "(مُعاينة) هذا نص تجريبي", lang: "ar" },
          { id: 2, start: 2, end: 4, text: "من الترجمة الصوتية التلقائية", lang: "ar" },
          { id: 3, start: 4, end: 6, text: "اضبط API key للترجمة الحقيقية", lang: "ar" },
        ],
        simulated: true,
        warning: "لا مفتاح مزوّد — نص تجريبي وليس تفريغاً للصوت",
      });
    }

    const guard = guardCost("whisper", { durationSec: audio.size / 4000 });
    if (!guard.allowed) return NextResponse.json({ error: guard.reason, budget: guard }, { status: 402 });

    const whisperForm = new FormData();
    whisperForm.append("file", audio);
    whisperForm.append("model", getWhisperModel());
    whisperForm.append("response_format", "verbose_json");

    const res = await fetch(`${OPENCODE_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENCODE_API_KEY}` },
      body: whisperForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Whisper API error: ${errText}` }, { status: res.status });
    }

    const data = await res.json();
    recordSpend(typeof data.duration === "number" ? estimateCostUsd("whisper", { durationSec: data.duration }) : guard.estimateUsd);
    const segments = (data.segments || []).map((s: { id?: number; start: number; end: number; text: string }) => ({
      id: s.id ?? 0,
      start: s.start,
      end: s.end,
      text: s.text,
      lang: form.get("language") || "ar",
    }));

    return NextResponse.json({ text: data.text || "", segments });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
