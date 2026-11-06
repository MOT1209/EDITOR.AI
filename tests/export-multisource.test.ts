import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { spawnSync } from "child_process";
import { copyFileSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import { EXPORT_DIR, UPLOAD_DIR, hasFfmpeg, readJobStatus } from "@/lib/server/ffmpeg-export";
import { POST as exportPost } from "@/app/api/export/route";

const FF = hasFfmpeg();
const MAIN = "dddddddd-0000-4000-8000-000000000001";
const RED = "dddddddd-0000-4000-8000-000000000002";
const SILENT_BLUE = "dddddddd-0000-4000-8000-000000000003";
const created: string[] = [];

const clip = (id: string, assetId: string, start: number, inP: number, outP: number): VideoClip => ({
  id, assetId, trackId: "t_video", start, duration: outP - inP, inPoint: inP, outPoint: outP,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
});

/** متوسط لون إطار عند الزمن t كـ [r,g,b]. */
function colourAt(file: string, t: number): [number, number, number] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1024 });
  const b = r.stdout;
  return [b[0], b[1], b[2]];
}
const probeDur = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf-8" }).stdout);
const hasAudio = (f: string) => spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", f], { encoding: "utf-8" }).stdout.includes("audio");

async function run(project: ProjectState, sources: unknown) {
  const res = await exportPost(new NextRequest("http://localhost/api/export", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRef: `upload:${MAIN}`, sources, project }),
  }));
  const body = await res.json();
  if (res.status !== 200) return { status: res.status, body, file: "" };
  const id = body.job.id as string;
  for (let i = 0; i < 200; i++) {
    const st = await readJobStatus(id);
    if (st?.status === "completed") {
      const file = path.join(EXPORT_DIR, `${id}.${project.format}`);
      created.push(file, path.join(EXPORT_DIR, `${id}.json`));
      return { status: 200, body, file };
    }
    if (st?.status === "failed") throw new Error(st.message);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timeout");
}

beforeAll(() => {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  copyFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"), path.join(UPLOAD_DIR, `${MAIN}.mp4`));
  const gen = (id: string, colour: string, audio: boolean) => {
    const args = ["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=320x240:r=25:d=4`, ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=300:duration=4"] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac", "-shortest"] : []), path.join(UPLOAD_DIR, `${id}.mp4`)];
    expect(spawnSync("ffmpeg", args).status).toBe(0);
  };
  if (FF) { gen(RED, "red", true); gen(SILENT_BLUE, "blue", false); }
});
afterAll(() => {
  for (const id of [MAIN, RED, SILENT_BLUE]) rmSync(path.join(UPLOAD_DIR, `${id}.mp4`), { force: true });
  for (const f of created) rmSync(f, { force: true });
});

describe.runIf(FF)("T-02: real multi-source export", () => {
  const base = (clips: VideoClip[]): ProjectState => ({
    ...defaultProject("t"), duration: 10, resolution: "720p", fps: 30, assets: [{ id: "main", type: "video", name: "m", url: "x", duration: 30 }], clips,
  });

  it("second half of the output comes from the second asset (red), first from the main video", async () => {
    const p = base([clip("c1", "main", 0, 0, 3), clip("c2", "red", 3, 0, 3)]);
    const r = await run(p, [{ assetId: "red", ref: `upload:${RED}` }]);
    expect(r.status).toBe(200);
    expect(probeDur(r.file)).toBeGreaterThan(5.8);
    expect(probeDur(r.file)).toBeLessThan(6.3);
    const [cr, cg, cb] = colourAt(r.file, 4.5);
    expect(cr).toBeGreaterThan(150); // أحمر
    expect(cg).toBeLessThan(90);
    expect(cb).toBeLessThan(90);
    const [mr, , mb] = colourAt(r.file, 1.0);
    expect(mr > 150 && mb < 90).toBe(false); // الجزء الأول ليس الأحمر
    expect(hasAudio(r.file)).toBe(true);
  }, 120_000);

  it("a silent second source still exports (generated silence) and is picked up", async () => {
    const p = base([clip("c1", "main", 0, 0, 2), clip("c2", "blue", 2, 0, 2)]);
    const r = await run(p, [{ assetId: "blue", ref: `upload:${SILENT_BLUE}` }]);
    expect(r.status).toBe(200);
    const [cr, , cb] = colourAt(r.file, 3);
    expect(cb).toBeGreaterThan(150);
    expect(cr).toBeLessThan(90);
    expect(hasAudio(r.file)).toBe(true);
  }, 120_000);

  it("unknown/invalid sources are refused; unmapped foreign asset still 409", async () => {
    const p = base([clip("c1", "main", 0, 0, 2), clip("c2", "red", 2, 0, 2)]);
    expect((await run(p, [{ assetId: "red", ref: "/etc/passwd" }])).status).toBe(400);
    expect((await run(p, [{ assetId: "../x", ref: `upload:${RED}` }])).status).toBe(400);
    expect((await run(p, "nope")).status).toBe(400);
    expect((await run(p, undefined)).status).toBe(409); // red بلا مصدر ⇒ رفض صريح (T-01)
  });
});
