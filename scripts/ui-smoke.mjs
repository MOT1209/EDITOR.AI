// دخان الواجهة (T-16): رفع → تقديم → تقسيم → تراجع/إعادة → تصدير → تحقق ffprobe من الملف الناتج.
// الاستخدام: BASE_URL=http://localhost:3000 node scripts/ui-smoke.mjs
// يتطلب حزمة playwright ومتصفح Chromium (مثبّتان في بيئة التطوير السحابية؛ محلياً: npx playwright install chromium).
import { createRequire } from "module";
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright")); }

const BASE = process.env.BASE_URL || "http://localhost:3000";
const VIDEO = process.env.SMOKE_VIDEO || path.join(process.cwd(), "test_assets", "test_video.mp4");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
const tmp = mkdtempSync(path.join(os.tmpdir(), "ui-smoke-"));

try {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.setInputFiles('input[type=file][accept="video/*"]', VIDEO);
  await page.getByRole("button", { name: "تقسيم عند المؤشر" }).waitFor({ state: "visible", timeout: 20000 });
  check("رفع الفيديو وظهور أدوات التايملاين", true);

  const undo = page.getByRole("button", { name: "تراجع", exact: true });
  const redo = page.getByRole("button", { name: "إعادة", exact: true });
  await page.getByRole("button", { name: "تقديم 5 ثوان" }).click();
  await page.waitForTimeout(400);
  const undoBefore = await undo.first().isDisabled();
  await page.getByRole("button", { name: "تقسيم عند المؤشر" }).click();
  await page.waitForTimeout(400);
  check("التقسيم يفعّل زر التراجع", undoBefore && !(await undo.first().isDisabled()));
  await undo.first().click();
  await page.waitForTimeout(300);
  check("التراجع يفعّل الإعادة", !(await redo.first().isDisabled()));
  await redo.first().click();
  await page.waitForTimeout(300);

  // إزالة الصمت تستخدم sourceRef (T-03) ويجب أن يردّ المسار 200 لا 400.
  const silenceResp = page.waitForResponse((r) => /\/api\/ai\/silence$/.test(r.url()), { timeout: 60000 });
  await page.getByRole("button", { name: /^إزالة الصمت والتوقفات/ }).click();
  const sr = await silenceResp.catch(() => null);
  check("إزالة الصمت عبر sourceRef (HTTP 200)", !!sr && sr.status() === 200, sr ? String(sr.status()) : "لا استجابة");
  await page.waitForTimeout(1500);

  const statusDone = page.waitForResponse(async (r) => {
    if (!/\/api\/export\/status\/job_/.test(r.url()) || !r.ok()) return false;
    try { const j = await r.json(); return j.status === "completed" || j.status === "failed"; } catch { return false; }
  }, { timeout: 120000 });
  const exportReq = page.waitForRequest((r) => /\/api\/export$/.test(r.url()) && r.method() === "POST", { timeout: 20000 });
  await page.getByRole("button", { name: "تصدير" }).first().click();
  // نافذة تصدير قد تطلب تأكيداً ثانياً
  const confirmBtn = page.getByRole("button", { name: /^(تصدير|بدء التصدير|ابدأ التصدير)$/ });
  if (await confirmBtn.count() > 1) await confirmBtn.last().click().catch(() => {});
  const req = await exportReq.catch(() => null);
  if (!req) {
    check("إرسال طلب التصدير", false, "لم يُرصد POST /api/export");
  } else {
    const body = JSON.parse(req.postData() || "{}");
    check("طلب التصدير يستخدم sourceRef معتماً لا مساراً", typeof body.sourceRef === "string" && body.sourceRef.startsWith("upload:") && !("sourcePath" in body));
    const done = await (await statusDone).json();
    check("اكتمال التصدير", done.status === "completed", done.message || "");
    check("حالة التصدير بلا مسار قرص", !JSON.stringify(done).includes("/.montage_ai/") && !JSON.stringify(done).includes(process.cwd()));
    if (done.status === "completed") {
      const dl = await page.request.get(`${BASE}/api/export/download/${done.id}`);
      const out = path.join(tmp, "out.mp4");
      writeFileSync(out, await dl.body());
      const pr = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "json", out], { encoding: "utf-8" });
      const info = JSON.parse(pr.stdout || "{}");
      const types = (info.streams || []).map((s) => s.codec_type);
      check("الملف المصدَّر فيديو+صوت صالح (ffprobe)", types.includes("video") && types.includes("audio") && Number(info.format?.duration) > 5, `${Number(info.format?.duration).toFixed(1)}s`);
    }
  }
  check("لا أخطاء console/pageerror", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("تنفيذ السيناريو", false, String(e.message).slice(0, 300));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nفشل ${failed.length}/${results.length}` : `\nUI smoke: كل الفحوص نجحت (${results.length})`);
process.exit(failed.length ? 1 : 0);
