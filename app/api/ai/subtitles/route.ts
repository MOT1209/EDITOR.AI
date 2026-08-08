import { NextRequest, NextResponse } from "next/server";

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
  const { duration = 30, lang = "ar" } = await req.json();
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
  return NextResponse.json({ cues });
}
