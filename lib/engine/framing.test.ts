import { describe, expect, it } from "vitest";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import { activeVideoClip, clipFraming, framingCss } from "./framing";
import { applyRange, buildExportPlan, buildSegments } from "@/lib/server/ffmpeg-export";

const clip = (id: string, start: number, dur: number, extra: Partial<VideoClip> = {}): VideoClip => ({
  id, assetId: "main", trackId: "t_video", start, duration: dur, inPoint: start, outPoint: start + dur,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none", ...extra,
});

describe("framingCss (preview geometry matches export crop)", () => {
  it("undefined when there is no framing", () => {
    expect(framingCss(undefined)).toBeUndefined();
    expect(framingCss(clipFraming(clip("a", 0, 1)))).toBeUndefined();
  });
  it("zoom 2 + pan right: translate left by pan, scale 2", () => {
    expect(framingCss({ zoom: 2, panX: 0.25, panY: 0 })).toBe("scale(2) translate(-25%, 0%)");
  });
  it("pan is clamped to the crop-window limit (0.5 - 0.5/zoom), same as the ffmpeg min/max", () => {
    expect(framingCss({ zoom: 2, panX: 0.5, panY: -0.5 })).toBe("scale(2) translate(-25%, 25%)");
    expect(framingCss({ zoom: 1.1, panX: 0.4, panY: 0 })).toContain("translate(-4.545%");
  });
});

describe("activeVideoClip", () => {
  it("picks the clip covering t; ignores image clips; later start wins on overlap", () => {
    const cs = [clip("a", 0, 5), clip("b", 5, 5), clip("img", 0, 10, { kind: "image" }), clip("c", 4, 3)];
    expect(activeVideoClip(cs, 1)?.id).toBe("a");
    expect(activeVideoClip(cs, 4.5)?.id).toBe("c");
    expect(activeVideoClip(cs, 8)?.id).toBe("b");
    expect(activeVideoClip(cs, 11)).toBeUndefined();
  });
});

describe("T-17: preview windows and export plan agree on duration", () => {
  it("for randomised projects: plan.totalDuration == Σ segment lengths, and applyRange(0..total) loses nothing", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let n = 0; n < 40; n++) {
      const count = 1 + Math.floor(rnd() * 6);
      let t = 0;
      const clips: VideoClip[] = [];
      for (let i = 0; i < count; i++) {
        const dur = 0.5 + rnd() * 4;
        const speed = [0.5, 1, 1.5, 2][Math.floor(rnd() * 4)];
        const c = clip(`c${i}`, t, dur / speed, { inPoint: rnd() * 5, speed });
        c.outPoint = c.inPoint + dur;
        clips.push(c);
        t += dur / speed;
      }
      const p: ProjectState = { ...defaultProject("t"), duration: t, clips };
      const segs = buildSegments(p);
      const sum = segs.reduce((s, x) => s + (x.outPoint - x.inPoint) / x.speed, 0);
      const plan = buildExportPlan({ sourcePath: "/a.mp4", outputPath: "/o.mp4", project: p }, { allowNvenc: false });
      expect(plan.totalDuration).toBeCloseTo(Math.max(sum, 0.1), 2);
      const win = applyRange(segs, { start: 0, end: sum });
      const winSum = win.reduce((s, x) => s + (x.outPoint - x.inPoint) / x.speed, 0);
      expect(winSum).toBeCloseTo(sum, 1);
    }
  });
});
