import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { enhanceBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const reqBody = await parseJsonBody(req, enhanceBody);
    if (!reqBody.ok) return reqBody.response;
    const { audioBase64 } = reqBody.data;

    if (!audioBase64) {
      return NextResponse.json({
        ok: true,
        enhanced: false,
        message: "لا يوجد صوت للمعالجة",
        settings: { noiseReduction: 0.5, compression: 0.4, eq: "bright" },
      });
    }

    // هذا المسار لا يعالج الصوت: التحسين الفعلي (afftdn + loudnorm) يُطبَّق عند التصدير.
    return NextResponse.json({
      ok: true,
      enhanced: false,
      simulated: true,
      message: "إعدادات مقترحة فقط — التحسين الفعلي يُطبَّق عند التصدير (afftdn + loudnorm)",
      settings: { noiseReduction: 0.7, compression: 0.5, eq: "balanced" },
    });
  } catch {
    return NextResponse.json({ ok: true, enhanced: false, message: "معالجة الصوت" });
  }
}
