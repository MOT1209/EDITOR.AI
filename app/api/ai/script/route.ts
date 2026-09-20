import { NextRequest, NextResponse } from "next/server";
import { getChatModel, getOpencodeKey, getOpencodeBaseUrl } from "@/lib/server/api-keys";
import { guardCost, recordSpend } from "@/lib/server/cost-guard";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ScriptSection {
  text: string;
  durationSec: number;
}

interface ScriptPayload {
  hook: string;
  sections: ScriptSection[];
  cta: string;
}

function fallbackScript(topic: string, durationSec: number): ScriptPayload {
  const bodySec = Math.max(durationSec - 8, 10);
  return {
    hook: `لا تصدّق ما سأخبرك به عن ${topic}!`,
    sections: [
      { text: `اليوم نتحدث عن ${topic} وأهم ما يجب أن تعرفه.`, durationSec: bodySec * 0.4 },
      { text: `السبب الحقيقي وراء ${topic} قد يفاجئك.`, durationSec: bodySec * 0.6 },
    ],
    cta: "تابعنا لمزيد من المحتوى مثل هذا!",
  };
}

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const { topic, durationSec = 60, tone = "حماسي" } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic مطلوب" }, { status: 400 });
    }

    if (!OPENCODE_API_KEY) {
      return NextResponse.json({ script: fallbackScript(topic, durationSec) });
    }

    // تقدير المخرج المتوقّع أكبر من المدخل (سكربت كامل) — نضيف هامشاً.
    const guard = guardCost("chat", { chars: topic.length + 1200 });
    if (!guard.allowed) {
      return NextResponse.json({ error: guard.reason, budget: guard }, { status: 402 });
    }

    const res = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENCODE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getChatModel(),
        messages: [
          {
            role: "system",
            content:
              'أنت كاتب سكربتات فيديو محترف بالعربية. أخرج JSON فقط بالشكل: {"hook":"...","sections":[{"text":"...","durationSec":N}],"cta":"..."}',
          },
          {
            role: "user",
            content: `اكتب سكربت فيديو بنبرة "${tone}" عن الموضوع التالي: "${topic}"، بمدة إجمالية تقارب ${durationSec} ثانية. اجعل الـ hook (أول 3 ثوانٍ) قوياً جداً، وقسّم الجسم إلى 2-5 مقاطع منطقية، واختم بدعوة لاتخاذ إجراء (CTA). أخرج JSON فقط.`,
          },
        ],
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      // تدهور أنيق: لا نُسقط الطلب عند فشل المزوّد، بل نرجع خطة محلية.
      return NextResponse.json({ script: fallbackScript(topic, durationSec) });
    }

    recordSpend(guard.estimateUsd);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    const script: ScriptPayload = {
      hook: typeof parsed.hook === "string" ? parsed.hook : fallbackScript(topic, durationSec).hook,
      sections: Array.isArray(parsed.sections) && parsed.sections.length > 0
        ? parsed.sections
        : fallbackScript(topic, durationSec).sections,
      cta: typeof parsed.cta === "string" ? parsed.cta : fallbackScript(topic, durationSec).cta,
    };

    return NextResponse.json({ script });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
