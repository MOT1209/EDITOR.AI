import { NextRequest, NextResponse } from "next/server";
import { guardCost, recordSpend } from "@/lib/server/cost-guard";
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
      const guard = guardCost("vision", { images: Math.min(2, frames.length), chars: 600 });
      if (!guard.allowed) return NextResponse.json({ error: guard.reason, budget: guard }, { status: 402 });
      recordSpend(guard.estimateUsd);
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
      // بلا تحليل: تأطير مركزي ثابت (افتراض صريح، لا تتبع موضوع).
      return NextResponse.json({
        reframePoints: [{ time: 0, x: 0.5, y: 0.42, zoom: isVertical ? 1.5 : 1.0 }],
        duration,
        targetAspect,
        simulated: true,
        warning: "تأطير مركزي افتراضي — لا تتبع للموضوع بلا مفتاح رؤية",
      });
    }

    return NextResponse.json({ reframePoints, duration, targetAspect });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
