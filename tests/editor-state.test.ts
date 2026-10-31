import { describe, it, expect, vi, afterEach } from "vitest";
import { initialState, reducer, HISTORY_COALESCE_MS, type State } from "@/components/editor/state";
import { splitClip } from "@/lib/engine/timeline";
import type { VideoClip } from "@/lib/types";

const clip: VideoClip = {
  id: "c1", assetId: "main", trackId: "t_video", start: 0, duration: 20, inPoint: 0, outPoint: 20,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
};

afterEach(() => vi.useRealTimers());

describe("editor reducer undo/redo", () => {
  it("undoes and redoes a tracked edit", () => {
    vi.useFakeTimers();
    let s: State = reducer(initialState, { type: "ADD_CLIP", clip });
    vi.advanceTimersByTime(HISTORY_COALESCE_MS + 1);
    s = reducer(s, { type: "UPDATE_CLIP", id: "c1", patch: { volume: 0.3 } });
    expect(s.past).toHaveLength(2);
    s = reducer(s, { type: "UNDO" });
    expect(s.project.clips[0].volume).toBe(1);
    s = reducer(s, { type: "UNDO" });
    expect(s.project.clips).toHaveLength(0);
    s = reducer(s, { type: "REDO" });
    s = reducer(s, { type: "REDO" });
    expect(s.project.clips[0].volume).toBe(0.3);
    expect(reducer(s, { type: "REDO" })).toBe(s); // لا شيء للإعادة
  });

  it("coalesces a burst of actions (e.g. an AI tool) into one undo step", () => {
    vi.useFakeTimers();
    let s = initialState;
    for (let i = 0; i < 5; i++) s = reducer(s, { type: "ADD_CLIP", clip: { ...clip, id: `c${i}` } });
    expect(s.past).toHaveLength(1);
    expect(reducer(s, { type: "UNDO" }).project.clips).toHaveLength(0);
  });

  it("does not record UI-only actions and resets history on project load", () => {
    let s = reducer(initialState, { type: "SET_PLAYHEAD", t: 3 });
    expect(s.past).toHaveLength(0);
    s = reducer(s, { type: "ADD_CLIP", clip });
    s = reducer(s, { type: "REPLACE_PROJECT", project: initialState.project });
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
  });

  it("a new edit clears the redo stack", () => {
    vi.useFakeTimers();
    let s = reducer(initialState, { type: "ADD_CLIP", clip });
    s = reducer(s, { type: "UNDO" });
    expect(s.future).toHaveLength(1);
    vi.advanceTimersByTime(HISTORY_COALESCE_MS + 1);
    s = reducer(s, { type: "SET_ASPECT", aspect: "9:16" });
    expect(s.future).toHaveLength(0);
  });

  it("COMMIT_PROJECT applies shared engine ops (split) as one undoable step", () => {
    vi.useFakeTimers();
    let s = reducer(initialState, { type: "ADD_CLIP", clip });
    vi.advanceTimersByTime(HISTORY_COALESCE_MS + 1);
    s = reducer(s, { type: "COMMIT_PROJECT", project: splitClip(s.project, "c1", 8).project });
    expect(s.project.clips.map((c) => [c.start, c.duration])).toEqual([[0, 8], [8, 12]]);
    s = reducer(s, { type: "UNDO" });
    expect(s.project.clips).toHaveLength(1);
  });
});

describe("editor reducer: selection and snapping state (Phase 4)", () => {
  it("multi-select keeps the last id as primary; single select and audio select are exclusive", () => {
    let s = reducer(initialState, { type: "SELECT_CLIPS", ids: ["a", "b", "c"] });
    expect(s.selectedClipIds).toEqual(["a", "b", "c"]);
    expect(s.selectedClipId).toBe("c");
    s = reducer(s, { type: "SELECT_AUDIO", id: "au1" });
    expect(s).toMatchObject({ selectedAudioId: "au1", selectedClipId: null, selectedClipIds: [] });
    s = reducer(s, { type: "SELECT_CLIP", id: "x" });
    expect(s).toMatchObject({ selectedAudioId: null, selectedClipId: "x", selectedClipIds: ["x"] });
    expect(reducer(s, { type: "SELECT_CLIP", id: null }).selectedClipIds).toEqual([]);
  });
  it("selection and snap toggles are UI-only (no undo entries)", () => {
    let s = reducer(initialState, { type: "TOGGLE_SNAP" });
    expect(s.snapEnabled).toBe(false);
    s = reducer(s, { type: "SELECT_CLIPS", ids: ["a"] });
    expect(s.past).toHaveLength(0);
  });
});
