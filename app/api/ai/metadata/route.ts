import { NextRequest, NextResponse } from "next/server";
import { getChatModel, getOpencodeKey, getOpencodeBaseUrl } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const { duration = 60, transcript } = await req.json();

    if (!OPENCODE_API_KEY || !transcript) {
      const titles = [
        "رحلة مدهشة في عالم الذكاء الاصطناعي",
        "5 أسرار لم تسمع بها من قبل",
        "تجربتي الكاملة - النتائج صدمتني",
        "كل ما تحتاج معرفته في 5 دقائق",
        "طريقة جديدة ستغير حياتك",
      ];
      return NextResponse.json({
        title: titles[Math.floor(Math.random() * titles.length)],
        description: `في هذا الفيديو أستعرض تجربتي الكاملة على مدار ${Math.round(duration / 60)} دقائق.`,
        tags: ["ذكاء اصطناعي", "AI", "مونتاج", "تعليم", "تقنية", "تجربة"],
      });
    }

    const res = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENCODE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getChatModel(),
        messages: [
          { role: "system", content: "أنت خبير في تحسين محتوى الفيديو. أخرج JSON فقط." },
          { role: "user", content: `بناءً على هذا النص المفرغ من الفيديو (المدة: ${Math.round(duration / 60)} دقائق)، اقترح عنواناً جذاباً بالعربية، وصفاً قصيراً، و 3-6 وسوم. أخرج JSON: {"title":"...","description":"...","tags":["..."]}\n\nالنص:\n${transcript.slice(0, 3000)}` },
        ],
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `GPT-4o error: ${errText}` }, { status: res.status });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return NextResponse.json({
      title: result.title || "فيديو بدون عنوان",
      description: result.description || "",
      tags: Array.isArray(result.tags) ? result.tags : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
