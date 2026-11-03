import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { bwrapAvailable, ffHiddenPaths, ffSandboxPolicy, ffWritableDirs, hardenedSpawn, sandboxCommand, unshareAvailable } from "@/lib/engine/hardening";
import { ffmpegPath, ffprobePath, runProcess } from "@/lib/engine/process";
import { hasFfmpeg } from "@/lib/server/ffmpeg-export";

// T-09: ffmpeg يعمل بلا شبكة وبلا وصول لملفات الأسرار. الاختبارات الفعلية تُتخطّى (skipped لا passed) إن لم تتوفر الآلية.
const LINUX = process.platform === "linux";
const HAS_BWRAP = LINUX && bwrapAvailable();
const HAS_UNSHARE = LINUX && unshareAvailable();
const NODE = process.execPath;
const envFor = (kind: string) => ({ ...process.env, MONTAGE_FFMPEG_SANDBOX: kind }) as NodeJS.ProcessEnv;

/** يشغّل أمراً داخل غلاف عزل ffmpeg المطلوب (tool=ffmpeg) لاختبار ما يستطيع ffmpeg فعله. */
async function inSandbox(kind: "bwrap" | "unshare", cmd: string, args: string[], cwd?: string) {
  const s = sandboxCommand(cmd, args, { tool: "ffmpeg", cwd, env: envFor(kind) });
  expect(s.sandbox).toBe(kind);
  return runProcess(s.cmd, s.args, { timeoutMs: 20_000, cwd });
}

