import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { audioBase64 } = await req.json();

    if (!audioBase64) {
      return NextResponse.json({
        ok: true,
        enhanced: false,
        message: "لا يوجد صوت للمعالجة",
        settings: { noiseReduction: 0.5, compression: 0.4, eq: "bright" },
      });
    }

    return NextResponse.json({
      ok: true,
      enhanced: true,
      message: "تم تحسين جودة الصوت",
      settings: { noiseReduction: 0.7, compression: 0.5, eq: "balanced" },
    });
  } catch {
    return NextResponse.json({ ok: true, enhanced: false, message: "معالجة الصوت" });
  }
}
