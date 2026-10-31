import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { musicSyncBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const reqBody = await parseJsonBody(req, musicSyncBody);
    if (!reqBody.ok) return reqBody.response;
    const { bpm: userBpm, duration = 30 } = reqBody.data;
    const bpm = userBpm || 120;
    const beatInterval = 60 / bpm;
    const beats: number[] = [];
    const totalBeats = Math.floor(duration / beatInterval);
    for (let i = 0; i < totalBeats; i++) {
      beats.push(i * beatInterval);
    }
    const editPoints: { time: number; strength: number }[] = [];
    const downbeatInterval = beatInterval * 4;
    const totalBars = Math.floor(duration / downbeatInterval);
    for (let i = 0; i < totalBars; i++) {
      editPoints.push({
        time: i * downbeatInterval,
        strength: 1.0,
      });
    }
    for (let i = 0; i < totalBeats; i++) {
      if (i % 4 !== 0) {
        editPoints.push({
          time: i * beatInterval,
          strength: i % 2 === 0 ? 0.6 : 0.4,
        });
      }
    }
    editPoints.sort((a, b) => a.time - b.time);

    return NextResponse.json({
      bpm,
      beats,
      editPoints,
      duration,
      method: "bpm-grid",
      bpmSource: userBpm ? "user" : "default",
      message: userBpm
        ? `شبكة نقاط قطع على ${bpm} BPM (محسوبة من الإيقاع المُدخل، لا كشف من الصوت)`
        : `شبكة افتراضية على ${bpm} BPM — لم يُكشف الإيقاع من الصوت`,
      ...(userBpm ? {} : { simulated: true, warning: "BPM افتراضي (120) — للكشف الحقيقي استخدم MCP detect_beats" }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
