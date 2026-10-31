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

describe("KNOWN GAP G-1: single media source per export", () => {
  it("clips from two different assets are cut from ONE input (assetId ignored)", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 20, tracks: [track("v1")], clips: [mk("c1", "assetA", "v1", 0, 0, 5), mk("c2", "assetB", "v1", 5, 0, 5)] };
    const plan = buildExportPlan({ sourcePath: "/ws/a.mp4", outputPath: "/ws/o.mp4", project: p }, { allowNvenc: false });
    expect(plan.args.filter((a) => a === "-i")).toHaveLength(1); // مدخل فيديو واحد فقط
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect((fc.match(/\[0:v\]/g) || []).length).toBeGreaterThanOrEqual(2); // المقطعان من [0:v] نفسه
    expect(buildSegments(p).every((s) => !("assetId" in s))).toBe(true);
  });
});

describe("KNOWN GAP G-2: multiple video tracks are concatenated, not composited", () => {
  it("overlapping clips on two video tracks add up in duration instead of overlaying", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 10, tracks: [track("v1"), track("v2")], clips: [mk("c1", "a", "v1", 0, 0, 10), mk("c2", "a", "v2", 0, 0, 10)] };
    const plan = buildExportPlan({ sourcePath: "/ws/a.mp4", outputPath: "/ws/o.mp4", project: p }, { allowNvenc: false });
    expect(plan.totalDuration).toBeCloseTo(20, 3); // 10s + 10s متتابعة، لا طبقتان متراكبتان
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=2");
    expect(fc).not.toMatch(/overlay=[^,;]*enable=/); // لا دمج مسارات (overlay يُستخدم للصور فقط)
  });
});

describe("RESOLVED G-3 (T-13): browser export mixes server-side audio assets", () => {
  it("app/api/export/route.ts passes audioInputs resolved from audio: refs, guarded by checkExportable", () => {
    const route = readFileSync(path.join(process.cwd(), "app/api/export/route.ts"), "utf-8");
    expect(route).toMatch(/audioInputs/);
    expect(route).toMatch(/resolveAudioRef/);
    expect(route).toMatch(/checkExportable/);
    // التحقق الفعلي من المزج (volumedetect على تصدير حقيقي) في tests/export-audio.test.ts
  });
});

describe("KNOWN GAP G-4: per-clip zoom/pan/smartZoom are display-only", () => {
  it("lib/server/ffmpeg-export.ts never reads VideoClip.zoom/panX/panY/smartZoom", () => {
    const src = readFileSync(path.join(process.cwd(), "lib/server/ffmpeg-export.ts"), "utf-8");
    expect(src).not.toMatch(/\.(panX|panY|smartZoom)\b/);
    expect(src).not.toMatch(/\bc\.zoom\b/);
  });
});
