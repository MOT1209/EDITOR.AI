import { describe, expect, it } from "vitest";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import {
  addTrack, mergeClips, moveClipToTrack, removeTrack, setAudioClipProps, setClipProps, setTrackFlags,
  snapTime, splitAudioClip, splitClip, timelineDuration, trimClip,
} from "./timeline";
import { EngineError } from "./errors";

const mk = (id: string, trackId: string, start: number, inP: number, outP: number, assetId = "a"): VideoClip => ({
  id, assetId, trackId, start, duration: outP - inP, inPoint: inP, outPoint: outP,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
});
function base(): ProjectState {
  const p = defaultProject("t");
  return { ...p, fps: 30, duration: 20, tracks: [{ ...p.tracks[0], id: "v1" }, { id: "v2", kind: "video", label: "V2", height: 60, muted: false, locked: false, magnetic: false }, p.tracks[2]], clips: [] };
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return null; };

describe("split → merge round-trip", () => {
  it("merges the two halves back into the original clip", () => {
    const p0 = { ...base(), clips: [mk("c", "v1", 0, 0, 10)] };
    const { project: p1, newClipId } = splitClip(p0, "c", 4);
    expect(p1.clips).toHaveLength(2);
    const p2 = mergeClips(p1, "c", newClipId);
    expect(p2.clips).toHaveLength(1);
    expect(p2.clips[0]).toMatchObject({ inPoint: 0, outPoint: 10, start: 0 });
  });
  it("refuses to merge when source is discontinuous or assets differ", () => {
    const p = { ...base(), clips: [mk("a", "v1", 0, 0, 3), mk("b", "v1", 3, 5, 8)] };
    expect(code(() => mergeClips(p, "a", "b"))).toBe("CONFLICT");
    const q = { ...base(), clips: [mk("a", "v1", 0, 0, 3), mk("b", "v1", 3, 3, 6, "other")] };
    expect(code(() => mergeClips(q, "a", "b"))).toBe("CONFLICT");
  });
});

describe("multi-track layout", () => {
  it("free track keeps absolute positions; magnetic track ripples", () => {
    let p = { ...base(), clips: [mk("m1", "v1", 0, 0, 3), mk("m2", "v1", 3, 0, 3), mk("f1", "v2", 1, 0, 2)] };
    p = trimClip(p, "m1", { outPoint: 1 });
    expect(p.clips.find((c) => c.id === "m2")!.start).toBeCloseTo(1, 3); // ripple
    expect(p.clips.find((c) => c.id === "f1")!.start).toBe(1); // حرّ
  });
  it("timeline duration = longest layer when tracks overlap", () => {
    const p = { ...base(), clips: [mk("m1", "v1", 0, 0, 3), mk("f1", "v2", 2, 0, 5)] };
    expect(timelineDuration(p)).toBeCloseTo(7, 2);
  });
  it("moveClipToTrack: rejects overlap on a free track and places on empty space", () => {
    const p = { ...base(), clips: [mk("m1", "v1", 0, 0, 3), mk("f1", "v2", 0, 0, 4)] };
    expect(code(() => moveClipToTrack(p, "m1", "v2", 2))).toBe("CONFLICT");
    const ok = moveClipToTrack(p, "m1", "v2", 4.01);
    const moved = ok.clips.find((c) => c.id === "m1")!;
    expect(moved.trackId).toBe("v2");
    expect(Math.abs(moved.start * 30 - Math.round(moved.start * 30))).toBeLessThan(1e-6); // شبكة إطارات
  });
  it("locked tracks are not editable", () => {
    const p = setTrackFlags({ ...base(), clips: [mk("m1", "v1", 0, 0, 3)] }, "v1", { locked: true });
    expect(code(() => setClipProps(p, "m1", { opacity: 0.5 }))).toBe("CONFLICT");
  });
  it("add/remove track; removing a used or last track is refused", () => {
    const { project, trackId } = addTrack(base(), "video", { magnetic: false });
    expect(project.tracks.find((t) => t.id === trackId)).toBeTruthy();
    expect(removeTrack(project, trackId).tracks.some((t) => t.id === trackId)).toBe(false);
    const used = { ...project, clips: [mk("x", trackId, 0, 0, 1)] };
    expect(code(() => removeTrack(used, trackId))).toBe("CONFLICT");
    const lone = { ...base(), tracks: [base().tracks[0]] };
    expect(code(() => removeTrack(lone, "v1"))).toBe("CONFLICT");
  });
  it("track flags: mute / hide / magnetic", () => {
    let p = base();
    p = setTrackFlags(p, "v2", { hidden: true, muted: true });
    expect(p.tracks.find((t) => t.id === "v2")).toMatchObject({ hidden: true, muted: true });
    expect(code(() => setTrackFlags(p, "t_audio", { hidden: true }))).toBe("INVALID_INPUT");
  });
});

