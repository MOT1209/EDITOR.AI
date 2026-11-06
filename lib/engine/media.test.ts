import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { analyzeScenes, beatsFromSamples, detectBeats, detectSilence, probeMedia, reviewRender } from "./media";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const SAMPLE = path.resolve("test_assets/test_video.mp4");

describe("beat detection math (synthetic, no ffmpeg)", () => {
  it.each([90, 120, 150])("recovers %i BPM from a click train", (bpm) => {
    const sr = 8000;
    const secs = 16;
    const period = 60 / bpm;
    const s = new Float32Array(sr * secs);
    for (let beat = 0; beat * period < secs; beat++) {
      const at = Math.round(beat * period * sr);
      for (let i = 0; i < 400 && at + i < s.length; i++) s[at + i] = Math.sin(i / 3) * Math.exp(-i / 80);
    }
    const r = beatsFromSamples(s, sr);
    expect(r.bpm).not.toBeNull();
    expect(Math.abs(r.bpm! - bpm)).toBeLessThan(bpm * 0.03);
    expect(r.onsets.length).toBeGreaterThanOrEqual(Math.floor(secs / period) - 2);
  });

  it("returns bpm=null with zero confidence for silence (no fabrication)", () => {
    const r = beatsFromSamples(new Float32Array(8000 * 5), 8000);
    expect(r.bpm).toBeNull();
    expect(r.onsets).toEqual([]);
  });
});

describe.skipIf(!HAS_FFMPEG)("real FFmpeg analysis", () => {
  let tmp: string;
  let gapFile: string;
  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "montage_media_test_"));
    gapFile = path.join(tmp, "gap.mp4");
    // 2s نغمة → 2s صمت → 2s نغمة، مع فيديو يتبدل لونه عند 3s (تغيّر مشهد).
    const r = spawnSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=red:s=160x120:d=3:r=25",
      "-f", "lavfi", "-i", "color=blue:s=160x120:d=3:r=25",
      "-f", "lavfi", "-i", "sine=f=440:d=2", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]aformat=sample_rates=44100:channel_layouts=mono[a2];[4:a]aformat=sample_rates=44100:channel_layouts=mono[a4];[a2][3:a][a4]concat=n=3:v=0:a=1[a]",
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", gapFile,
    ]);
    expect(r.status).toBe(0);
  });

  it("probes the sample video with real metadata", async () => {
    const info = await probeMedia(SAMPLE);
    expect(info.durationSeconds).toBeCloseTo(30, 1);
    expect(info.video).toMatchObject({ codec: "h264", width: 640, height: 360 });
    expect(info.audio?.codec).toBe("aac");
  });

  it("rejects a non-media file", async () => {
    await expect(probeMedia(path.resolve("package.json"))).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
  });

  it("detects the 2s silence gap", async () => {
    const s = await detectSilence(gapFile, { noiseDb: -40, minDurationSeconds: 0.5, durationSeconds: 6 });
    expect(s).toHaveLength(1);
    expect(s[0].start).toBeGreaterThan(1.8);
    expect(s[0].end).toBeLessThan(4.3);
  });

  it("detects the colour cut as a scene change", async () => {
    const r = await analyzeScenes(gapFile, 6, { threshold: 0.3 });
    expect(r.cuts.length).toBe(1);
    expect(r.cuts[0]).toBeCloseTo(3, 0);
    expect(r.scenes).toHaveLength(2);
  });

  it("beat detection runs on decoded audio and reports its method", async () => {
    const r = await detectBeats(SAMPLE, { maxSeconds: 10 });
    expect(r.method).toBe("energy-onset");
    expect(r.analyzedSeconds).toBeCloseTo(10, 0);
  });

  it("post-render review fails a missing file and passes the sample", async () => {
    expect((await reviewRender(path.join(tmp, "nope.mp4"), {})).passed).toBe(false);
    const ok = await reviewRender(SAMPLE, { durationSeconds: 30, expectAudio: true });
    expect(ok.passed).toBe(true);
    expect(ok.details.blackRatio).toBeLessThan(0.5);
  });

  it("cancellation kills the process", async () => {
    const ac = new AbortController();
    const p = detectBeats(SAMPLE, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
