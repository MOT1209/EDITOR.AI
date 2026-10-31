import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";
import { afterAll, beforeAll } from "vitest";
import { defaultProject } from "@/lib/project";
import type { AudioClip, MediaAsset, ProjectState, VideoClip } from "@/lib/types";
import { checkExportable, findForeignClips, findLostAudio } from "./export-guard";
import { POST as exportPost } from "@/app/api/export/route";
import { UPLOAD_DIR } from "@/lib/server/ffmpeg-export";

const clip = (id: string, assetId: string): VideoClip => ({
  id, assetId, trackId: "t_video", start: 0, duration: 5, inPoint: 0, outPoint: 5,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
});
const asset = (id: string): MediaAsset => ({ id, type: "video", name: id, url: `media/${id}.mp4`, duration: 10 });
const audio = (id: string, trackId = "t_audio"): AudioClip => ({ id, name: id, trackId, start: 0, duration: 3, url: "blob:http://x/1", volume: 1, kind: "music" });

const base = (): ProjectState => ({ ...defaultProject("t"), duration: 10 });

describe("T-01: foreign-asset clips are refused, not cut from the wrong source", () => {
  it("server-managed project with a clip from a second asset → UNSUPPORTED_MULTI_SOURCE", () => {
    const p = { ...base(), assets: [asset("a1"), asset("a2")], clips: [clip("c1", "a1"), clip("c2", "a2")] };
    expect(findForeignClips(p).map((c) => c.id)).toEqual(["c2"]);
    const r = checkExportable(p);
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED_MULTI_SOURCE" });
    expect(r.ok === false && r.details[0]).toContain("c2");
  });
  it("single-source and UI-synthetic ids are accepted (no regression for the editor)", () => {
    expect(checkExportable({ ...base(), clips: [clip("c1", "main"), clip("c2", "broll_0"), clip("c3", "scene_1")] }).ok).toBe(true);
    expect(checkExportable({ ...base(), assets: [asset("a1")], clips: [clip("c1", "a1"), clip("c2", "main")] }).ok).toBe(true);
  });
});

describe("T-01: lost audio requires explicit acknowledgement", () => {
  it("audio clips → AUDIO_WOULD_BE_LOST unless acknowledged; muted tracks ignored", () => {
    const p = { ...base(), audioClips: [audio("music1")] };
    expect(findLostAudio(p)).toEqual(["music1"]);
    expect(checkExportable(p)).toMatchObject({ ok: false, code: "AUDIO_WOULD_BE_LOST" });
    const ack = checkExportable(p, { acknowledgeAudioLoss: true });
    expect(ack.ok).toBe(true);
    expect(ack.ok && ack.warnings.length).toBe(1);
    const muted = { ...p, tracks: p.tracks.map((t) => (t.id === "t_audio" ? { ...t, muted: true } : t)) };
    expect(findLostAudio(muted)).toEqual([]);
  });
  it("musicId alone also counts", () => {
    expect(checkExportable({ ...base(), musicId: "m1" })).toMatchObject({ ok: false, code: "AUDIO_WOULD_BE_LOST" });
  });
  it("no extra audio → ok with no warnings", () => {
    expect(checkExportable(base())).toEqual({ ok: true, warnings: [] });
  });
});

describe("POST /api/export enforces the guard with 409", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  beforeAll(() => { mkdirSync(UPLOAD_DIR, { recursive: true }); writeFileSync(path.join(UPLOAD_DIR, `${id}.mp4`), "x"); });
  afterAll(() => rmSync(path.join(UPLOAD_DIR, `${id}.mp4`), { force: true }));
  const call = (project: unknown, extra: Record<string, unknown> = {}) =>
    exportPost(new NextRequest("http://localhost/api/export", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ sourceRef: `upload:${id}`, project, ...extra }),
    }));

  it("audio clip without acknowledgement → 409 AUDIO_WOULD_BE_LOST", async () => {
    const res = await call({ ...base(), audioClips: [audio("m")] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("AUDIO_WOULD_BE_LOST");
  });
  it("foreign asset clip → 409 UNSUPPORTED_MULTI_SOURCE", async () => {
    const res = await call({ ...base(), assets: [asset("a1"), asset("a2")], clips: [clip("c1", "a1"), clip("c2", "a2")] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("UNSUPPORTED_MULTI_SOURCE");
  });
});
