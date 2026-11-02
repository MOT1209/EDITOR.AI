// ====================================================================
// تخزين دائم بـ SQLite (T-18): مهام + أقفال بين العمليات.
//
// - قاعدة واحدة: .montage_ai/montage.db (أو MONTAGE_DB_FILE). WAL + busy_timeout ⇒ تشاركها عمليات
//   Next وخادم MCP بأمان.
// - node:sqlite مدمج في Node 22 (بلا تبعية). يُحمَّل عبر process.getBuiltinModule كي لا يحاول
//   المجمّع (webpack) حلّه.
// - التدهور الأنيق: إن تعذّر التحميل أو الفتح ⇒ db() تعيد null ويعود كل مستدعٍ لسلوكه السابق
//   (ذاكرة/JSON، قفل داخل العملية) مع تحذير واحد.
// ====================================================================
import { mkdirSync } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { EngineError } from "@/lib/engine/errors";
import { logger } from "@/lib/server/logger";

/** الحد الأدنى من واجهة node:sqlite الذي نستعمله (أنواع @types/node 20 لا تتضمنه). */
export interface Statement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

/** معرّف إقلاع هذه العملية — يميّز مهام عملية سابقة عن الحالية حتى لو تكرر pid. */
export const BOOT_ID = randomUUID();

const SCHEMA_VERSION = 2;
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     status TEXT NOT NULL,
     progress INTEGER NOT NULL DEFAULT 0,
     message TEXT,
     result_json TEXT,
     issues_json TEXT,
     owner_pid INTEGER,
     owner_boot TEXT,
     started_at INTEGER,
     finished_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS jobs_started ON jobs(started_at);
   CREATE TABLE IF NOT EXISTS locks (
     key TEXT PRIMARY KEY,
     owner TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   );`,
  // v2: عملية العامل (ffmpeg) ومخرَجها — تُقتل ويُحذف المخرَج الجزئي إن ماتت عملية الخادم المالكة.
  `ALTER TABLE jobs ADD COLUMN worker_pid INTEGER;
   ALTER TABLE jobs ADD COLUMN artifact TEXT;`,
];

type G = { __montageDb?: { file: string; db: Database | null } };
const g = globalThis as unknown as G;
let warned = false;

export function dbFile(): string {
  if (process.env.MONTAGE_DB_FILE) return path.resolve(process.env.MONTAGE_DB_FILE);
  // داخل Vitest: ملف مؤقت لكل عملية اختبار — لا تلويث لمساحة العمل الحقيقية.
  if (process.env.VITEST) return path.join(os.tmpdir(), `montage-test-${process.pid}.db`);
  return path.join(process.cwd(), ".montage_ai", "montage.db");
}

function loadSqlite(): { DatabaseSync: new (file: string) => Database } | null {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltin !== "function") return null;
  try {
    return (getBuiltin("node:sqlite") as { DatabaseSync: new (file: string) => Database }) ?? null;
  } catch {
    return null;
  }
}

function open(file: string): Database | null {
  const mod = loadSqlite();
  if (!mod) {
    warnOnce("node:sqlite غير متاح (يتطلب Node 22.5+) — المهام في الذاكرة والقفل داخل العملية فقط");
    return null;
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const db = new mod.DatabaseSync(file);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
    const v = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    for (let i = v; i < Math.min(SCHEMA_VERSION, MIGRATIONS.length); i++) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(MIGRATIONS[i]);
        db.exec(`PRAGMA user_version=${i + 1}`);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    return db;
  } catch (e) {
    warnOnce(`تعذّر فتح قاعدة SQLite (${(e as Error).message}) — العودة للسلوك السابق`);
    return null;
  }
}

function warnOnce(msg: string) {
  if (warned) return;
  warned = true;
  logger.warn("db.unavailable", { reason: msg });
}

/** القاعدة المشتركة لهذه العملية، أو null عند التدهور. تُعاد فتحها إن تغيّر MONTAGE_DB_FILE (اختبارات). */
export function db(): Database | null {
  const file = dbFile();
  if (!g.__montageDb || g.__montageDb.file !== file) {
    try {
      g.__montageDb?.db?.close();
    } catch {
      /* لا شيء */
    }
    g.__montageDb = { file, db: open(file) };
    if (g.__montageDb.db) onOpen.forEach((fn) => fn(g.__montageDb!.db!));
  }
  return g.__montageDb.db;
}

/** يغلق القاعدة (لمحاكاة إعادة تشغيل العملية في الاختبارات). */
export function closeDbForTests(): void {
  try {
    g.__montageDb?.db?.close();
  } catch {
    /* لا شيء */
  }
  g.__montageDb = undefined;
}

const onOpen: ((d: Database) => void)[] = [];
/** خطاف يُنفَّذ عند أول فتح للقاعدة في العملية (مثل استعادة المهام المنقطعة). */
export function onDbOpen(fn: (d: Database) => void): void {
  onOpen.push(fn);
  const cur = g.__montageDb?.db;
  if (cur) fn(cur);
}

// ---------------------------------------------------------------- القفل بين العمليات

const LOCK_TTL_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tryAcquire(d: Database, key: string, owner: string, now: number): boolean {
  d.exec("BEGIN IMMEDIATE");
  try {
    d.prepare("DELETE FROM locks WHERE key = ? AND expires_at < ?").run(key, now); // سرقة قفل منتهٍ (عملية ماتت)
    const r = d.prepare("INSERT INTO locks(key, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").run(key, owner, now + LOCK_TTL_MS);
    d.exec("COMMIT");
    return Number(r.changes) === 1;
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch { /* لا شيء */ }
    if (/busy|locked/i.test((e as Error).message)) return false;
    throw e;
  }
}

/**
 * يسلسل fn عبر كل العمليات التي تشارك القاعدة (Next + خادم MCP). بلا قاعدة ⇒ ينفّذ fn مباشرة
 * (يبقى القفل داخل العملية عند المستدعي). مهلة الانتظار ⇒ EngineError("CONFLICT").
 */
export async function withProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const d = db();
  if (!d) return fn();
  const owner = `${process.pid}:${BOOT_ID}:${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let delay = 5;
  while (!tryAcquire(d, key, owner, Date.now())) {
    if (Date.now() > deadline) {
      throw new EngineError("CONFLICT", "المشروع مشغول بعملية أخرى", "أعد المحاولة بعد لحظات.");
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 100);
  }
  try {
    return await fn();
  } finally {
    try {
      d.prepare("DELETE FROM locks WHERE key = ? AND owner = ?").run(key, owner);
    } catch {
      /* ينتهي القفل تلقائياً بعد LOCK_TTL_MS */
    }
  }
}
