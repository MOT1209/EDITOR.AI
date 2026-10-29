// أداة سطر أوامر لإدارة حزم الإضافات (بنفس منطق الواجهة وMCP):
//   pnpm ext validate <مجلد|ملف.json>
//   pnpm ext install  <مجلد|ملف.json> [--update]     ← يثبّت معطّلاً (التفعيل من الواجهة بعد الاختبار والمنح)
//   pnpm ext list [skills|tools]
//   pnpm ext export <skills|tools> <id> [out.json]
import { promises as fsp } from "fs";
import path from "path";
import { readPackageDir } from "@/lib/extensions/package-dir";
import * as svc from "@/lib/extensions/service";
import type { ExtensionKind } from "@/lib/extensions/manifest";

async function load(target: string) {
  const st = await fsp.stat(target);
  return st.isDirectory() ? readPackageDir(target) : JSON.parse(await fsp.readFile(target, "utf-8"));
}
const kindOf = (s: string | undefined): ExtensionKind => (s === "tools" || s === "tool" ? "tool" : "skill");

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case "validate": {
      const r = await svc.validateRaw(await load(a));
      for (const i of r.issues) console.log(`${i.level === "error" ? "✗" : "⚠"} [${i.code}] ${i.message}`);
      console.log(r.ok ? "✓ الحزمة صالحة" : "✗ الحزمة غير صالحة");
      process.exit(r.ok ? 0 : 1);
    }
    case "install": {
      const r = await svc.saveExtension(await load(a), { origin: "imported", update: process.argv.includes("--update"), note: "تثبيت من CLI" });
      console.log(`✓ ثُبّتت ${r.summary.kind}:${r.summary.id}@${r.summary.version} (معطّلة — فعّلها من /extensions بعد الاختبار ومنح الصلاحيات)`);
      return;
    }
    case "list": {
      for (const e of await svc.listExtensions(kindOf(a))) console.log(`${e.status.padEnd(12)} ${e.label.padEnd(12)} ${e.id}@${e.version}  ${e.name}`);
      return;
    }
    case "export": {
      const pkg = await svc.exportExtension(kindOf(a), b);
      const out = process.argv[5] ?? `${pkg.manifest.id}-${pkg.manifest.version}.montage-${pkg.kind}.json`;
      await fsp.writeFile(path.resolve(out), JSON.stringify(pkg, null, 2));
      console.log(`✓ صُدّرت إلى ${out}`);
      return;
    }
    default:
      console.log("الاستخدام: pnpm ext <validate|install|list|export> …");
      process.exit(2);
  }
}
main().catch((e) => {
  console.error(`✗ ${e.message}${e.hint ? `\nتلميح: ${e.hint}` : ""}`);
  process.exit(1);
});
