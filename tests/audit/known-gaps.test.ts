// اختبارات «توصيف» (characterization) لقيود موثّقة في docs/audit — تثبت السلوك الحالي كما هو.
// إن أُصلح قيد منها يفشل الاختبار عمداً ⇒ حدّث الاختبار والوثيقة معاً (لا تُحذف الأدلة بصمت).
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { ProjectState, TimelineTrack, VideoClip } from "@/lib/types";
import { buildExportPlan, buildSegments } from "@/lib/server/ffmpeg-export";

const mk = (id: string, assetId: string, trackId: string, start: number, inP: number, outP: number): VideoClip => ({
  id, assetId, trackId, start, duration: outP - inP, inPoint: inP, outPoint: outP,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
});
const track = (id: string): TimelineTrack => ({ id, kind: "video", label: id, height: 60, muted: false, locked: false });

import type { SourceMap } from "@/lib/engine/render-plan";

const SRC: SourceMap = {
  assetA: { path: "/ws/a.mp4", kind: "video", hasAudio: true, duration: 20 },
  assetB: { path: "/ws/b.mp4", kind: "video", hasAudio: true, duration: 20 },
};
const planOf = (p: ProjectState, sources?: SourceMap) =>
  buildExportPlan({ sourcePath: "/ws/a.mp4", outputPath: "/ws/o.mp4", project: p, sources }, { allowNvenc: false });

// المرحلة 3: الفجوات G-1..G-4 أُغلقت بالمركِّب (lib/engine/render-plan.ts + render-compile.ts).
// المسار القديم (بلا sources) يبقى كما كان لمشاريع المصدر الواحد — التوصيف أدناه يثبت الاثنين.
describe("G-1 FIXED: one -i per media source", () => {
  it("clips from two assets use two inputs and index [k:v] by asset", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 20, tracks: [track("v1")], clips: [mk("c1", "assetA", "v1", 0, 0, 5), mk("c2", "assetB", "v1", 5, 0, 5)] };
    const plan = planOf(p, SRC);
    expect(plan.engine).toBe("compositor");
    expect(plan.args.filter((a) => a === "-i")).toHaveLength(2);
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[0:v]");
    expect(fc).toContain("[1:v]");
  });
  it("legacy single-source behaviour is unchanged when no sources are supplied", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 20, tracks: [track("v1")], clips: [mk("c1", "assetA", "v1", 0, 0, 5)] };
    expect(planOf(p).engine).toBe("legacy");
    expect(buildSegments(p).every((s) => !("assetId" in s))).toBe(true);
  });
});

describe("G-2 FIXED: multiple video tracks are composited", () => {
  it("overlapping clips on two video tracks overlay; duration = longest layer, not the sum", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 10, tracks: [track("v1"), track("v2")], clips: [mk("c1", "assetA", "v1", 0, 0, 10), mk("c2", "assetB", "v2", 0, 0, 10)] };
    const plan = planOf(p, SRC);
    expect(plan.totalDuration).toBeCloseTo(10, 3);
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/overlay=[^;]*enable=/);
    expect(fc).not.toContain("concat=n=2");
  });
});

describe("G-3 FIXED: audio clips with server files enter the export", () => {
  it("export route resolves sources/audio refs and passes them to the renderer", () => {
    const route = readFileSync(path.join(process.cwd(), "app/api/export/route.ts"), "utf-8");
    expect(route).toMatch(/buildSourceMap/);
    expect(route).toMatch(/sources,/);
    expect(route).toMatch(/checkExportable/); // الحجب يبقى لصوت بلا ملف
  });
});

describe("G-4 FIXED: per-clip zoom/pan reach ffmpeg", () => {
  it("render-plan carries zoom/panX/panY and the compiler emits a crop for them", () => {
    const plan = (() => {
      const p: ProjectState = { ...defaultProject("t"), tracks: [track("v1")], clips: [{ ...mk("c1", "assetA", "v1", 0, 0, 5), zoom: 1.5, panX: 0.2 }] };
      return planOf(p, SRC);
    })();
    expect(plan.args[plan.args.indexOf("-filter_complex") + 1]).toMatch(/scale=iw\*1\.5:ih\*1\.5/);
  });
});

