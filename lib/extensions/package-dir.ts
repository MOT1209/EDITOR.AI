// قراءة حزمة بصيغة المجلد: manifest.json + ملفات نصية مسطحة (instructions.md ...).
// لا مجلدات فرعية ولا روابط رمزية ولا ملفات كبيرة — كل ما يُقرأ يمرّ بنفس تحقق parsePackage.
import { promises as fsp } from "fs";
import path from "path";
import { EngineError } from "@/lib/engine/errors";
import { FILE_LIMITS, FORMAT_VERSION, PACKAGE_FORMAT } from "./manifest";

export async function readPackageDir(dir: string): Promise<{ format: string; formatVersion: number; kind: unknown; manifest: unknown; files: Record<string, string> }> {
  const abs = path.resolve(dir);
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => {
    throw new EngineError("NOT_FOUND", `مجلد الحزمة غير موجود: ${dir}`);
  });
  let manifest: unknown;
  const files: Record<string, string> = {};
  for (const e of entries) {
    if (e.isSymbolicLink() || e.isDirectory()) throw new EngineError("INVALID_INPUT", `غير مسموح داخل الحزمة: ${e.name} (مجلدات/روابط رمزية)`);
    if (!e.isFile()) continue;
    const full = path.join(abs, e.name);
    const st = await fsp.stat(full);
    if (st.size > FILE_LIMITS.maxFileBytes) throw new EngineError("LIMIT_EXCEEDED", `الملف ${e.name} أكبر من الحد`);
    const text = await fsp.readFile(full, "utf-8");
    if (e.name === "manifest.json") {
      try {
        manifest = JSON.parse(text);
      } catch {
        throw new EngineError("INVALID_INPUT", "manifest.json ليس JSON صالحاً");
      }
    } else files[e.name] = text;
  }
  if (!manifest) throw new EngineError("INVALID_INPUT", "manifest.json مفقود");
  return { format: PACKAGE_FORMAT, formatVersion: FORMAT_VERSION, kind: (manifest as { kind?: unknown }).kind, manifest, files };
}