describe("setClipProps validation (single source of ranges)", () => {
  const p = { ...base(), clips: [mk("c", "v1", 0, 0, 4)] };
  it("applies transform/opacity/crop/transition and recomputes duration for speed", () => {
    const q = setClipProps(p, "c", { rotation: 90, opacity: 0.4, scale: 0.5, posX: 0.2, crop: { left: 0.1, top: 0, right: 0, bottom: 0 }, transitionIn: { type: "dissolve", duration: 0.5 }, speed: 2 });
    const c = q.clips[0];
    expect(c).toMatchObject({ rotation: 90, opacity: 0.4, scale: 0.5, speed: 2 });
    expect(c.duration).toBeCloseTo(2, 3);
    expect(setClipProps(q, "c", { transitionIn: null }).clips[0].transitionIn).toBeUndefined();
  });
  it("rejects out-of-range and unknown values", () => {
    expect(code(() => setClipProps(p, "c", { opacity: 2 }))).toBe("OUT_OF_RANGE");
    expect(code(() => setClipProps(p, "c", { speed: 0 }))).toBe("OUT_OF_RANGE");
    expect(code(() => setClipProps(p, "c", { colorFilter: "nope" }))).toBe("INVALID_INPUT");
    expect(code(() => setClipProps(p, "c", { effects: ["fx_nope"] }))).toBe("INVALID_INPUT");
    expect(code(() => setClipProps(p, "c", { id: "zzz" } as never))).toBe("INVALID_INPUT");
  });
});

describe("audio clip ops", () => {
  const a = { id: "au", name: "m", trackId: "t_audio", start: 0, duration: 10, url: "x", volume: 1, kind: "music" as const };
  const p = { ...base(), audioClips: [a] };
  it("split keeps total length and advances inPoint", () => {
    const { project, newClipId } = splitAudioClip(p, "au", 4);
    const second = project.audioClips.find((x) => x.id === newClipId)!;
    expect(second).toMatchObject({ start: 4, inPoint: 4, duration: 6 });
  });
  it("fades/volume validated; negative duration rejected", () => {
    expect(setAudioClipProps(p, "au", { fadeIn: 2, volume: 0.5 }).audioClips[0]).toMatchObject({ fadeIn: 2, volume: 0.5 });
    expect(code(() => setAudioClipProps(p, "au", { volume: 9 }))).toBe("OUT_OF_RANGE");
    expect(code(() => setAudioClipProps(p, "au", { trackId: "v1" }))).toBe("INVALID_INPUT");
  });
});

describe("snapping and frame quantization", () => {
  const p = { ...base(), clips: [mk("m1", "v1", 0, 0, 3), mk("m2", "v1", 3, 0, 2)] };
  it("snaps to clip edges within threshold, else to the frame grid", () => {
    expect(snapTime(p, 2.93)).toMatchObject({ time: 3, snapped: true });
    const s = snapTime(p, 4.0123, { threshold: 0.01 });
    expect(s.snapped).toBe(false);
    expect(Math.abs(s.time * 30 - Math.round(s.time * 30))).toBeLessThan(0.02);
    expect(snapTime(p, 1.5, { playhead: 1.52 })).toMatchObject({ time: 1.52, snapped: true, to: "رأس التشغيل" });
  });
});

import { removeClipKeyframe, setClipKeyframe } from "./timeline";
import { keyframeExpr } from "./render-compile";

describe("keyframes (ops + expression)", () => {
  const p = { ...base(), clips: [mk("c", "v2", 0, 0, 4)] };
  it("adds sorted keyframes on the frame grid, replaces same-time, removes, validates ranges", () => {
    let q = setClipKeyframe(p, "c", "opacity", 2, 1);
    q = setClipKeyframe(q, "c", "opacity", 0, 0);
    q = setClipKeyframe(q, "c", "opacity", 2.001, 0.5); // يستبدل مفتاح t=2
    expect(q.clips[0].keyframes!.opacity).toEqual([{ t: 0, v: 0 }, { t: 2, v: 0.5 }]);
    expect(removeClipKeyframe(q, "c", "opacity", 0).clips[0].keyframes!.opacity).toHaveLength(1);
    expect(removeClipKeyframe(removeClipKeyframe(q, "c", "opacity", 0), "c", "opacity", 2).clips[0].keyframes?.opacity).toBeUndefined();
    expect(code(() => setClipKeyframe(p, "c", "opacity", 1, 2))).toBe("OUT_OF_RANGE");
    expect(code(() => setClipKeyframe(p, "c", "opacity", 99, 0.5))).toBe("OUT_OF_RANGE");
    expect(code(() => setClipKeyframe(p, "c", "scale" as never, 1, 1))).toBe("INVALID_INPUT");
    expect(code(() => removeClipKeyframe(p, "c", "opacity", 1))).toBe("NOT_FOUND");
  });
  it("expression: holds before first / after last and interpolates linearly", () => {
    const e = keyframeExpr([{ t: 1, v: 0 }, { t: 3, v: 10 }], "T");
    // تقييم بدائي للتعبير (if/lt فقط) للتحقق من الدلالة
    const ev = (T: number) => new Function("T", "lt", "if_", `return ${e.replace(/if\(/g, "if_(")}`)(T, (a: number, b: number) => (a < b ? 1 : 0), (c: number, a: number, b: number) => (c ? a : b));
    expect(ev(0)).toBe(0);
    expect(ev(2)).toBeCloseTo(5, 5);
    expect(ev(5)).toBe(10);
    expect(keyframeExpr([{ t: 0, v: 0.7 }], "T")).toBe("0.7");
  });
});
