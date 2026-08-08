import { NextRequest, NextResponse } from "next/server";
import { getVisionModel,
  getOpencodeKey, getOpencodeBaseUrl } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const { duration = 30, frames } = await req.json();
    const sceneCount = Math.max(2, Math.floor(duration / 5));

    if (OPENCODE_API_KEY && frames && frames.length > 0) {
      try {
        const analysisPromises = frames.slice(0, 5).map(async (frame: string, i: number) => {
          const res = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENCODE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: getVisionModel(),
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: `حلل هذا الإطار من الفيديو (الإطار ${i + 1}/${frames.length}). هل يمثل مشهداً جديداً؟ أخرج JSON: {"isNewScene": true/false, "description": "وصف المشهد", "quality": 0.0-1.0}` },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame}` } },
                ],
              }],
              max_tokens: 256,
              response_format: { type: "json_object" },
            }),
          });
          if (!res.ok) return null;
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || "{}";
          return JSON.parse(content);
        });
        const analysisResults = await Promise.all(analysisPromises);
        const validResults = analysisResults.filter(Boolean);
        if (validResults.length > 0) {
          const scenes: { start: number; end: number; score: number; description?: string }[] = [];
          const segDuration = duration / validResults.length;
          validResults.forEach((r, i) => {
            const start = i * segDuration;
            const end = (i + 1) * segDuration;
            scenes.push({
              start,
              end: Math.min(end, duration),
              score: r.quality || 0.5 + Math.random() * 0.5,
              description: r.description || `مشهد ${i + 1}`,
            });
          });
          return NextResponse.json({ scenes, duration });
        }
      } catch {
        /* fall through */
      }
    }

    const scenes: { start: number; end: number; score: number; description?: string }[] = [];
    const segLen = duration / sceneCount;
    for (let i = 0; i < sceneCount; i++) {
      scenes.push({
        start: i * segLen + 0.1,
        end: Math.min((i + 1) * segLen, duration),
        score: 0.5 + Math.random() * 0.5,
        description: `مشهد ${i + 1}`,
      });
    }
    return NextResponse.json({ scenes, duration });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
