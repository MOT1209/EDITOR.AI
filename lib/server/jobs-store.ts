// ====================================================================
// مخزن مهام الخادم الدائم (T-18) فوق SQLite (lib/server/db.ts).
//
// - مصدر واحد لـ /api/jobs وحالة التصدير (/api/export/status|download): لا تضيع المهام بإعادة التشغيل.
// - الاستعادة: عند أول فتح للقاعدة في العملية، كل مهمة «running» تملكها عملية إقلاع أخرى لم تعد حية
//   تُعلَّم «failed: انقطعت» (لا تبقى running للأبد).
// - الترحيل: حالة تصدير غير موجودة في القاعدة تُقرأ من ملف JSON القديم (قراءة فقط — التراجع آمن).
// - التدهور: بلا SQLite ⇒ خريطة في الذاكرة + ملفات JSON كما كان سابقاً.
// ملاحظة: aiJobs في lib/mockAi.ts يبقى للواجهة (متصفح) — هذا المخزن للخادم فقط.
// ====================================================================
import { readFileSync, rmSync } from "fs";
import type { AIJob } from "@/lib/types";
import { BOOT_ID, db, onDbOpen, type Database } from "@/lib/server/db";

export type JobStatus = "running" | "completed" | "failed" | "cancelled";

export interface StoredJob {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  progress: number;
  message?: string;
  result?: unknown;
  issues?: unknown[];
  startedAt: number;
  finishedAt?: number;
}

export const INTERRUPTED_MESSAGE = "انقطعت: توقفت عملية الخادم أثناء التنفيذ — أعد المحاولة";
const LIST_LIMIT = 200;

let counter = 0;
const memory = new Map<string, StoredJob>();

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * يقتل عامل ffmpeg يتيماً لمهمة منقطعة — فقط إن كان سطر أوامره (/proc) يتضمن مسار مخرَج المهمة
 * (فلا نقتل عملية أخرى أعادت استخدام الـ pid). على أنظمة بلا /proc لا نقتل شيئاً (آمن).
 */
function killOrphanWorker(pid: number, artifact: string | null): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || !artifact || pid === process.pid) return false;
  let cmdline = "";
  try {
    cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0").join(" ");
  } catch {
    return false;
  }
  if (!cmdline.includes(artifact)) return false;
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

