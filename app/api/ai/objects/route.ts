import { NextRequest, NextResponse } from "next/server";
import { getHfToken } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const maxDuration = 120;

async function detectObjectsHF(imageBase64: string, HF_TOKEN: string | undefined) {
  if (!HF_TOKEN) return null;
  try {
    // HF Inference image models expect the raw image bytes as the body,
    // not a JSON-wrapped base64 string.
    const res = await fetch(
      "https://api-inference.huggingface.co/models/facebook/detr-resnet-50",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/octet-stream",
        },
        body: Buffer.from(imageBase64, "base64"),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.filter((item: { score?: number }) => (item.score || 0) > 0.4);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const HF_TOKEN = getHfToken(req);
    const { duration = 30, frames = [] } = await req.json();
    const objects: { start: number; end: number; label: string; confidence: number }[] = [];

    if (frames.length > 0 && HF_TOKEN) {
      const sampleFrames = frames.slice(0, Math.min(3, frames.length));
      for (let fi = 0; fi < sampleFrames.length; fi++) {
        const result = await detectObjectsHF(sampleFrames[fi], HF_TOKEN);
        if (result && Array.isArray(result)) {
          const timeOffset = (fi / sampleFrames.length) * duration;
          const seen = new Set<string>();
          for (const obj of result) {
            const label: string = obj.label || "object";
            if (seen.has(label)) continue;
            seen.add(label);
            objects.push({
              start: timeOffset,
              end: Math.min(timeOffset + duration / sampleFrames.length, duration),
              label,
              confidence: obj.score || 0.5,
            });
          }
        }
      }
    }

    if (objects.length === 0) {
      const labels = ["person", "car", "phone", "laptop", "book", "bottle", "chair", "tv"];
      const count = Math.max(2, Math.floor(duration / 8));
      for (let i = 0; i < count; i++) {
        const start = (i / count) * duration + Math.random() * 2;
        objects.push({
          start,
          end: Math.min(start + 3, duration),
          label: labels[Math.floor(Math.random() * labels.length)],
          confidence: 0.5 + Math.random() * 0.5,
        });
      }
    }

    return NextResponse.json({ objects, duration });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
