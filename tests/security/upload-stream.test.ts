import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { POST as probePost } from "@/app/api/ffmpeg/probe/route";
import { POST as uploadPost } from "@/app/api/assets/upload/route";
import { POST as transcribePost } from "@/app/api/ai/transcribe/route";
import { hasFfmpeg, UPLOAD_DIR } from "@/lib/server/ffmpeg-export";

const VIDEO = readFileSync(path.join(process.cwd(), "test_assets", "test_video.mp4"));

/** جسم متدفق بلا Content-Length (كما يصل طلب Transfer-Encoding: chunked). */
function chunked(total: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n));
    },
  });
}

const req = (url: string, body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string>) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { host: "localhost", ...headers }, body, duplex: "half" } as RequestInit & { duplex: "half" });

const uploadsNow = () => new Set((() => { try { return readdirSync(UPLOAD_DIR); } catch { return []; } })());

describe("رفع متدفق بسقف حقيقي (T-26)", () => {
  const saved = process.env.MAX_UPLOAD_BYTES;
  const created: string[] = [];
  afterEach(async () => {
    if (saved === undefined) delete process.env.MAX_UPLOAD_BYTES; else process.env.MAX_UPLOAD_BYTES = saved;
    for (const id of created.splice(0)) for (const f of readdirSync(UPLOAD_DIR).filter((x) => x.startsWith(id))) await fsp.rm(path.join(UPLOAD_DIR, f), { force: true });
  });

  it("multipart chunked بلا Content-Length أكبر من السقف ⇒ 413 (كان يُقرأ كاملاً في الذاكرة)", async () => {
    process.env.MAX_UPLOAD_BYTES = String(256 * 1024);
    const boundary = "----x";
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`);
    const filler = chunked(4 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(head);
        const r = filler.getReader();
        for (;;) { const { done, value } = await r.read(); if (done) break; c.enqueue(value); }
        c.close();
      },
    });
    const res = await transcribePost(req("/api/ai/transcribe", body, { "content-type": `multipart/form-data; boundary=${boundary}` }));
    expect(res.status).toBe(413);
  });

  it.skipIf(!hasFfmpeg())("رفع خام لفيديو حقيقي ⇒ مرجع upload: ومعلومات ffprobe", async () => {
    const res = await probePost(req("/api/ffmpeg/probe", VIDEO, { "content-type": "application/octet-stream", "x-upload-name": encodeURIComponent("عيّنة.mp4") }));
    expect(res.status).toBe(200);
    const d = await res.json();
    created.push(d.id);
    expect(d.ref).toMatch(/^upload:/);
    expect(d.size).toBe(VIDEO.length);
    expect(d.name).toBe("عيّنة.mp4");
    expect(d.info.video).toBeTruthy();
    expect(JSON.stringify(d)).not.toContain(UPLOAD_DIR);
  });

  it("رفع خام chunked يتجاوز السقف ⇒ 413 ولا ملف جزئي يبقى", async () => {
    process.env.MAX_UPLOAD_BYTES = String(256 * 1024);
    const before = uploadsNow();
    const res = await uploadPost(req("/api/assets/upload", chunked(2 * 1024 * 1024), { "content-type": "application/octet-stream", "x-upload-name": "big.mp4" }));
    expect(res.status).toBe(413);
    const leftover = [...uploadsNow()].filter((f) => !before.has(f));
    expect(leftover).toEqual([]);
  });

  it("امتداد غير مسموح ⇒ 400، وملف ليس وسيطاً ⇒ رفض وحذف", async () => {
    const bad = await uploadPost(req("/api/assets/upload", "x", { "content-type": "application/octet-stream", "x-upload-name": "evil.sh" }));
    expect(bad.status).toBe(400);
    const before = uploadsNow();
    const notVideo = await probePost(req("/api/ffmpeg/probe", "not a video at all", { "content-type": "application/octet-stream", "x-upload-name": "fake.mp4" }));
    expect([400, 503]).toContain(notVideo.status);
    expect([...uploadsNow()].filter((f) => !before.has(f))).toEqual([]);
  });

  it("اسم بمسار (../) لا يؤثر: الملف يُحفظ باسم عشوائي داخل مجلد الرفع", async () => {
    if (!hasFfmpeg()) return;
    const res = await uploadPost(req("/api/assets/upload", VIDEO, { "content-type": "application/octet-stream", "x-upload-name": encodeURIComponent("../../etc/x.mp4") }));
    expect(res.status).toBe(200);
    const d = await res.json();
    created.push(d.id);
    expect(d.name).toBe("x.mp4");
    expect(readdirSync(UPLOAD_DIR).some((f) => f.startsWith(d.id))).toBe(true);
  });
});
