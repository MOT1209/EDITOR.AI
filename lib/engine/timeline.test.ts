import { describe, it, expect } from "vitest";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import {
  addCaptions,
  addTextOverlay,
  applyEffect,
  deleteClip,
  exportClips,
  moveClip,
  setClipVolume,
  splitClip,
  summarizeTimeline,
  timelineDuration,
  trimClip,
} from "./timeline";
import { EngineError } from "./errors";
import { parseProject } from "./project-schema";

function clip(id: string, inPoint: number, outPoint: number, start = 0): VideoClip {
  return {
    id, assetId: "a1", trackId: "t_video", start, duration: outPoint - inPoint, inPoint, outPoint,
    effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
  };
}

function project(clips: VideoClip[] = [clip("c1", 0, 30)]): ProjectState {
  return {
    ...defaultProject("t"),
    duration: 30,
    clips,
    assets: [{ id: "a1", type: "video", name: "v.mp4", url: "media/a1.mp4", duration: 30 }],
  };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as EngineError).code;
  }
  return "NO_ERROR";
};

describe("timeline ops", () => {
  it("split produces two contiguous clips covering the same source", () => {
    const { project: p, newClipId } = splitClip(project(), "c1", 10);
    const clips = exportClips(p);
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ id: "c1", start: 0, inPoint: 0, outPoint: 10, duration: 10 });
    expect(clips[1]).toMatchObject({ id: newClipId, start: 10, inPoint: 10, outPoint: 30, duration: 20 });
    expect(timelineDuration(p)).toBe(30);
  });

  it("split respects speed when mapping timeline → source time", () => {
    const p0 = project([{ ...clip("c1", 0, 20), speed: 2, duration: 10 }]);
    const { project: p } = splitClip(p0, "c1", 5);
    const [a, b] = exportClips(p);
    expect(a.outPoint).toBe(10);
    expect(b.inPoint).toBe(10);
    expect(timelineDuration(p)).toBe(10);
  });

  it("split rejects times at or outside the clip edges", () => {
    expect(code(() => splitClip(project(), "c1", 0))).toBe("OUT_OF_RANGE");
    expect(code(() => splitClip(project(), "c1", 30))).toBe("OUT_OF_RANGE");
    expect(code(() => splitClip(project(), "missing", 5))).toBe("NOT_FOUND");
  });

  it("trim ripples later clips and validates source bounds", () => {
    let p = splitClip(project(), "c1", 10).project;
    p = trimClip(p, "c1", { inPoint: 2 });
    const [a, b] = exportClips(p);
    expect(a).toMatchObject({ start: 0, inPoint: 2, duration: 8 });
    expect(b.start).toBe(8);
    expect(code(() => trimClip(p, "c1", { outPoint: 99 }))).toBe("OUT_OF_RANGE");
    expect(code(() => trimClip(p, "c1", { inPoint: 9.99, outPoint: 10 }))).toBe("OUT_OF_RANGE");
    expect(code(() => trimClip(p, "c1", { inPoint: -1 }))).toBe("INVALID_INPUT");
  });

  it("move reorders within the track and recomputes starts", () => {
    let p = splitClip(project(), "c1", 10).project;
    const second = exportClips(p)[1].id;
    p = moveClip(p, second, 0);
    const [a, b] = exportClips(p);
    expect(a).toMatchObject({ id: second, start: 0, inPoint: 10 });
    expect(b).toMatchObject({ id: "c1", start: 20 });
    expect(code(() => moveClip(p, "c1", 5))).toBe("OUT_OF_RANGE");
  });

  it("delete closes the gap; locked tracks refuse edits", () => {
    let p = splitClip(project(), "c1", 10).project;
    p = deleteClip(p, "c1");
    expect(exportClips(p)[0].start).toBe(0);
    expect(timelineDuration(p)).toBe(20);
    const locked = { ...p, tracks: p.tracks.map((t) => (t.id === "t_video" ? { ...t, locked: true } : t)) };
    expect(code(() => setClipVolume(locked, exportClips(p)[0].id, 0.5))).toBe("CONFLICT");
  });

  it("image clips keep absolute time and are not rippled", () => {
    const img: VideoClip = { ...clip("img", 0, 0, 12), kind: "image", duration: 3, imageUrl: "/x.png" };
    const p = splitClip(project([clip("c1", 0, 30), img]), "c1", 5).project;
    expect(p.clips.find((c) => c.id === "img")!.start).toBe(12);
  });

  it("volume, overlays, captions and effects validate their ranges", () => {
    const p = project();
    expect(code(() => setClipVolume(p, "c1", 3))).toBe("OUT_OF_RANGE");
    expect(addTextOverlay(p, { text: "مرحبا", start: 1, end: 3 }).project.textOverlays).toHaveLength(1);
    expect(code(() => addTextOverlay(p, { text: "x", start: 40, end: 41 }))).toBe("OUT_OF_RANGE");
    expect(code(() => addTextOverlay(p, { text: "x", start: 1, end: 2, color: "red" }))).toBe("INVALID_INPUT");
    const c = addCaptions(p, [{ start: 0, end: 2, text: "أ" }, { start: 2, end: 4, text: "ب" }]);
    expect(c.added).toBe(2);
    expect(code(() => addCaptions(p, [{ start: 0, end: 3, text: "أ" }, { start: 2, end: 4, text: "ب" }]))).toBe("CONFLICT");
    expect(applyEffect(p, { kind: "project_effect", effectId: "fx_fade", enabled: true }).effects).toEqual(["fx_fade"]);
    expect(code(() => applyEffect(p, { kind: "project_effect", effectId: "rm -rf", enabled: true }))).toBe("INVALID_INPUT");
    expect(applyEffect(p, { kind: "color_filter", clipId: "c1", filter: "bw" }).clips[0].colorFilter).toBe("bw");
  });

  it("every op output still satisfies the project schema", () => {
    let p = project();
    p = splitClip(p, "c1", 7).project;
    p = addCaptions(p, [{ start: 0, end: 1, text: "x" }]).project;
    p = addTextOverlay(p, { text: "y", start: 1, end: 2 }).project;
    const r = parseProject(p);
    expect(r.ok).toBe(true);
    expect(summarizeTimeline(p).clips).toHaveLength(2);
  });
});

describe("project schema", () => {
  it("rejects a path-traversal export format (audit S-1)", () => {
    const r = parseProject({ ...project(), format: "/../../../../tmp/pwned" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-finite and out-of-range numbers", () => {
    expect(parseProject({ ...project(), fps: 1000 }).ok).toBe(false);
    expect(parseProject({ ...project(), clips: [{ ...clip("c", 0, 1), speed: Infinity }] }).ok).toBe(false);
    expect(parseProject({ ...project(), resolution: "8k" }).ok).toBe(false);
  });

  it("migrates a legacy v1 project with missing arrays", () => {
    const legacy: Record<string, unknown> = { ...project() };
    delete legacy.subtitles;
    delete legacy.schemaVersion;
    const r = parseProject(legacy);
    expect(r.ok && r.migrated && r.project.subtitles.length === 0 && r.project.schemaVersion === 2).toBe(true);
  });

  it("keeps unknown clip keys used by the editor (e.g. _removed)", () => {
    const r = parseProject({ ...project([{ ...clip("c", 0, 1), _removed: true } as VideoClip]) });
    expect(r.ok && (r.project.clips[0] as VideoClip & { _removed?: boolean })._removed).toBe(true);
  });
});
