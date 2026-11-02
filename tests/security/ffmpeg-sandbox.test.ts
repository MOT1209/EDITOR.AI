import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { ffHiddenPaths, ffSandboxPolicy, hardenedSpawn, sandboxCommand, unshareAvailable } from "@/lib/engine/hardening";
import { ffmpegPath, ffprobePath, runProcess } from "@/lib/engine/process";
import { hasFfmpeg } from "@/lib/server/ffmpeg-export";

// T-09: ffmpeg يعمل بلا شبكة وبلا وصول لملفات الأسرار. تُتخطّى (skipped لا passed) إن كانت namespaces معطّلة.
const NS = process.platform === "linux" && unshareAvailable();
const NODE = process.execPath;

/** يشغّل أمراً داخل نفس غلاف عزل ffmpeg (sandboxCommand بـ tool=ffmpeg) لاختبار ما يستطيع ffmpeg فعله. */
async function inSandbox(cmd: string, args: string[], cwd?: string) {
  const s = sandboxCommand(cmd, args, { tool: "ffmpeg", cwd });
  expect(s.sandbox).toBe("unshare");
  return runProcess(s.cmd, s.args, { timeoutMs: 20_000, cwd });
}

describe("سياسة عزل ffmpeg", () => {
  it("off لا يلفّ، والأوامر غير ffmpeg لا تُلفّ", () => {
    expect(sandboxCommand("ffmpeg", ["-version"], { env: { MONTAGE_FFMPEG_SANDBOX: "off" } as unknown as NodeJS.ProcessEnv }).sandbox).toBe("none");
    expect(sandboxCommand("python", ["x"]).sandbox).toBe("none");
    expect(ffSandboxPolicy({} as NodeJS.ProcessEnv)).toBe("auto");
    expect(ffSandboxPolicy({ MONTAGE_FFMPEG_SANDBOX: "weird" } as unknown as NodeJS.ProcessEnv)).toBe("auto");
  });

  it("الأسرار تُدرج للإخفاء و.env.example لا", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "montage-hide-"));
    try {
      for (const f of [".env", ".env.local", ".env.production", ".env.example", "video.mp4"]) writeFileSync(path.join(dir, f), "x");
      const hidden = ffHiddenPaths("ffmpeg", ["-i", path.join(dir, "video.mp4")], { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, dir).map((p) => path.basename(p));
      expect(hidden).toEqual(expect.arrayContaining([".env", ".env.local", ".env.production"]));
      expect(hidden).not.toContain(".env.example");
      expect(hidden).not.toContain("video.mp4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!NS)("عزل ffmpeg فعلياً (unshare)", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((_q, r) => r.end("secret-from-network"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const fetchScript = (p: number) =>
    `require("http").get("http://127.0.0.1:${p}",(r)=>{r.on("data",(d)=>process.stdout.write(d));r.on("end",()=>process.exit(0))}).on("error",()=>{process.stdout.write("NO-NET");process.exit(3)})`;

  it("لا شبكة داخل العزل (والاختبار يكشف الفرق: خارجه يصل)", async () => {
    const outside = await runProcess(NODE, ["-e", fetchScript(port)], { timeoutMs: 20_000 });
    expect(outside.stdout).toBe("secret-from-network");
    const inside = await inSandbox(NODE, ["-e", fetchScript(port)]);
    expect(inside.stdout).toBe("NO-NET");
    expect(inside.code).not.toBe(0);
  });

  it("ملفات الأسرار في cwd تُقرأ فارغة، وملف الوسائط يُقرأ عادياً", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "montage-sec-"));
    try {
      writeFileSync(path.join(dir, ".env.local"), "OPENCODE_API_KEY=sk-very-secret");
      writeFileSync(path.join(dir, "media.txt"), "media-ok");
      const r = await inSandbox(NODE, ["-e", `const fs=require("fs");process.stdout.write(JSON.stringify([fs.readFileSync(".env.local","utf8"),fs.readFileSync("media.txt","utf8")]))`], dir);
      expect(JSON.parse(r.stdout)).toEqual(["", "media-ok"]);
      expect(existsSync(path.join(dir, ".env.local"))).toBe(true); // الإخفاء داخل namespace فقط
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasFfmpeg())("ffprobe وffmpeg حقيقيان يعملان تحت العزل عبر hardenedSpawn", async () => {
    const h = hardenedSpawn(ffprobePath(), ["-v", "error"]);
    expect(h.cmd).toBe("unshare");
    const probe = await runProcess(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(process.cwd(), "test_assets", "test_video.mp4")], { timeoutMs: 30_000 });
    expect(probe.code).toBe(0);
    expect(Number(probe.stdout.trim())).toBeGreaterThan(25);
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), "montage-ff-")), "o.mp4");
    const enc = await runProcess(ffmpegPath(), ["-v", "error", "-y", "-i", path.join(process.cwd(), "test_assets", "test_video.mp4"), "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-an", out], { timeoutMs: 60_000 });
    expect(enc.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    rmSync(path.dirname(out), { recursive: true, force: true });
  });
});
