import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { bpm: userBpm, duration = 30 } = await req.json();
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
          strength: 0.4 + Math.random() * 0.3,
        });
      }
    }
    editPoints.sort((a, b) => a.time - b.time);

    return NextResponse.json({
      bpm,
      beats,
      editPoints,
      duration,
      message: `تم تحليل الإيقاع: ${bpm} BPM`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
