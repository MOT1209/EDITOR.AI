import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { childEnv, findPrlimit, hardenFfmpegArgs, hardenedSpawn, limitCommand, isFfTool } from "@/lib/engine/hardening";
import { runProcess, ffprobePath, ffmpegPath } from "@/lib/engine/process";
import { hasFfmpeg } from "@/lib/server/ffmpeg-export";

describe("pure hardening helpers", () => {
  it("childEnv drops provider keys and secrets, keeps PATH", () => {
    const e = childEnv({ PATH: "/bin", OPENCODE_API_KEY: "sk-secret", HF_TOKEN: "hf_x", MONTAGE_API_TOKEN: "t", HOME: "/h" } as unknown as NodeJS.ProcessEnv);
    expect(e.PATH).toBe("/bin");
    expect(e.OPENCODE_API_KEY).toBeUndefined();
    expect(e.HF_TOKEN).toBeUndefined();
    expect(e.MONTAGE_API_TOKEN).toBeUndefined();
  });
  it("inserts -protocol_whitelist before every -i exactly once", () => {
    const a = hardenFfmpegArgs(["-y", "-i", "a.mp4", "-loop", "1", "-i", "b.png", "out.mp4"]);
    expect(a).toEqual(["-y", "-protocol_whitelist", "file,pipe", "-i", "a.mp4", "-loop", "1", "-protocol_whitelist", "file,pipe", "-i", "b.png", "out.mp4"]);
    expect(hardenFfmpegArgs(a)).toEqual(a);
  });
  it("only ffmpeg/ffprobe are treated as ff tools; others are not argument-rewritten", () => {
    expect(isFfTool("/usr/bin/ffmpeg")).toBe(true);
    expect(isFfTool("C:\\x\\ffprobe.exe")).toBe(true);
    expect(isFfTool("python")).toBe(false);
    expect(hardenedSpawn("python", ["-i", "x"]).args.includes("-protocol_whitelist")).toBe(false);
  });
  it("limitCommand wraps with prlimit (no shell) and can be disabled", () => {
    const pl = findPrlimit();
    if (!pl) return; // غير Linux: مسموح بالتخطي الصريح (لا حدود)
    const l = limitCommand("ffmpeg", ["-version"], { cpuSeconds: 10, fileBytes: 1000, openFiles: 64 }, {} as NodeJS.ProcessEnv);
    expect(l.limited).toBe(true);
    expect(l.cmd).toBe(pl);
    expect(l.args).toEqual(["--cpu=10", "--fsize=1000", "--nofile=64", "--", "ffmpeg", "-version"]);
    expect(limitCommand("ffmpeg", [], undefined, { MONTAGE_PROC_LIMITS: "off" } as unknown as NodeJS.ProcessEnv).limited).toBe(false);
  });
});

const ff = hasFfmpeg();
describe.runIf(ff)("FFmpeg network/protocol restriction + env isolation (real ffmpeg)", () => {
  let dir = "";
  let server: http.Server;
  const hits: string[] = [];
  let port = 0;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "montage-hls-"));
    server = http.createServer((req, res) => { hits.push(req.url || ""); res.statusCode = 404; res.end(); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  // ملاحظة موثّقة: في FFmpeg 6.1 قائمة تشغيل HLS محلية لا تفتح http افتراضياً (whitelist الافتراضي file,crypto,data)،
  // فالتصليب هنا دفاع إضافي لا إصلاح لثغرة قابلة للاستغلال على هذا الإصدار — لذا نختبر السلوك الوظيفي لا الاستغلال.
  it("hardened runProcess still analyses real media correctly (no functional regression)", async () => {
    const r = await runProcess(ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-i", path.join(process.cwd(), "test_assets", "test_video.mp4")], { timeoutMs: 20000 });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).format.duration).toBeDefined();
  });
  it("an http:// input is refused by the explicit whitelist (no connection made)", async () => {
    hits.length = 0;
    const r = await runProcess(ffprobePath(), ["-v", "error", "-i", `http://127.0.0.1:${port}/direct-marker.mp4`], { timeoutMs: 20000 });
    expect(r.code).not.toBe(0);
    expect(hits).toEqual([]);
  });
  it("child processes do not inherit provider secrets", async () => {
    process.env.OPENCODE_API_KEY = "sk-should-not-leak-0000";
    try {
      const r = await runProcess(process.execPath, ["-e", "process.stdout.write(String(process.env.OPENCODE_API_KEY))"], { timeoutMs: 10000 });
      expect(r.stdout).toBe("undefined");
    } finally { delete process.env.OPENCODE_API_KEY; }
  });
  it.runIf(!!findPrlimit())("output file size limit is enforced by the kernel (prlimit --fsize)", () => {
    const out = path.join(dir, "capped.mp4");
    const h = limitCommand(ffmpegPath(), ["-y", "-f", "lavfi", "-i", "testsrc=s=640x360:d=5", "-c:v", "libx264", out], { cpuSeconds: 600, fileBytes: 20_000, openFiles: 1024 });
    return import("child_process").then(({ spawnSync }) => {
      const r = spawnSync(h.cmd, h.args, { timeout: 60000 });
      expect(r.status).not.toBe(0);
      expect(!existsSync(out) || statSync(out).size <= 20_000 + 65536).toBe(true);
    });
  });
});
