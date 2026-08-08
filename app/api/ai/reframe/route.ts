import { NextRequest, NextResponse } from "next/server";
import { getVisionModel,
  getOpencodeKey, getOpencodeBaseUrl } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const OPENCODE_BASE_URL = getOpencodeBaseUrl();
    const OPENCODE_API_KEY = getOpencodeKey(req);
    const { duration = 30, frames = [], targetAspect = "9:16" } = await req.json();
    const reframePoints: { time: number; x: number; y: number; zoom: number }[] = [];
    const isVertical = targetAspect === "9:16" || targetAspect === "4:5";

    if (frames.length > 0 && OPENCODE_API_KEY) {
      try {
        const sampleFrames = frames.slice(0, Math.min(2, frames.length));
        for (let fi = 0; fi < sampleFrames.length; fi++) {
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
                  { type: "text", text: `This video frame needs to be reframed to ${targetAspect}. Find the main subject/face. Return JSON: {"hasSubject":true,"centerX":0.0-1.0,"centerY":0.0-1.0,"subjectWidth":0.0-1.0,"subjectHeight":0.0-1.0}` },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${sampleFrames[fi]}` } },
                ],
              }],
              max_tokens: 256,
              response_format: { type: "json_object" },
            }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || "{}";
          const result = JSON.parse(content);
          if (result.hasSubject) {
            const timeOffset = (fi / sampleFrames.length) * duration;
            reframePoints.push({
              time: timeOffset,
              x: result.centerX ?? 0.5,
              y: result.centerY ?? 0.5,
              zoom: isVertical ? 1.5 : 1.0,
            });
          }
        }
      } catch {
        /* fall through */
      }
    }

    if (reframePoints.length === 0) {
      const pointCount = Math.max(3, Math.floor(duration / 4));
      for (let i = 0; i < pointCount; i++) {
        reframePoints.push({
          time: (i / pointCount) * duration,
          x: 0.3 + Math.random() * 0.4,
          y: 0.3 + Math.random() * 0.3,
          zoom: isVertical ? 1.3 + Math.random() * 0.5 : 1.0 + Math.random() * 0.2,
        });
      }
    }

    return NextResponse.json({ reframePoints, duration, targetAspect });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
