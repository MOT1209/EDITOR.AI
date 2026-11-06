import { NextRequest, NextResponse } from "next/server";
import { createMockRandom } from "@/lib/server/mock-random";

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
  // مولد محاكاة حتمي (بذرة ثابتة): نصوص الترجمة تتكرر لنفس الطلب، والمعرّفات حتمية `sub_${i}`.
  const rand = createMockRandom(0x5EED07);
  const cueCount = Math.max(4, Math.floor(duration / 3));
  const cueLen = duration / cueCount;
  for (let i = 0; i < cueCount; i++) {
    const start = i * cueLen;
    const end = Math.min(start + cueLen * 0.95, duration);
    cues.push({
      id: `sub_${i}`,
      start,
      end,
      text: PHRASES[Math.floor(rand() * PHRASES.length)],
      lang,
    });
  }
  return NextResponse.json({ cues });
}
