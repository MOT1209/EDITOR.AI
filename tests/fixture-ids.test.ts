import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// ملفات الاختبار تعمل بالتوازي وتتشارك .montage_ai/uploads: معرّف رفع ثابت مكرر بين ملفين يجعل أحدهما يستبدل/يحذف مصدر الآخر
// (تسبّب فعلاً في فشل متقطع لـ export-framing). كل معرّف uuid حرفي يجب أن يخصّ ملف اختبار واحداً.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const ALLOWED_SHARED = new Set(["00000000-0000-4000-8000-000000000000"]); // قيمة «لا شيء» تُستعمل في اختبارات رفض فقط

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? testFiles(p) : /\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe("معرّفات الاختبار الثابتة", () => {
  it("لا يتكرر معرّف uuid حرفي بين ملفي اختبار", () => {
    const owners = new Map<string, Set<string>>();
    for (const root of ["tests", "lib", "mcp"]) {
      for (const f of testFiles(root)) {
        if (f.endsWith("fixture-ids.test.ts")) continue;
        for (const id of new Set(readFileSync(f, "utf-8").match(UUID) ?? [])) {
          if (!owners.has(id)) owners.set(id, new Set());
          owners.get(id)!.add(f);
        }
      }
    }
    const dup = [...owners].filter(([id, fs]) => fs.size > 1 && !ALLOWED_SHARED.has(id)).map(([id, fs]) => `${id}: ${[...fs].join(", ")}`);
    expect(dup).toEqual([]);
  });
});
