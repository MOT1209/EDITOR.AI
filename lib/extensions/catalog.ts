// اكتشاف الإضافات (Discovery): فهرس **محلي** لحزم جاهزة تُثبَّت/تُحدَّث بنقرة.
// المصدر مجلد examples/extensions (أو MONTAGE_CATALOG_DIR) — لا متجر بعيد عمداً: لا تنزيل كود من الشبكة،
// وكل تثبيت يمرّ بنفس saveExtension (تحقق + تكامل + سياسة التوقيع MONTAGE_EXT_REQUIRE_SIGNED).
import { promises as fsp } from "fs";
import path from "path";
import { EngineError } from "@/lib/engine/errors";
import { readPackageDir } from "./package-dir";
import { isSemver } from "./semver";
import * as svc from "./service";
import { getState } from "./store";

type ExtensionKind = "skill" | "tool";

export interface CatalogEntry {
  /** مفتاح الإدخال = اسم الملف/المجلد داخل الفهرس. */
  key: string;
  kind: ExtensionKind;
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  permissions: string[];
  capabilities: string[];
  executionType: string;
  valid: boolean;
  issues: string[];
  installed: boolean;
  installedVersion?: string;
  /** إصدار الفهرس أعلى من المثبَّت. */
  updateAvailable: boolean;
}

export function catalogDir(): string {
  return path.resolve(process.env.MONTAGE_CATALOG_DIR || path.join(process.cwd(), "examples", "extensions"));
}

async function readEntryRaw(key: string): Promise<unknown> {
  const full = path.join(catalogDir(), key);
  const st = await fsp.lstat(full).catch(() => null);
  if (!st || st.isSymbolicLink()) throw new EngineError("NOT_FOUND", `إدخال غير موجود في الفهرس: ${key}`);
  if (st.isDirectory()) return readPackageDir(full);
  if (!key.endsWith(".json") || st.size > 600_000) throw new EngineError("INVALID_INPUT", "ملف فهرس غير صالح");
  return JSON.parse(await fsp.readFile(full, "utf-8"));
}

export async function listCatalog(): Promise<CatalogEntry[]> {
  const names = (await fsp.readdir(catalogDir()).catch(() => [] as string[])).filter((n) => !n.startsWith("."));
  const out: CatalogEntry[] = [];
  for (const key of names.sort()) {
    try {
      const raw = (await readEntryRaw(key)) as { manifest?: Record<string, unknown>; kind?: string };
      const v = await svc.validateRaw(raw);
      const m = (raw.manifest ?? {}) as Record<string, unknown> & { execution?: { type?: string } };
      const kind = (m.kind === "tool" ? "tool" : "skill") as ExtensionKind;
      const id = String(m.id ?? "");
      const st = id ? await getState(kind, id).catch(() => null) : null;
      const version = String(m.version ?? "0.0.0");
      out.push({
        key, kind, id, name: String(m.name ?? id), description: String(m.description ?? ""), category: String(m.category ?? "utility"),
        tags: Array.isArray(m.tags) ? m.tags.map(String) : [], version,
        permissions: Array.isArray(m.permissions) ? m.permissions.map(String) : [],
        capabilities: Array.isArray(m.capabilities) ? m.capabilities.map(String) : [],
        executionType: String(m.execution?.type ?? "?"),
        valid: v.ok, issues: v.issues.filter((i) => i.level === "error").map((i) => i.message).slice(0, 5),
        installed: !!st, installedVersion: st?.activeVersion,
        updateAvailable: !!st && isSemver(version) && isSemver(st.activeVersion) && cmp(version, st.activeVersion) > 0,
      });
    } catch {
      /* إدخال تالف: يُتخطى (لا يكسر الفهرس) */
    }
  }
  return out;
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** يثبّت إدخالاً من الفهرس أو يحدّثه (إصدار أعلى فقط). لا يفعّل ولا يمنح صلاحيات — ذلك قرار المالك. */
export async function installFromCatalog(key: string, mode: "install" | "update") {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new EngineError("INVALID_INPUT", "مفتاح فهرس غير صالح");
  const entries = await listCatalog();
  const entry = entries.find((e) => e.key === key);
  if (!entry) throw new EngineError("NOT_FOUND", `إدخال غير موجود في الفهرس: ${key}`);
  if (mode === "install" && entry.installed) throw new EngineError("CONFLICT", `«${entry.id}» مثبّتة بالفعل (الإصدار ${entry.installedVersion})`, entry.updateAvailable ? "استخدم التحديث." : undefined);
  if (mode === "update" && !entry.installed) throw new EngineError("NOT_FOUND", `«${entry.id}» غير مثبّتة`);
  if (mode === "update" && !entry.updateAvailable) throw new EngineError("CONFLICT", `لا إصدار أحدث في الفهرس (المثبّت ${entry.installedVersion})`);
  const raw = await readEntryRaw(key);
  return svc.saveExtension(raw, { kind: entry.kind, origin: "imported", update: mode === "update", note: mode === "update" ? `تحديث من الفهرس إلى ${entry.version}` : "تثبيت من الفهرس" });
}
