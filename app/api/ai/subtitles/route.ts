import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { subtitlesBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const PHRASES = [
  "في هذا الفيديو سنتعرف على",
  "أهلاً بكم في رحلتنا الجديدة",
  "أهم نقطة يجب أن نلاحظها هي",
  "الذكاء الاصطناعي يغير العالم",
  "سأشرح لكم الطريقة خطوة بخطوة",
];

export async function POST(req: NextRequest) {
  const reqBody = await parseJsonBody(req, subtitlesBody);
  if (!reqBody.ok) return reqBody.response;
  const { duration = 30, lang = "ar" } = reqBody.data;
  const cues = [];
  const cueCount = Math.max(4, Math.floor(duration / 3));
  const cueLen = duration / cueCount;
  for (let i = 0; i < cueCount; i++) {
    const start = i * cueLen;
    const end = Math.min(start + cueLen * 0.95, duration);
    cues.push({
      id: `sub_${i}_${Date.now()}`,
      start,
      end,
      text: PHRASES[Math.floor(Math.random() * PHRASES.length)],
      lang,
    });
  }
  // ⚠️ لا يفرّغ أي صوت: عبارات نموذجية فقط. التفريغ الحقيقي عبر /api/ai/transcribe(-words).
  return NextResponse.json({
    cues,
    simulated: true,
    warning: "ترجمة تجريبية (عبارات نموذجية) — اضبط مفتاح المزوّد لتفريغ الصوت الحقيقي",
  });
}
