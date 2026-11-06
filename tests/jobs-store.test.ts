import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { closeDbForTests, db } from "@/lib/server/db";
import { INTERRUPTED_MESSAGE, jobsStore, _resetMemoryJobs } from "@/lib/server/jobs-store";
import { EXPORT_DIR, readJobStatus, writeJobStatus } from "@/lib/server/ffmpeg-export";

let dir = "";
const saved = process.env.MONTAGE_DB_FILE;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "montage-jobs-"));
  process.env.MONTAGE_DB_FILE = path.join(dir, "montage.db");
  closeDbForTests();
});
afterEach(() => {
  closeDbForTests();
  if (saved === undefined) delete process.env.MONTAGE_DB_FILE; else process.env.MONTAGE_DB_FILE = saved;
  rmSync(dir, { recursive: true, force: true });
});

describe("مخزن المهام الدائم (T-18)", () => {
  it("المهام وحالة التصدير تبقى بعد إعادة فتح القاعدة (إعادة تشغيل)", async () => {
    expect(db()).not.toBeNull();
    const job = jobsStore.create("export", "تصدير");
    await writeJobStatus({ id: job.id, status: "running", progress: 30 });
    await writeJobStatus({ id: job.id, status: "completed", progress: 100, result: { path: "/x/out.mp4", size: 10, format: "mp4" } });
    closeDbForTests();
    const again = jobsStore.get(job.id);
    expect(again?.status).toBe("completed");
    expect(again?.finishedAt).toBeTruthy();
    expect(jobsStore.list().map((j) => j.id)).toContain(job.id);
    expect((await readJobStatus(job.id))?.result?.size).toBe(10);
  });

  it("قتل عملية أثناء مهمة جارية (SIGKILL) ⇒ تُعلَّم «انقطعت» عند الفتح التالي", async () => {
    // --import tsx في العملية نفسها (لا غلاف cli يولّد عملية ثانية) ⇒ SIGKILL يصيب مالك المهمة فعلاً.
    const artifact = path.join(dir, "job_out.mp4");
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/job-worker.ts", artifact], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const line = await new Promise<string>((resolve, reject) => {
      let out = "";
      child.stdout!.on("data", (b) => {
        out += String(b);
        if (out.includes("\n")) resolve(out.trim());
      });
      child.on("exit", () => reject(new Error("العامل خرج مبكراً")));
    });
    const [id, workerPidRaw] = line.split(" ");
    const workerPid = Number(workerPidRaw);
    // حيّة = موجودة وليست zombie (عملية مقتولة تنتظر من يحصدها تبقى ظاهرة لـ kill(pid, 0)).
    const alive = (pid: number) => {
      try {
        return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf-8"));
      } catch {
        return false;
      }
    };
    expect(jobsStore.get(id)?.status).toBe("running"); // المالك حي ⇒ لا يُعلَّم
    expect(alive(workerPid)).toBe(true);
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));
    closeDbForTests(); // «إعادة تشغيل» العملية الأم
    const j = jobsStore.get(id);
    expect(j?.status).toBe("failed");
    expect(j?.message).toBe(INTERRUPTED_MESSAGE);
    expect(j?.progress).toBe(42);
    // العامل اليتيم (يحاكي ffmpeg) قُتل والمخرَج الجزئي حُذف
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(workerPid)).toBe(false);
    expect(existsSync(artifact)).toBe(false);
  }, 60_000);

  it("ترحيل: حالة تصدير قديمة في ملف JSON تُقرأ بلا فقد", async () => {
    mkdirSync(EXPORT_DIR, { recursive: true });
    const id = `job_1_${Date.now() % 100000}`;
    const file = path.join(EXPORT_DIR, `${id}.json`);
    writeFileSync(file, JSON.stringify({ id, status: "completed", progress: 100, result: { path: "/old.mp4", size: 5, format: "mp4" } }));
    try {
      expect(await readJobStatus(id)).toMatchObject({ status: "completed", result: { size: 5 } });
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("تدهور أنيق: مسار قاعدة غير قابل للفتح ⇒ المهام في الذاكرة وتعمل", async () => {
    writeFileSync(path.join(dir, "blocker"), "x");
    process.env.MONTAGE_DB_FILE = path.join(dir, "blocker", "sub", "montage.db"); // أب ملف لا مجلد
    closeDbForTests();
    _resetMemoryJobs();
    expect(db()).toBeNull();
    const job = jobsStore.create("export", "تصدير");
    await writeJobStatus({ id: job.id, status: "completed", progress: 100 });
    expect(jobsStore.get(job.id)?.status).toBe("completed");
    expect((await readJobStatus(job.id))?.status).toBe("completed");
    rmSync(path.join(EXPORT_DIR, `${job.id}.json`), { force: true });
  });
});
