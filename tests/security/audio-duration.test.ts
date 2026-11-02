import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { conservativeAudioSeconds, estimateAudioSeconds } from "@/lib/server/audio-duration";
import { hasFfmpeg } from "@/lib/server/ffmpeg-export";

describe("مدة الصوت لضابط التكلفة (L3)", () => {
  it.skipIf(!hasFfmpeg())("يقيس المدة الحقيقية بـ ffprobe", async () => {
    const bytes = readFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"));
    const r = await estimateAudioSeconds(new File([bytes], "a.mp4"));
    expect(r.measured).toBe(true);
    expect(r.seconds).toBeGreaterThan(25);
    expect(r.seconds).toBeLessThan(35);
  });

  it("ملف غير قابل للفحص ⇒ تقدير محافظ (16kbps) لا يقل عن التقدير القديم", async () => {
    const r = await estimateAudioSeconds(new File([new Uint8Array(40_000)], "x.mp3"));
    expect(r.measured).toBe(false);
    expect(r.seconds).toBe(conservativeAudioSeconds(40_000));
    expect(r.seconds).toBeGreaterThanOrEqual(40_000 / 4000);
  });
});
