import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { hasFfmpeg, resolveFfmpegPath } from "@/lib/server/ffmpeg-export";

export const runtime = "nodejs";
export const maxDuration = 120;

const NULL_DEVICE = os.platform() === "win32" ? "NUL" : "/dev/null";

function detectSilencesFfmpeg(filePath: string): { start: number; end: number }[] {
  const threshold = -20;
  // spawnSync with an args array — no shell, so filePath cannot break out into shell commands.
  const r = spawnSync(
    resolveFfmpegPath(),
    [
      "-i", filePath,
      "-map", "0:a",
      "-af", `silencedetect=noise=${threshold}dB:d=0.5`,
      "-f", "null",
      NULL_DEVICE,
    ],
    { encoding: "utf-8", timeout: 30000 }
  );
  // ffmpeg writes the silencedetect log to stderr.
  const result = `${r.stderr || ""}${r.stdout || ""}`;
  const segments: { start: number; end: number }[] = [];
  const startRegex = /silence_start:\s*([\d.]+)/g;
  const endRegex = /silence_end:\s*([\d.]+)/g;
  let m;
  const starts: number[] = [];
  while ((m = startRegex.exec(result)) !== null) starts.push(parseFloat(m[1]));
  const ends: number[] = [];
  while ((m = endRegex.exec(result)) !== null) ends.push(parseFloat(m[1]));
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    segments.push({ start: starts[i], end: ends[i] });
  }
  return segments;
}

function detectSilencesMock(duration: number): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];
  let t = 1;
  while (t < duration - 1) {
    const gap = 3 + Math.random() * 4;
    if (Math.random() < 0.35) {
      const s = t + Math.random() * 2;
      segments.push({ start: s, end: Math.min(s + 0.4 + Math.random() * 0.8, duration) });
    }
    t += gap;
  }
  return segments;
}

// Only accept absolute paths to existing regular files. This rejects relative
// paths, traversal tricks, and any non-file target before touching ffmpeg.
function isSafeFilePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  try {
    if (!path.isAbsolute(p)) return false;
    const st = fs.statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const duration = typeof body?.duration === "number" ? body.duration : 30;
  const filePath = body?.filePath;

  try {
    let segments: { start: number; end: number }[];
    if (isSafeFilePath(filePath) && hasFfmpeg()) {
      segments = detectSilencesFfmpeg(filePath);
    } else {
      segments = detectSilencesMock(duration);
    }
    return NextResponse.json({ segments, duration });
  } catch {
    return NextResponse.json({ segments: detectSilencesMock(duration), duration });
  }
}
