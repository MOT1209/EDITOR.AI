// تنظيف الملفات المؤقتة/المنتهية (uploads/exports/pipeline). الاستخدام: pnpm cleanup [--dry-run]
import { runCleanup } from "../lib/server/storage";

const dryRun = process.argv.includes("--dry-run");
runCleanup({ dryRun }).then((res) => {
  let files = 0;
  let bytes = 0;
  for (const r of res) {
    files += r.removed.length;
    bytes += r.freedBytes;
    console.log(`${r.dir}: ${r.removed.length} عنصراً ${dryRun ? "(سيُحذف)" : "حُذف"}`);
  }
  console.log(`${dryRun ? "[dry-run] " : ""}المجموع: ${files} عنصراً، ${(bytes / 1024 / 1024).toFixed(1)}MB`);
});
