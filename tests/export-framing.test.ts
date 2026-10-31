import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import path from "path";
import { defaultProject } from "@/lib/project";
import type { ProjectState, VideoClip } from "@/lib/types";
import { EXPORT_DIR, UPLOAD_DIR, buildExportPlan, clipFraming, hasFfmpeg, readJobStatus } from "@/lib/server/ffmpeg-export";
import { POST as exportPost } from "@/app/api/export/route";

const FF = hasFfmpeg();
const SPLIT = "eeeeeeee-0000-4000-8000-000000000001"; // يسار أحمر | يمين أزرق
const created: string[] = [];

const clip = (extra: Partial<VideoClip> = {}): VideoClip => ({
  id: "c1", assetId: "main", trackId: "t_video", start: 0, duration: 3, inPoint: 0, outPoint: 3,
  effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none", ...extra,
});

describe("clipFraming (pure)", () => {
  it("only applies when smartZoom is on and there is an actual effect; clamps inputs", () => {
    expect(clipFraming(clip({ zoom: 2, smartZoom: false }))).toBeUndefined();
    expect(clipFraming(clip({ smartZoom: true }))).toBeUndefined();
    expect(clipFraming(clip({ smartZoom: true, zoom: 2, panX: 0.25 }))).toEqual({ zoom: 2, panX: 0.25, panY: 0 });
    expect(clipFraming(clip({ smartZoom: true, zoom: 99, panX: 9, panY: -9 }))).toEqual({ zoom: 4, panX: 0.5, panY: -0.5 });
    expect(clipFraming(clip({ smartZoom: true, zoom: NaN as unknown as number, panX: 0.3 }))).toEqual({ zoom: 1, panX: 0.3, panY: 0 });
  });
  it("builds a crop filter before the scale step", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 3, clips: [clip({ smartZoom: true, zoom: 2, panX: 0.25 })] };
    const fc = buildExportPlan({ sourcePath: "/a.mp4", outputPath: "/o.mp4", project: p }, { allowNvenc: false }).args.join(" ");
    expect(fc.indexOf("crop=w=iw/2:h=ih/2")).toBeGreaterThan(-1);
    expect(fc.indexOf("crop=w=iw/2")).toBeLessThan(fc.indexOf("scale="));
  });
  it("no crop when framing is off (no regression for ordinary clips)", () => {
    const p: ProjectState = { ...defaultProject("t"), duration: 3, clips: [clip({ zoom: 1.1 })] };
    expect(buildExportPlan({ sourcePath: "/a.mp4", outputPath: "/o.mp4", project: p }, { allowNvenc: false }).args.join(" ")).not.toContain("iw/1.1");
  });
});

function colourAt(file: string, t: number): [number, number, number] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1024 });
  return [r.stdout[0], r.stdout[1], r.stdout[2]];
}

beforeAll(() => {
  if (!FF) return;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const r = spawnSync("ffmpeg", ["-y", "-filter_complex", "color=c=red:s=160x240:r=30:d=3[a];color=c=blue:s=160x240:r=30:d=3[b];[a][b]hstack[v]", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "[v]", "-map", "0:a", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(UPLOAD_DIR, `${SPLIT}.mp4`)]);
  // ترتيب المدخلات: lavfi anullsrc يجب أن يسبق filter_complex؛ نعيد المحاولة بالترتيب الصحيح إن فشل.
  if (r.status !== 0) {
    const r2 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", "color=c=red:s=160x240:r=30:d=3[a];color=c=blue:s=160x240:r=30:d=3[b];[a][b]hstack[v]", "-map", "[v]", "-map", "0:a", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(UPLOAD_DIR, `${SPLIT}.mp4`)]);
    expect(r2.status).toBe(0);
  }
});
afterAll(() => {
  rmSync(path.join(UPLOAD_DIR, `${SPLIT}.mp4`), { force: true });
  for (const f of created) rmSync(f, { force: true });
});

async function exportWith(c: VideoClip) {
  const project: ProjectState = { ...defaultProject("t"), duration: 3, resolution: "720p", fps: 30, aspect: "16:9", clips: [c] };
  const res = await exportPost(new NextRequest("http://localhost/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceRef: `upload:${SPLIT}`, project }) }));
  const id = (await res.json()).job.id as string;
  for (let i = 0; i < 200; i++) {
    const st = await readJobStatus(id);
    if (st?.status === "completed") { const f = path.join(EXPORT_DIR, `${id}.mp4`); created.push(f, path.join(EXPORT_DIR, `${id}.json`)); return f; }
    if (st?.status === "failed") throw new Error(st.message);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timeout");
}

describe.runIf(FF)("T-15: real export applies smart framing", () => {
  it("zoom 2 + pan right shows only the blue half; pan left only red; no framing shows both", async () => {
    const right = colourAt(await exportWith(clip({ smartZoom: true, zoom: 2, panX: 0.25 })), 1.5);
    expect(right[2]).toBeGreaterThan(150); expect(right[0]).toBeLessThan(90);
    const left = colourAt(await exportWith(clip({ smartZoom: true, zoom: 2, panX: -0.25 })), 1.5);
    expect(left[0]).toBeGreaterThan(150); expect(left[2]).toBeLessThan(90);
    const both = colourAt(await exportWith(clip()), 1.5);
    expect(both[0]).toBeGreaterThan(60); expect(both[2]).toBeGreaterThan(60); // مزيج أحمر+أزرق
  }, 180_000);
});
