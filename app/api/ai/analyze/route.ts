import { NextRequest, NextResponse } from "next/server";
import { getVisionModel,
  getOpencodeKey, getOpencodeBaseUrl } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const { duration = 30, frameBase64 } = await req.json();

    if (!OPENCODE_API_KEY || !frameBase64) {
      const sceneCount = Math.max(3, Math.floor(duration / 6));
      const scenes = [];
      const highlights = [];
      for (let i = 0; i < sceneCount; i++) {
        const start = (i / sceneCount) * duration;
        const end = ((i + 1) / sceneCount) * duration;
        scenes.push({ start, end, score: 0.5 + Math.random() * 0.5 });
        if (Math.random() > 0.6) {
          highlights.push({ start, end: Math.min(end, start + 3), reason: "لقطة مميزة" });
        }
      }
      return NextResponse.json({
        duration, scenes, highlights,
        quality: { brightness: 0.6, contrast: 0.6, saturation: 0.6, sharpness: 0.6 },
      });
    }

    const res = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENCODE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getVisionModel(),
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `هذا إطار من فيديو مدته ${duration} ثانية. حلل المشاهد وجودة الفيديو (brightness, contrast, saturation, sharpness من 0 إلى 1). أخرج JSON فقط بهذا الشكل: {"scenes":[{"start":0,"end":10,"score":0.8}],"highlights":[{"start":5,"end":8,"reason":"..."}],"quality":{"brightness":0.7,"contrast":0.6,"saturation":0.5,"sharpness":0.8}}` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frameBase64}` } },
          ],
        }],
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `GPT-4o Vision error: ${errText}` }, { status: res.status });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return NextResponse.json({
      duration,
      scenes: result.scenes || [],
      highlights: result.highlights || [],
      quality: result.quality || { brightness: 0.5, contrast: 0.5, saturation: 0.5, sharpness: 0.5 },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