/** يعلّم مهام عمليات سابقة لم تعد حية «failed: انقطعت»، يقتل عاملها اليتيم ويحذف المخرَج الجزئي. يعيد عددها. */
export function recoverInterruptedJobs(d: Database | null = db()): number {
  if (!d) return 0;
  const rows = d.prepare("SELECT id, owner_pid, owner_boot, worker_pid, artifact FROM jobs WHERE status = 'running'").all();
  let n = 0;
  const now = Date.now();
  for (const r of rows) {
    if (r.owner_boot === BOOT_ID) continue;
    // نفس pid بإقلاع مختلف = pid أُعيد استخدامه ⇒ العملية الأصلية ماتت.
    if (Number(r.owner_pid) !== process.pid && pidAlive(Number(r.owner_pid))) continue;
    const artifact = r.artifact == null ? null : String(r.artifact);
    killOrphanWorker(Number(r.worker_pid), artifact);
    if (artifact) {
      try {
        rmSync(artifact, { force: true }); // لا مخرَج جزئي يبقى ويُظن مكتملاً
      } catch {
        /* لا شيء */
      }
    }
    d.prepare("UPDATE jobs SET status = 'failed', message = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(INTERRUPTED_MESSAGE, now, r.id as string);
    n++;
  }
  return n;
}

onDbOpen((d) => {
  try {
    recoverInterruptedJobs(d);
  } catch {
    /* القاعدة تعمل لكن الاستعادة فشلت — مسار الحالة يبقى خط دفاع ثانٍ */
  }
});

function fromRow(r: Record<string, unknown>): StoredJob {
  const parse = (v: unknown) => {
    if (typeof v !== "string") return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  };
  return {
    id: String(r.id),
    kind: String(r.kind),
    label: String(r.label),
    status: String(r.status) as JobStatus,
    progress: Number(r.progress ?? 0),
    message: r.message == null ? undefined : String(r.message),
    result: parse(r.result_json),
    issues: parse(r.issues_json),
    startedAt: Number(r.started_at ?? 0),
    finishedAt: r.finished_at == null ? undefined : Number(r.finished_at),
  };
}

export const jobsStore = {
  create(kind: string, label: string): StoredJob {
    const job: StoredJob = { id: `job_${Date.now()}_${++counter}`, kind, label, status: "running", progress: 0, startedAt: Date.now() };
    const d = db();
    if (!d) {
      memory.set(job.id, job);
      return job;
    }
    d.prepare("INSERT INTO jobs(id, kind, label, status, progress, owner_pid, owner_boot, started_at) VALUES (?, ?, ?, 'running', 0, ?, ?, ?)").run(
      job.id, kind, label, process.pid, BOOT_ID, job.startedAt
    );
    return job;
  },

  get(id: string): StoredJob | undefined {
    const d = db();
    if (!d) return memory.get(id);
    const r = d.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return r ? fromRow(r) : undefined;
  },

  list(): StoredJob[] {
    const d = db();
    if (!d) return Array.from(memory.values()).sort((a, b) => b.startedAt - a.startedAt);
    return d.prepare(`SELECT * FROM jobs ORDER BY started_at DESC LIMIT ${LIST_LIMIT}`).all().map(fromRow);
  },

  /** تحديث جزئي (progress/status/message/result/issues). يُنشئ السجل إن لم يوجد (حالات تصدير قديمة). */
  update(id: string, patch: Partial<Omit<StoredJob, "id">>): void {
    const d = db();
    if (!d) {
      const j = memory.get(id);
      if (j) Object.assign(j, patch);
      return;
    }
    const cur = d.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    const base: StoredJob = cur ? fromRow(cur) : { id, kind: "export", label: "تصدير الفيديو", status: "running", progress: 0, startedAt: Date.now() };
    const next = { ...base, ...patch };
    d.prepare(
      `INSERT INTO jobs(id, kind, label, status, progress, message, result_json, issues_json, owner_pid, owner_boot, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, progress = excluded.progress, message = excluded.message,
         result_json = excluded.result_json, issues_json = excluded.issues_json, finished_at = excluded.finished_at`
    ).run(
      id, next.kind, next.label, next.status, Math.round(next.progress), next.message ?? null,
      next.result === undefined ? null : JSON.stringify(next.result),
      next.issues === undefined ? null : JSON.stringify(next.issues),
      process.pid, BOOT_ID, next.startedAt, next.finishedAt ?? null
    );
  },

  /** يربط المهمة بعملية العامل (ffmpeg) ومخرَجها — للاستعادة إن ماتت عملية الخادم. */
  attachWorker(id: string, workerPid: number, artifact: string): void {
    const d = db();
    if (!d) return;
    d.prepare("UPDATE jobs SET worker_pid = ?, artifact = ? WHERE id = ?").run(workerPid, artifact, id);
  },

  complete(id: string, result?: unknown): void {
    this.update(id, { status: "completed", progress: 100, result, finishedAt: Date.now() });
  },

  fail(id: string, message: string, status: "failed" | "cancelled" = "failed"): void {
    this.update(id, { status, message, finishedAt: Date.now() });
  },
};

/** شكل AIJob للواجهة (status «cancelled» يُعرض «failed» كما في نوع AIJob). */
export function toAIJob(j: StoredJob): AIJob {
  return {
    id: j.id,
    kind: j.kind,
    label: j.label,
    status: j.status === "cancelled" ? "failed" : j.status,
    progress: j.progress,
    message: j.message,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    result: j.result,
  };
}

/** للاختبارات فقط. */
export function _resetMemoryJobs(): void {
  memory.clear();
}
