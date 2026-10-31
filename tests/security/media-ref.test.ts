import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { assetRef, resolveImageRef, resolveVideoRef, uploadRef } from "@/lib/server/media-ref";
import { UPLOAD_DIR } from "@/lib/server/ffmpeg-export";
import { ASSETS_DIR } from "@/lib/server/assets";
import { POST as probe } from "@/app/api/ffmpeg/probe/route";
import { POST as exportPost } from "@/app/api/export/route";
import { POST as silence } from "@/app/api/ai/silence/route";
import { defaultProject } from "@/lib/project";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const IMG = "99999999-8888-4777-8666-555555555555.jpg";

beforeAll(() => {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(path.join(UPLOAD_DIR, `${ID}.mp4`), "x");
});
afterAll(() => rmSync(path.join(UPLOAD_DIR, `${ID}.mp4`), { force: true }));

describe("T-03: opaque media references", () => {
  it("resolves a valid upload ref to a file inside UPLOAD_DIR only", async () => {
    const p = await resolveVideoRef(uploadRef(ID));
    expect(p).toBe(path.join(UPLOAD_DIR, `${ID}.mp4`));
  });
  it("rejects raw paths, traversal, wrong shapes and unknown ids", async () => {
    for (const bad of [
      "/etc/passwd", path.join(UPLOAD_DIR, `${ID}.mp4`), `upload:../../etc/passwd`, `upload:${ID}/../x`, "upload:not-a-uuid",
      "project:../x:y", "project:p1:../../etc", "asset:x", "", null, undefined, 42, {}, `upload:${ID.replace("a", "b")}`,
    ]) {
      expect(await resolveVideoRef(bad)).toBeNull();
    }
  });
  it("image refs: asset:<uuid>.<ext> accepted; legacy absolute path only inside ASSETS_DIR", () => {
    expect(resolveImageRef(assetRef(IMG))).toBe(path.join(ASSETS_DIR, IMG));
    expect(resolveImageRef(path.join(ASSETS_DIR, IMG))).toBe(path.join(ASSETS_DIR, IMG));
    expect(resolveImageRef("/etc/passwd")).toBeNull();
    expect(resolveImageRef("asset:../../etc/passwd")).toBeNull();
    expect(resolveImageRef("asset:x.sh")).toBeNull();
  });
});

describe("T-03: no server path is exposed or accepted", () => {
  it("upload response has ref/id but no absolute path", async () => {
    const form = new FormData();
    const src = path.join(process.cwd(), "test_assets", "test_video.mp4");
    const tmp = path.join(UPLOAD_DIR, "_src_copy.mp4");
    copyFileSync(src, tmp);
    const { readFileSync } = await import("fs");
    form.append("file", new File([readFileSync(tmp)], "clip.mp4", { type: "video/mp4" }));
    rmSync(tmp, { force: true });
    const res = await probe(new NextRequest("http://localhost/api/ffmpeg/probe", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ref).toBe(`upload:${body.id}`);
    expect(JSON.stringify(body)).not.toContain(process.cwd());
    expect(body.path).toBeUndefined();
    expect(existsSync(path.join(UPLOAD_DIR, body.filename))).toBe(true);
    rmSync(path.join(UPLOAD_DIR, body.filename), { force: true });
  });
  it("/api/export refuses legacy sourcePath and absolute sourceRef (400)", async () => {
    const mk = (extra: Record<string, unknown>) =>
      exportPost(new NextRequest("http://localhost/api/export", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: defaultProject("t"), ...extra }),
      }));
    expect((await mk({ sourcePath: path.join(UPLOAD_DIR, `${ID}.mp4`) })).status).toBe(400);
    expect((await mk({ sourceRef: path.join(UPLOAD_DIR, `${ID}.mp4`) })).status).toBe(400);
    expect((await mk({ sourceRef: "/etc/passwd" })).status).toBe(400);
  });
  it("/api/ai/silence refuses legacy filePath and raw paths (400)", async () => {
    const mk = (body: unknown) =>
      silence(new NextRequest("http://localhost/api/ai/silence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await mk({ filePath: path.join(UPLOAD_DIR, `${ID}.mp4`) })).status).toBe(400);
    expect((await mk({ sourceRef: "/etc/passwd" })).status).toBe(400);
  });
});

describe("T-03: job status responses carry no disk paths", () => {
  it("/api/export/status strips result.path but keeps size/format", async () => {
    const { writeJobStatus } = await import("@/lib/server/ffmpeg-export");
    const { GET } = await import("@/app/api/export/status/[id]/route");
    const id = "job_1700000000000_9";
    await writeJobStatus({ id, status: "completed", progress: 100, result: { path: "/home/secret/exports/x.mp4", size: 123, format: "mp4" } });
    const res = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id }) });
    const body = await res.json();
    expect(body.result).toEqual({ size: 123, format: "mp4" });
    expect(JSON.stringify(body)).not.toContain("/home/secret");
    const { EXPORT_DIR } = await import("@/lib/server/ffmpeg-export");
    rmSync(path.join(EXPORT_DIR, `${id}.json`), { force: true });
  });
});
