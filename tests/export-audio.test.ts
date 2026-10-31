import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { AudioClip, ProjectState } from "@/lib/types";
import { EXPORT_DIR, UPLOAD_DIR, hasFfmpeg, readJobStatus } from "@/lib/server/ffmpeg-export";
import { AUDIO_DIR } from "@/lib/server/media-ref";
import { checkExportable, findLostAudio } from "@/lib/engine/export-guard";
import { POST as audioUpload } from "@/app/api/assets/audio/route";
import { POST as exportPost } from "@/app/api/export/route";

const FF = hasFfmpeg();
const VIDEO_ID = "cccccccc-dddd-4eee-8fff-000000000001";
let tmp = "";
const created: string[] = [];

const upload = (bytes: Buffer, name: string, type: string) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return audioUpload(new NextRequest("http://localhost/api/assets/audio", { method: "POST", body: form }));
};
const meanVolume = (file: string): number => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf-8" });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : NaN;
};
async function runExportJob(project: ProjectState, extra: Record<string, unknown> = {}) {
  const res = await exportPost(new NextRequest("http://localhost/api/export", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRef: `upload:${VIDEO_ID}`, project, ...extra }),
  }));
  const body = await res.json();
  if (res.status !== 200) return { status: res.status, body, file: "" };
  const id = body.job.id as string;
  for (let i = 0; i < 120; i++) {
    const st = await readJobStatus(id);
    if (st?.status === "completed") { const f = path.join(EXPORT_DIR, `${id}.${project.format}`); created.push(f, path.join(EXPORT_DIR, `${id}.json`)); return { status: 200, body, file: f }; }
    if (st?.status === "failed") throw new Error(st.message);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("export timeout");
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "montage-audio-"));
  mkdirSync(UPLOAD_DIR, { recursive: true });
  copyFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"), path.join(UPLOAD_DIR, `${VIDEO_ID}.mp4`));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(UPLOAD_DIR, `${VIDEO_ID}.mp4`), { force: true });
  for (const f of created) rmSync(f, { force: true });
});

describe.runIf(FF)("T-13: server audio assets enter the exported file", () => {
  let tone: Buffer;
  beforeAll(() => {
    const f = path.join(tmp, "tone.wav");
    const r = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ar", "44100", f]);
    expect(r.status).toBe(0);
    tone = readFileSync(f);
  });

  it("uploads real audio → opaque ref, no disk path; fake/oversize/video-only rejected", async () => {
    const ok = await upload(tone, "tone.wav", "audio/wav");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ref).toMatch(/^audio:[0-9a-f-]{36}\.wav$/);
    expect(body.durationSeconds).toBeGreaterThan(3);
    expect(JSON.stringify(body)).not.toContain(process.cwd());
    created.push(path.join(AUDIO_DIR, body.ref.slice(6)));

    const fake = await upload(Buffer.from("not audio at all"), "x.mp3", "audio/mpeg");
    expect(fake.status).toBe(400);
    const bad = await upload(tone, "x.exe", "application/octet-stream");
    expect(bad.status).toBe(400);
    const big = await audioUpload(new NextRequest("http://localhost/api/assets/audio", { method: "POST", headers: { "content-length": String(50 * 1024 ** 3), "content-type": "multipart/form-data; boundary=x" }, body: "x" }));
    expect(big.status).toBe(413);
  });

  it("guard: clip with a server ref is no longer 'lost'; without ref still is", async () => {
    const { ref } = await (await upload(tone, "t.wav", "audio/wav")).json();
    created.push(path.join(AUDIO_DIR, ref.slice(6)));
    const clip: AudioClip = { id: "a1", name: "tone", trackId: "t_audio", start: 0, duration: 4, url: "blob:x", volume: 1, kind: "music" };
    const p = { ...defaultProject("t"), duration: 6, audioClips: [{ ...clip, ref }] };
    expect(findLostAudio(p)).toEqual([]);
    expect(checkExportable(p).ok).toBe(true);
    expect(findLostAudio({ ...p, audioClips: [clip] })).toEqual(["tone"]);
  });

  it("real export: audio from a ref is mixed into the output (louder than the same export without it)", async () => {
    const { ref } = await (await upload(tone, "t.wav", "audio/wav")).json();
    created.push(path.join(AUDIO_DIR, ref.slice(6)));
    const clip: AudioClip = { id: "a1", name: "tone", trackId: "t_audio", start: 0, duration: 4, url: "blob:x", volume: 1, kind: "music" };
    const base: ProjectState = { ...defaultProject("t"), duration: 6, resolution: "720p", clips: [] };
    const plain = await runExportJob(base);
    const mixed = await runExportJob({ ...base, audioClips: [{ ...clip, ref }] });
    expect(plain.status).toBe(200);
    expect(mixed.status).toBe(200);
    expect(existsSync(mixed.file) && statSync(mixed.file).size).toBeGreaterThan(0);
    const a = meanVolume(plain.file);
    const b = meanVolume(mixed.file);
    expect(b).toBeGreaterThan(a + 1.5); // النغمة المرفوعة رفعت المستوى فعلاً
  }, 120_000);

  it("export without ack is 409; a ref to a missing file is 400", async () => {
    const clip: AudioClip = { id: "a1", name: "tone", trackId: "t_audio", start: 0, duration: 4, url: "blob:x", volume: 1, kind: "music" };
    const base: ProjectState = { ...defaultProject("t"), duration: 6 };
    expect((await runExportJob({ ...base, audioClips: [clip] })).status).toBe(409);
    const missing = "audio:00000000-0000-4000-8000-000000000000.wav";
    expect((await runExportJob({ ...base, audioClips: [{ ...clip, ref: missing }] })).status).toBe(400);
  });
});
