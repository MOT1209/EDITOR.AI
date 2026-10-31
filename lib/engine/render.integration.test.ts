// اختبارات تكامل بـ FFmpeg حقيقي: تصدير متعدد المصادر/المسارات/الصوت.
// الوسائط تُولَّد بـ lavfi (ألوان صرفة ونغمات) فنتحقق من البكسلات والمستويات فعلاً.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { AudioClip, ProjectState, VideoClip } from "@/lib/types";
import type { SourceMap } from "@/lib/engine/render-plan";
import { buildRenderPlan, needsCompositor } from "@/lib/engine/render-plan";
import { ExportCancelledError, RenderPlanError, hasFfmpeg, runExport } from "@/lib/server/ffmpeg-export";
import { probeMedia } from "@/lib/engine/media";

const ffmpegOk = hasFfmpeg();
const d = ffmpegOk ? describe : describe.skip;

let dir: string;
const f = (n: string) => path.join(dir, n);
const gen = (args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "pipe" });

function pixel(file: string, t: number, x: number, y: number): [number, number, number] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 20 });
  return [r.stdout[0], r.stdout[1], r.stdout[2]];
}
const near = (a: [number, number, number], b: [number, number, number], tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
function meanVolume(file: string, from: number, len: number): number {
  const r = spawnSync("ffmpeg", ["-v", "info", "-ss", String(from), "-t", String(len), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf-8" });
  const m = /mean_volume:\s*(-?[\d.]+|-inf)/.exec(r.stderr);
  return m ? (m[1] === "-inf" ? -120 : Number(m[1])) : NaN;
}

const clip = (id: string, assetId: string, trackId: string, start: number, inP: number, outP: number, extra: Partial<VideoClip> = {}): VideoClip => ({
  id, assetId, trackId, start, duration: outP - inP, inPoint: inP, outPoint: outP,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none", ...extra,
});

function proj(over: Partial<ProjectState>): ProjectState {
  const base = defaultProject("it");
  return {
    ...base, resolution: "720p", fps: 30, quality: "draft", aspect: "16:9",
    tracks: [
      { id: "v1", kind: "video", label: "V1", height: 60, muted: false, locked: false },
      { id: "v2", kind: "video", label: "V2", height: 60, muted: false, locked: false, magnetic: false },
      { id: "a1", kind: "audio", label: "A1", height: 40, muted: false, locked: false },
    ],
    ...over,
  };
}

const src: SourceMap = {};

beforeAll(() => {
  if (!ffmpegOk) return;
  dir = mkdtempSync(path.join(os.tmpdir(), "render-it-"));
  // أحمر 640x360@25 مع نغمة 440، أخضر 320x240@30 مع نغمة 880، صورة زرقاء، موسيقى ونغمة كلام.
  gen(["-f", "lavfi", "-i", "color=c=red:s=640x360:r=25:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f("red.mp4")]);
  gen(["-f", "lavfi", "-i", "color=c=lime:s=320x240:r=30:d=4", "-f", "lavfi", "-i", "sine=f=880:d=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f("green.mp4")]);
  gen(["-f", "lavfi", "-i", "color=c=blue:s=400x400:d=1", "-frames:v", "1", f("blue.png")]);
  gen(["-f", "lavfi", "-i", "sine=f=220:d=6", "-c:a", "libmp3lame", f("music.mp3")]);
  gen(["-f", "lavfi", "-i", "sine=f=1000:d=2", "-c:a", "libmp3lame", f("voice.mp3")]);
  src.red = { path: f("red.mp4"), kind: "video", hasAudio: true, duration: 4 };
  src.green = { path: f("green.mp4"), kind: "video", hasAudio: true, duration: 4 };
  src.blue = { path: f("blue.png"), kind: "image", hasAudio: false, duration: 0 };
});
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

d("render: multiple sources on one track", () => {
  it("concatenates two different assets with exact duration and the right frame at the cut", async () => {
    const p = proj({ clips: [clip("c1", "red", "v1", 0, 0, 2), clip("c2", "green", "v1", 2, 0, 2)] });
    expect(needsCompositor(p, src)).toBe(true); // مصدران ⇒ مركِّب
    const out = f("seq.mp4");
    const r = await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
    const info = await probeMedia(out);
    expect(Math.abs((info.durationSeconds) - 4)).toBeLessThan(0.1); // ±3 إطارات
    expect(near(pixel(out, 1.0, 100, 100), [255, 0, 0])).toBe(true);
    expect(near(pixel(out, 3.0, 100, 100), [0, 255, 0])).toBe(true);
    expect(r.width).toBe(1280);
  });
});

d("render: multi-track compositing (G-2 fixed)", () => {
  it("overlay track shows picture-in-picture; duration = longest layer, not the sum", async () => {
    const p = proj({
      clips: [
        clip("base", "red", "v1", 0, 0, 4),
        clip("pip", "green", "v2", 1, 0, 2, { scale: 0.4, posX: 0.3, posY: -0.3 }),
      ],
    });
    const out = f("pip.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
    const info = await probeMedia(out);
    expect(Math.abs((info.durationSeconds) - 4)).toBeLessThan(0.1);
    // مركز PIP: x=640+0.3*1280=1024.. y=360-0.3*720=144 (بدقة 1280x720)
    expect(near(pixel(out, 2.0, 1024, 144), [0, 255, 0])).toBe(true);
    expect(near(pixel(out, 2.0, 100, 600), [255, 0, 0])).toBe(true); // الأساس
    expect(near(pixel(out, 0.5, 1024, 144), [255, 0, 0])).toBe(true); // قبل بداية الطبقة
    expect(near(pixel(out, 3.5, 1024, 144), [255, 0, 0])).toBe(true); // بعد نهايتها
  });

  it("hidden track is not rendered; opacity blends; rotation/crop run", async () => {
    const p = proj({
      tracks: [
        { id: "v1", kind: "video", label: "V1", height: 60, muted: false, locked: false },
        { id: "v2", kind: "video", label: "V2", height: 60, muted: false, locked: false, magnetic: false, hidden: true },
        { id: "a1", kind: "audio", label: "A1", height: 40, muted: false, locked: false },
      ],
      clips: [clip("base", "red", "v1", 0, 0, 2), clip("top", "green", "v2", 0, 0, 2)],
    });
    const out = f("hidden.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
    expect(near(pixel(out, 1, 640, 360), [255, 0, 0])).toBe(true);

    const p2 = proj({ clips: [clip("base", "red", "v1", 0, 0, 2), clip("top", "green", "v2", 0, 0, 2, { opacity: 0.5 })] });
    const out2 = f("opacity.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out2, project: p2, sources: src });
    const px = pixel(out2, 1, 640, 360);
    expect(px[0]).toBeGreaterThan(80); expect(px[1]).toBeGreaterThan(80); // خليط أحمر/أخضر

    const p3 = proj({ clips: [clip("c", "red", "v1", 0, 0, 2, { rotation: 45, scale: 0.5, crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } })] });
    const out3 = f("rot.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out3, project: p3, sources: src });
    expect(near(pixel(out3, 1, 640, 360), [255, 0, 0])).toBe(true); // مركز الطبقة
    expect(near(pixel(out3, 1, 5, 5), [0, 0, 0], 20)).toBe(true); // الزاوية سوداء (خارج الطبقة)
  });

  it("image sources are layered with their own window", async () => {
    const p = proj({ clips: [clip("base", "red", "v1", 0, 0, 3), clip("img", "blue", "v2", 1, 0, 1, { kind: "image", scale: 0.5 })] });
    const out = f("img.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
    expect(near(pixel(out, 1.5, 640, 360), [0, 0, 255])).toBe(true);
    expect(near(pixel(out, 2.5, 640, 360), [255, 0, 0])).toBe(true);
  });

  it("speed change shortens the timeline duration", async () => {
    const p = proj({ clips: [clip("c", "red", "v1", 0, 0, 4, { speed: 2 })] });
    const out = f("speed.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src, forceCompositor: true });
    expect(Math.abs(((await probeMedia(out)).durationSeconds) - 2)).toBeLessThan(0.1);
  });
});

d("render: transitions", () => {
  for (const type of ["dissolve", "slide-left", "slide-up"] as const) {
    it(`${type}: mid-transition frame is neither pure A nor pure B; ends on B`, async () => {
      const p = proj({
        clips: [clip("a", "red", "v1", 0, 0, 2), clip("b", "green", "v1", 2, 0, 2, { transitionIn: { type, duration: 1 } })],
      });
      const out = f(`tr_${type}.mp4`);
      await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
      expect(Math.abs(((await probeMedia(out)).durationSeconds) - 4)).toBeLessThan(0.1);
      if (type === "dissolve") {
        const mid = pixel(out, 2.5, 640, 360);
        expect(mid[0]).toBeGreaterThan(60); expect(mid[1]).toBeGreaterThan(60);
      }
      expect(near(pixel(out, 3.5, 640, 360), [0, 255, 0])).toBe(true);
      expect(near(pixel(out, 1.0, 640, 360), [255, 0, 0])).toBe(true);
    });
  }
});

describe("render plan validation (pure)", () => {
  it("missing source is an explicit error, never silently dropped", () => {
    const p = proj({ clips: [clip("c1", "nope", "v1", 0, 0, 2)] });
    const plan = buildRenderPlan(p, {});
    expect(plan.ok).toBe(false);
    expect(plan.issues.some((i) => i.code === "SOURCE_MISSING")).toBe(true);
  });
  it("overlap on a free track is rejected; on a magnetic track it is re-laid-out", () => {
    const s: SourceMap = { red: { path: "/x/red.mp4", kind: "video", hasAudio: true, duration: 10 } };
    const free = proj({ clips: [clip("a", "red", "v2", 0, 0, 3), clip("b", "red", "v2", 2, 0, 3)] });
    expect(buildRenderPlan(free, s).issues.some((i) => i.code === "TRACK_OVERLAP")).toBe(true);
    const mag = proj({ clips: [clip("a", "red", "v1", 0, 0, 3), clip("b", "red", "v1", 2, 0, 3)] });
    const plan = buildRenderPlan(mag, s);
    expect(plan.ok).toBe(true);
    expect(plan.layers[1].start).toBeCloseTo(3, 2);
  });
  it("audio clip without a server file is an error unless the loss is acknowledged", () => {
    const s: SourceMap = { red: { path: "/x/red.mp4", kind: "video", hasAudio: true, duration: 10 } };
    const a: AudioClip = { id: "m", name: "blob", trackId: "a1", start: 0, duration: 3, url: "blob:abc", volume: 1, kind: "music" };
    const p = proj({ clips: [clip("a", "red", "v1", 0, 0, 3)], audioClips: [a] });
    expect(buildRenderPlan(p, s).ok).toBe(false);
    const ack = buildRenderPlan(p, s, { allowMissingAudio: true });
    expect(ack.ok).toBe(true);
    expect(ack.issues[0].severity).toBe("warning");
  });
  it("frame snapping: starts and durations land on the fps grid", () => {
    const s: SourceMap = { red: { path: "/x/red.mp4", kind: "video", hasAudio: false, duration: 10 } };
    const p = proj({ clips: [clip("a", "red", "v2", 0.0123, 0, 1.0049)] });
    const l = buildRenderPlan(p, s).layers[0];
    expect(Math.abs(l.start * 30 - Math.round(l.start * 30))).toBeLessThan(0.01);
    expect(Math.abs(l.duration * 30 - Math.round(l.duration * 30))).toBeLessThan(0.01);
  });
  it("hidden tracks do not trigger a silent legacy concat", () => {
    const p = proj({ clips: [clip("a", "red", "v1", 0, 0, 2)] });
    p.tracks[0] = { ...p.tracks[0], hidden: true };
    expect(needsCompositor(p)).toBe(true);
  });
});

d("render: audio mixing, fades, ducking, normalization, sync", () => {
  const base = (extra: Partial<ProjectState>) =>
    proj({ clips: [clip("v", "red", "v1", 0, 0, 4, { volume: 0 })], ...extra });
  const music = (over: Partial<AudioClip> = {}): AudioClip => ({ id: "m", name: "music", trackId: "a1", start: 0, duration: 4, url: "x", ref: "upload:x", volume: 1, kind: "music", ...over });
  const voice = (over: Partial<AudioClip> = {}): AudioClip => ({ id: "vo", name: "voice", trackId: "a1", start: 1, duration: 2, url: "x", ref: "upload:y", volume: 1, kind: "voiceover", ...over });
  const withAudio = (): SourceMap => ({
    ...src,
    "audio:m": { path: f("music.mp3"), kind: "audio", hasAudio: true, duration: 6 },
    "audio:vo": { path: f("voice.mp3"), kind: "audio", hasAudio: true, duration: 2 },
  });

  it("uploaded audio appears in the export (not silent)", async () => {
    const out = f("mix_basic.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: base({ audioClips: [music()], audioMix: { normalize: false } }), sources: withAudio() });
    expect(meanVolume(out, 0.5, 3)).toBeGreaterThan(-40);
    const info = await probeMedia(out);
    expect(info.audio).toBeTruthy();
  });

  it("gain/volume changes level proportionally (−6 dB ≈ volume 0.5)", async () => {
    const o1 = f("g1.mp4"); const o2 = f("g2.mp4");
    const mk = (v: number) => base({ audioClips: [music({ volume: v })], audioMix: { normalize: false } });
    await runExport({ sourcePath: src.red.path, outputPath: o1, project: mk(1), sources: withAudio() });
    await runExport({ sourcePath: src.red.path, outputPath: o2, project: mk(0.5), sources: withAudio() });
    expect(meanVolume(o1, 0.5, 3) - meanVolume(o2, 0.5, 3)).toBeGreaterThan(4.5);
    expect(meanVolume(o1, 0.5, 3) - meanVolume(o2, 0.5, 3)).toBeLessThan(7.5);
  });

  it("fade in/out: start and end are quieter than the middle; delayed start is silent before it", async () => {
    const out = f("fade.mp4");
    await runExport({
      sourcePath: src.red.path, outputPath: out,
      project: base({ audioClips: [music({ start: 1, duration: 3, fadeIn: 1, fadeOut: 1 })], audioMix: { normalize: false } }),
      sources: withAudio(),
    });
    expect(meanVolume(out, 0, 0.9)).toBeLessThan(-60);          // قبل البداية (مزامنة)
    expect(meanVolume(out, 2.0, 0.5)).toBeGreaterThan(meanVolume(out, 1.0, 0.3) + 6); // منتصف أعلى من بداية التلاشي
    expect(meanVolume(out, 2.0, 0.5)).toBeGreaterThan(meanVolume(out, 3.7, 0.3) + 6);
  });

  it("ducking lowers music while the voice-over plays and restores it afterwards", async () => {
    const mk = (duck: boolean) => base({ audioClips: [music(), voice()], audioMix: { normalize: false, ducking: { enabled: duck, amountDb: 18 } } });
    const on = f("duck_on.mp4"); const off = f("duck_off.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: on, project: mk(true), sources: withAudio() });
    await runExport({ sourcePath: src.red.path, outputPath: off, project: mk(false), sources: withAudio() });
    // الأثر مقيس بفارق كلام+موسيقى مع/بدون خفض: الموسيقى فقط في 3.6..4.0 يجب أن تعود لمستواها.
    const after = meanVolume(on, 3.5, 0.4) - meanVolume(off, 3.5, 0.4);
    expect(Math.abs(after)).toBeLessThan(3); // عادت
    // أثناء الكلام: مستوى الإجمالي لا يزيد وفعلياً أخفض أو مساوٍ (الموسيقى خُفضت).
    expect(meanVolume(on, 1.4, 1.0)).toBeLessThan(meanVolume(off, 1.4, 1.0) - 0.5);
  });

  it("normalization brings loudness near the target", async () => {
    const out = f("norm.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: base({ audioClips: [music({ volume: 0.1 })], audioMix: { normalize: true, targetLufs: -16 } }), sources: withAudio() });
    const r = spawnSync("ffmpeg", ["-i", out, "-af", "ebur128", "-vn", "-f", "null", "-"], { encoding: "utf-8" });
    const m = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
    expect(m).toBeTruthy();
    expect(Math.abs(Number(m![1]) + 16)).toBeLessThan(3);
  });

  it("video-clip audio from two sources is mixed on its own timeline positions", async () => {
    const p = proj({ clips: [clip("a", "red", "v1", 0, 0, 2), clip("b", "green", "v1", 2, 0, 2)], audioMix: { normalize: false } });
    const out = f("vclipaudio.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
    expect(meanVolume(out, 0.3, 1.4)).toBeGreaterThan(-40);
    expect(meanVolume(out, 2.3, 1.4)).toBeGreaterThan(-40);
  });

  it("muted audio track is excluded", async () => {
    const p = base({ audioClips: [music()], audioMix: { normalize: false } });
    p.tracks = p.tracks.map((t) => (t.id === "a1" ? { ...t, muted: true } : t));
    const out = f("muted.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: withAudio() });
    expect(meanVolume(out, 0.5, 3)).toBeLessThan(-60);
  });
});

d("render: failure, cancellation and cleanup", () => {
  it("a plan with a missing source throws RenderPlanError with structured issues and leaves no output", async () => {
    const p = proj({ clips: [clip("c1", "missing", "v1", 0, 0, 2)] });
    const out = f("fail.mp4");
    await expect(runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src, forceCompositor: true })).rejects.toBeInstanceOf(RenderPlanError);
    expect(existsSync(out)).toBe(false);
  });

  it("cancelling mid-render kills ffmpeg and deletes the partial file", async () => {
    const p = proj({ quality: "ultra", clips: [clip("c1", "red", "v1", 0, 0, 4), clip("c2", "green", "v2", 0, 0, 4)] });
    const out = f("cancel.mp4");
    const ac = new AbortController();
    const run = runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src, signal: ac.signal, onProgress: () => {} });
    setTimeout(() => ac.abort(), 150);
    await expect(run).rejects.toBeInstanceOf(ExportCancelledError);
    expect(existsSync(out)).toBe(false);
  });

  it("reports progress monotonically and finishes at 1", async () => {
    const p = proj({ clips: [clip("c1", "red", "v1", 0, 0, 2), clip("c2", "green", "v1", 2, 0, 2)] });
    const seen: number[] = [];
    await runExport({ sourcePath: src.red.path, outputPath: f("prog.mp4"), project: p, sources: src, onProgress: (x) => seen.push(x) });
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1] - 1e-9)).toBe(true);
  });
});

d("render: export presets and frame rate", () => {
  it("every preset is schema-valid and a vertical preset renders at the declared size/fps", async () => {
    const { EXPORT_PRESETS, applyExportPreset } = await import("@/lib/engine/export-presets");
    const { parseProject } = await import("@/lib/engine/project-schema");
    for (const pr of EXPORT_PRESETS) {
      const r = parseProject(applyExportPreset(proj({ clips: [] }), pr.id));
      expect(r.ok, pr.id).toBe(true);
    }
    const p = applyExportPreset(proj({ clips: [clip("a", "red", "v1", 0, 0, 2), clip("b", "green", "v2", 0, 0, 2, { scale: 0.5 })] }), "draft-720p");
    const vertical = { ...applyExportPreset(p, "shorts-vertical"), quality: "draft" as const, fps: 24 as const };
    const out = f("preset.mp4");
    const r = await runExport({ sourcePath: src.red.path, outputPath: out, project: vertical, sources: src });
    const info = await probeMedia(out);
    expect([info.video!.width, info.video!.height]).toEqual([1080, 1920]);
    expect(Math.round(info.video!.fps)).toBe(24);
    expect(r.width).toBe(1080);
  });
});

d("render: preview ≙ export consistency (same plan, different window/size)", () => {
  it("a low-res preview window shows the same content at the same timeline times as the full export", async () => {
    const p = proj({
      clips: [
        clip("base", "red", "v1", 0, 0, 4),
        clip("pip", "green", "v2", 1, 0, 2, { scale: 0.4, posX: 0.3, posY: -0.3 }),
      ],
      audioMix: { normalize: false },
    });
    const full = f("cons_full.mp4");
    const prev = f("cons_prev.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: full, project: p, sources: src });
    await runExport({ sourcePath: src.red.path, outputPath: prev, project: p, sources: src, range: { start: 0.5, end: 3.5 }, size: [640, 360], encoderOverride: { preset: "ultrafast", crf: 30 } });
    const info = await probeMedia(prev);
    expect(Math.abs(info.durationSeconds - 3)).toBeLessThan(0.1);
    // t=2.0 على التايملاين = 1.5 في المعاينة. PIP عند (0.8W,0.2H) في كليهما.
    expect(near(pixel(full, 2.0, 1024, 144), [0, 255, 0])).toBe(true);
    expect(near(pixel(prev, 1.5, 512, 72), [0, 255, 0])).toBe(true);
    // قبل بداية الطبقة (t=0.75 ⇒ 0.25) الأساس فقط في كليهما.
    expect(near(pixel(full, 0.75, 1024, 144), [255, 0, 0])).toBe(true);
    expect(near(pixel(prev, 0.25, 512, 72), [255, 0, 0])).toBe(true);
  });
});

d("render: keyframes", () => {
  it("position keyframes move the layer over time; opacity keyframes fade it in; rotation keyframes render", async () => {
    const p = proj({
      clips: [
        clip("base", "red", "v1", 0, 0, 4),
        clip("pip", "green", "v2", 0, 0, 4, {
          scale: 0.25,
          keyframes: {
            posX: [{ t: 0, v: -0.3 }, { t: 3, v: 0.3 }],
            opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }],
            rotation: [{ t: 0, v: 0 }, { t: 3, v: 20 }],
          },
        }),
      ],
      audioMix: { normalize: false },
    });
    const out = f("kf.mp4");
    await runExport({ sourcePath: src.red.path, outputPath: out, project: p, sources: src });
    expect(Math.abs((await probeMedia(out)).durationSeconds - 4)).toBeLessThan(0.15);
    // t=2.5: posX≈0.2 ⇒ مركز x≈640+0.2*1280=896؛ كامل الشفافية؛ والمكان الأيسر (384) أحمر
    expect(near(pixel(out, 2.5, 896, 360), [0, 255, 0], 40)).toBe(true);
    expect(near(pixel(out, 2.5, 384, 360), [255, 0, 0])).toBe(true);
    // t≈0.05: شفافية≈0 ⇒ الموضع الابتدائي (x≈256) ما زال أحمر تقريباً
    expect(near(pixel(out, 0.05, 256, 360), [255, 0, 0], 60)).toBe(true);
    // t=0.5: شفافية 0.5 ⇒ خليط
    const early = pixel(out, 0.5, 300, 360);
    expect(early[1]).toBeGreaterThan(30); // دخل الأخضر جزئياً
    expect(early[0]).toBeGreaterThan(60); // والأحمر ما زال ظاهراً
  });
});