describe("سياسة عزل ffmpeg", () => {
  it("off لا يلفّ، والأوامر غير ffmpeg لا تُلفّ، والقيم المجهولة ⇒ auto", () => {
    expect(sandboxCommand("ffmpeg", ["-version"], { env: envFor("off") }).sandbox).toBe("none");
    expect(sandboxCommand("python", ["x"]).sandbox).toBe("none");
    expect(ffSandboxPolicy({} as NodeJS.ProcessEnv)).toBe("auto");
    expect(ffSandboxPolicy(envFor("bwrap"))).toBe("bwrap");
    expect(ffSandboxPolicy(envFor("weird"))).toBe("auto");
  });

  it("الآلية المفروضة غير المتاحة ⇒ خطأ صريح لا تشغيل بلا عزل", () => {
    if (!HAS_BWRAP) expect(() => sandboxCommand("ffmpeg", [], { env: envFor("bwrap") })).toThrow(/bubblewrap/);
    if (!HAS_UNSHARE) expect(() => sandboxCommand("ffmpeg", [], { env: envFor("unshare") })).toThrow(/namespaces/);
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

  it("ffWritableDirs: مجلد المخرَج فقط — لا المدخلات ولا /dev ولا ما قبل اسم الأداة (prlimit)", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "montage-out-"));
    try {
      expect(ffWritableDirs(["--cpu=9", "--nofile=64", "--", "/usr/bin/ffmpeg", "-y", "-i", "/in/a.mp4", path.join(out, "o.mp4")])).toEqual([out]);
      expect(ffWritableDirs(["-i", "/usr/share/a.mp4", "-f", "null", "/dev/null"])).toEqual([]); // تحليل فقط
      expect(ffWritableDirs(["-y", "-i", "a.mp4", "-vf", "scale=640:-1", "relative.mp4"])).toEqual([]); // مسار نسبي لا يُفتح
      expect(ffWritableDirs([path.join(out, "x", "missing", "o.mp4")])).toEqual([]); // مجلد غير موجود
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

for (const kind of ["bwrap", "unshare"] as const) {
  describe.skipIf(!(kind === "bwrap" ? HAS_BWRAP : HAS_UNSHARE))(`عزل ffmpeg فعلياً (${kind})`, () => {
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
      const inside = await inSandbox(kind, NODE, ["-e", fetchScript(port)]);
      expect(inside.stdout).toBe("NO-NET");
      expect(inside.code).not.toBe(0);
    });

    it("ملفات الأسرار في cwd تُقرأ فارغة، وملف الوسائط يُقرأ عادياً", async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "montage-sec-"));
      try {
        writeFileSync(path.join(dir, ".env.local"), "OPENCODE_API_KEY=sk-very-secret");
        writeFileSync(path.join(dir, "media.txt"), "media-ok");
        const r = await inSandbox(kind, NODE, ["-e", `const fs=require("fs");process.stdout.write(JSON.stringify([fs.readFileSync(".env.local","utf8"),fs.readFileSync("media.txt","utf8")]))`], dir);
        expect(JSON.parse(r.stdout)).toEqual(["", "media-ok"]);
        expect(readFileSync(path.join(dir, ".env.local"), "utf8")).toContain("sk-very-secret"); // الإخفاء داخل العزل فقط
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it.skipIf(!hasFfmpeg())("ffprobe وffmpeg حقيقيان يعملان تحت العزل عبر hardenedSpawn", async () => {
      const saved = process.env.MONTAGE_FFMPEG_SANDBOX;
      process.env.MONTAGE_FFMPEG_SANDBOX = kind;
      const outDir = mkdtempSync(path.join(os.tmpdir(), "montage-ff-"));
      try {
        expect(hardenedSpawn(ffprobePath(), ["-v", "error"]).cmd).toBe(kind === "bwrap" ? "bwrap" : "unshare");
        const video = path.join(process.cwd(), "test_assets", "test_video.mp4");
        const probe = await runProcess(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { timeoutMs: 30_000 });
        expect(probe.code).toBe(0);
        expect(Number(probe.stdout.trim())).toBeGreaterThan(25);
        const out = path.join(outDir, "o.mp4");
        const enc = await runProcess(ffmpegPath(), ["-v", "error", "-y", "-i", video, "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-an", out], { timeoutMs: 60_000 });
        expect(enc.code).toBe(0);
        expect(existsSync(out)).toBe(true);
      } finally {
        if (saved === undefined) delete process.env.MONTAGE_FFMPEG_SANDBOX; else process.env.MONTAGE_FFMPEG_SANDBOX = saved;
        rmSync(outDir, { recursive: true, force: true });
      }
    });
  });
}

// ما يميّز bwrap عن unshare: جذر للقراءة فقط + كتابة حصراً في مجلد المخرَج + يموت مع الأب.
describe.skipIf(!HAS_BWRAP)("bwrap: نظام ملفات للقراءة فقط", () => {
  it("لا كتابة خارج مجلد المخرَج (حتى في /tmp وفي المنزل)، مع بقاء القراءة", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "montage-ro-"));
    try {
      const target = path.join(dir, "should-not-exist.txt");
      const script = `const fs=require("fs");let w="written";try{fs.writeFileSync(${JSON.stringify(target)},"x")}catch(e){w=e.code}process.stdout.write(JSON.stringify([w,fs.existsSync("/etc/hostname")||fs.existsSync("/etc/os-release")]))`;
      const r = await inSandbox("bwrap", NODE, ["-e", script], dir);
      const [w, canRead] = JSON.parse(r.stdout);
      expect(["EROFS", "EACCES", "EPERM"]).toContain(w);
      expect(canRead).toBe(true);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("الكتابة تنجح في مجلد المخرَج المُستنتج من الوسائط فقط", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "montage-w-"));
    const other = mkdtempSync(path.join(os.tmpdir(), "montage-nw-"));
    try {
      // نمثّل ffmpeg بـ node: الوسيط الأخير مسار مخرَج مطلق ⇒ مجلده قابل للكتابة؛ مجلد آخر لا.
      const outFile = path.join(out, "o.bin");
      const script = `const fs=require("fs");const r=[];for(const f of [${JSON.stringify(outFile)},${JSON.stringify(path.join(other, "x.bin"))}]){try{fs.writeFileSync(f,"x");r.push("ok")}catch(e){r.push(e.code)}}process.stdout.write(JSON.stringify(r))`;
      const s = sandboxCommand(NODE, ["-e", script, "ffmpeg", "-y", outFile], { tool: "ffmpeg", env: envFor("bwrap") });
      const r = await runProcess(s.cmd, s.args, { timeoutMs: 20_000 });
      const [a, b] = JSON.parse(r.stdout);
      expect(a).toBe("ok");
      expect(["EROFS", "EACCES", "EPERM"]).toContain(b);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("منزل المستخدم مخفي عن العملية المعزولة", async () => {
    const home = os.homedir();
    if (!existsSync(home) || home === "/") return;
    const marker = path.join(home, ".montage-bwrap-marker");
    writeFileSync(marker, "visible");
    const dir = mkdtempSync("/tmp/montage-nohome-"); // cwd خارج المنزل ⇒ يُخفى المنزل
    try {
      const r = await inSandbox("bwrap", NODE, ["-e", `process.stdout.write(require("fs").existsSync(${JSON.stringify(marker)})?"visible":"hidden")`], dir);
      expect(r.stdout).toBe("hidden");
    } finally {
      rmSync(marker, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

