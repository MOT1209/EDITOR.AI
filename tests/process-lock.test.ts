import { describe, expect, it } from "vitest";
import { spawn } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";

// عمليتان منفصلتان (مثل Next وخادم MCP) تعدّلان المشروع نفسه بالتزامن.
// بلا قفل بين العمليات تضيع تحديثات (lost update) ويتضارب سجل التراجع.
function runWorker(env: NodeJS.ProcessEnv, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tsconfig.json", "tests/fixtures/mutate-worker.ts", ...args], { env, stdio: ["ignore", "ignore", "inherit"] });
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

describe("قفل بين العمليات لتعديل المشاريع", () => {
  // 4 عمليات تفتح قاعدة جديدة بالتزامن: يغطي أيضاً سباق الفتح الأول (WAL/الترحيل) الذي كان يُسقط
  // إحداها صامتةً إلى «بلا قفل».
  it("أربع عمليات متزامنة على قاعدة جديدة لا تفقد أي تعديل", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "montage-lock-"));
    const env = { ...process.env, MONTAGE_WORKSPACE: path.join(dir, "ws"), MONTAGE_DB_FILE: path.join(dir, "montage.db") };
    const saved = { ws: process.env.MONTAGE_WORKSPACE, db: process.env.MONTAGE_DB_FILE };
    process.env.MONTAGE_WORKSPACE = env.MONTAGE_WORKSPACE;
    process.env.MONTAGE_DB_FILE = env.MONTAGE_DB_FILE;
    try {
      const store = await import("@/lib/engine/store");
      const p = await store.createProject({ name: "base" });
      // القاعدة يجب ألا توجد قبل العمّال كي يتسابقوا على الفتح الأول فعلاً.
      (await import("@/lib/server/db")).closeDbForTests();
      for (const f of ["", "-wal", "-shm"]) rmSync(env.MONTAGE_DB_FILE + f, { force: true });
      const N = 10;
      const W = ["A", "B", "C", "D"];
      const codes = await Promise.all(W.map((t) => runWorker(env, [p.id, String(N), t])));
      expect(codes).toEqual(W.map(() => 0));
      const final = await store.getProject(p.id);
      const parts = final.name.split("|").slice(1); // حرف واحد لكل تعديل (حد الاسم 120)
      expect(parts.length).toBe(W.length * N);
      const h = await store.listHistory(p.id);
      expect(h.undo.length).toBe(Math.min(W.length * N, store.HISTORY_LIMIT));
    } finally {
      process.env.MONTAGE_WORKSPACE = saved.ws;
      if (saved.db === undefined) delete process.env.MONTAGE_DB_FILE; else process.env.MONTAGE_DB_FILE = saved.db;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
