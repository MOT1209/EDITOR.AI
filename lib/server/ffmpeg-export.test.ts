import { describe, it, expect } from "vitest";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import { applyRange, buildExportPlan, buildSegments, isPathInside } from "./ffmpeg-export";

function clip(id: string, inPoint: number, outPoint: number, start: number, extra: Partial<VideoClip> = {}): VideoClip {
  return {
    id, assetId: "a", trackId: "t_video", start, duration: outPoint - inPoint, inPoint, outPoint,
    effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none", ...extra,
  };
}

const base = (): ProjectState => ({
  ...defaultProject("t"),
  duration: 30,
  resolution: "720p",
  clips: [clip("a", 2, 6, 0), clip("b", 10, 14, 4, { speed: 2, volume: 0.5, colorFilter: "bw" })],
});

const plan = (p: ProjectState, extra: Record<string, unknown> = {}) =>
  buildExportPlan({ sourcePath: "/ws/src.mp4", outputPath: "/ws/out.mp4", project: p, ...extra }, { allowNvenc: false });

describe("FFmpeg argument construction", () => {
  it("builds an argv array (no shell) with trim/atempo/volume per segment", () => {
    const { args, totalDuration, width, height, segmentCount } = plan(base());
    expect(Array.isArray(args)).toBe(true);
    expect(args[args.length - 1]).toBe("/ws/out.mp4");
    expect(args.slice(0, 3)).toEqual(["-y", "-i", "/ws/src.mp4"]);
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("trim=start=2:end=6");
    expect(fc).toContain("trim=start=10:end=14");
    expect(fc).toContain("atempo=2");
    expect(fc).toContain("volume=0.5");
    expect(fc).toContain("hue=s=0"); // bw
    expect(fc).toContain("concat=n=2");
    expect(segmentCount).toBe(2);
    expect(totalDuration).toBeCloseTo(4 + 2, 3);
    expect([width, height]).toEqual([1280, 720]);
    expect(args).toContain("libx264");
  });

  it("source without audio uses generated silence instead of [0:a]", () => {
    const fc = plan(base(), { sourceHasAudio: false }).args.join(" ");
    expect(fc).not.toContain("[0:a]");
    expect(fc).toContain("anullsrc");
  });

  it("burns subtitles via a bare ASS filename, never a client path", () => {
    const p = { ...base(), subtitles: [{ id: "s", start: 0, end: 1, text: "سطر", lang: "ar" }] };
    const r = plan(p);
    expect(r.assFilename).toBe("subs.ass");
    expect(r.ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.00");
    expect(r.args[r.args.indexOf("-filter_complex") + 1]).toContain("subtitles=subs.ass");
  });

  it("mixes extra audio inputs with a delay at their timeline start", () => {
    const r = plan(base(), { audioInputs: [{ path: "/ws/m.mp3", start: 1.5, volume: 0.4 }] });
    const fc = r.args[r.args.indexOf("-filter_complex") + 1];
    expect(r.args).toContain("/ws/m.mp3");
    expect(fc).toContain("[1:a]adelay=1500|1500,volume=0.4");
    expect(fc).toContain("amix=inputs=2");
  });

  it("applies a preview range in timeline time with custom size", () => {
    const r = plan(base(), { range: { start: 3, end: 5 }, size: [640, 360], encoderOverride: { preset: "ultrafast", crf: 30 } });
    const fc = r.args[r.args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("trim=start=5:end=6"); // آخر ثانية من المقطع a
    expect(fc).toContain("trim=start=10:end=12"); // أول ثانية تايملاين من b (سرعة 2)
    expect(r.totalDuration).toBeCloseTo(2, 3);
    expect(r.args).toContain("ultrafast");
    expect([r.width, r.height]).toEqual([640, 360]);
  });

  it("scene-like clips with outPoint<=inPoint fall back to duration×speed", () => {
    const segs = buildSegments({ ...base(), clips: [clip("s", 4, 0, 0, { duration: 3, outPoint: 0 })] });
    expect(segs[0]).toMatchObject({ inPoint: 4, outPoint: 7 });
  });

  it("applyRange drops segments outside the window", () => {
    const segs = applyRange([{ inPoint: 0, outPoint: 4, speed: 1, volume: 1 }, { inPoint: 10, outPoint: 12, speed: 1, volume: 1 }], { start: 4, end: 6 });
    expect(segs).toEqual([{ inPoint: 10, outPoint: 12, speed: 1, volume: 1 }]);
  });

  it("isPathInside rejects traversal", () => {
    expect(isPathInside(path.join("/a/b", "../c"), "/a/b")).toBe(false);
    expect(isPathInside("/a/b/c.mp4", "/a/b")).toBe(true);
    expect(isPathInside("/a/bc/x", "/a/b")).toBe(false);
  });
});
