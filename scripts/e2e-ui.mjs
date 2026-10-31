// E2E واجهة حقيقي (Playwright + Chromium + FFmpeg): رفع → استيراد وسائط → طبقة PIP → خصائص → سحب → تراجع
// → معاينة مرندرة صالحة. الاستخدام: BASE_URL=http://localhost:3000 node scripts/e2e-ui.mjs
import { chromium } from "playwright";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const tmp = mkdtempSync(path.join(os.tmpdir(), "ui-e2e-"));
const gen = (a) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a]);
gen(["-f", "lavfi", "-i", "color=c=green:s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=f=660:d=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(tmp, "green.mp4")]);
gen(["-f", "lavfi", "-i", "sine=f=300:d=8", "-c:a", "libmp3lame", path.join(tmp, "bgm.mp3")]);

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROMIUM || undefined });
try {
  const pg = await browser.newPage({ viewport: { width: 1700, height: 980 } });
  const errors = [];
  pg.on("pageerror", (e) => errors.push(e.message));
  pg.on("dialog", (d) => d.accept());
  await pg.goto(BASE, { waitUntil: "networkidle" });
  await pg.locator("input[type=file]").first().setInputFiles("test_assets/test_video.mp4");
  await pg.waitForSelector("text=الوسائط", { timeout: 20000 });
  await pg.waitForTimeout(2000);

  await pg.getByRole("button", { name: "الوسائط" }).first().click();
  await pg.locator('input[aria-label="اختيار ملفات للاستيراد"]').setInputFiles([path.join(tmp, "green.mp4"), path.join(tmp, "bgm.mp3")]);
  await pg.waitForSelector('li:has-text("green.mp4")', { timeout: 30000 });
  await pg.waitForSelector('li:has-text("bgm.mp3")', { timeout: 30000 }); // الرفع متتابع: انتظر الثاني أيضاً
  check("استيراد فيديو وصوت إلى المكتبة", (await pg.locator('li:has-text("للتايملاين")').count()) === 2);

  await pg.getByRole("button", { name: /إضافة مسار فيديو/ }).click();
  const sel = pg.locator('select[aria-label="المسار الهدف"]');
  await sel.selectOption(await sel.locator("option", { hasText: "طبقة حرّة" }).first().getAttribute("value"));
  await pg.locator("li", { hasText: "green.mp4" }).getByRole("button", { name: /للتايملاين/ }).click();
  await pg.locator("li", { hasText: "bgm.mp3" }).getByRole("button", { name: /للتايملاين/ }).click();
  await pg.waitForTimeout(500);
  const clips = pg.locator("[data-clip-id]");
  const n = await clips.count();
  check("مقطعان على التايملاين (الأساسي + الطبقة)", n === 2, `n=${n}`);

  await clips.nth(n - 1).click();
  const f = pg.locator('input[id="insp-الحجم"]');
  await f.fill("40");
  await f.blur();
  check("الخصائص: الحجم 40%", (await f.inputValue()) === "40");

  const box = await clips.nth(n - 1).boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 8 });
  await pg.mouse.up();
  await pg.waitForTimeout(300);
  const moved = (await clips.nth(n - 1).boundingBox()).x;
  check("سحب المقطع يغيّر موضعه", Math.abs(moved - box.x) > 50);
  await pg.keyboard.press("Control+z");
  await pg.waitForTimeout(300);
  check("التراجع يعيد الموضع", Math.abs((await clips.nth(n - 1).boundingBox()).x - box.x) < 3);

  const slider = pg.locator('[role=slider][aria-label="مؤشر التشغيل"]');
  await pg.keyboard.press("Shift+ArrowRight");
  await pg.waitForTimeout(200);
  check("اختصار Shift+→ يحرّك المؤشر ثانية", Number(await slider.getAttribute("aria-valuenow")) >= 1);

  await pg.getByRole("button", { name: "إضافة مفتاح الشفافية عند المؤشر" }).click();
  await pg.waitForTimeout(300);
  check("مفتاح شفافية يُضاف عند المؤشر", (await pg.locator('button[aria-label^="حذف مفتاح الشفافية"]').count()) === 1);

  await pg.getByRole("button", { name: "معاينة مرندرة" }).click();
  await pg.waitForSelector('[aria-label="المعاينة المرندرة"] video', { timeout: 90000 });
  const src = await pg.locator('[aria-label="المعاينة المرندرة"] video').getAttribute("src");
  const res = await pg.request.get(BASE + src);
  const len = Number(res.headers()["content-length"] || 0);
  check("المعاينة المرندرة ملف فيديو صالح", res.ok() && len > 1000, `bytes=${len}`);
  check("لا أخطاء JS في الصفحة", errors.length === 0, errors.join("|"));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) {
  console.error(`E2E UI: فشل ${failed} فحص`);
  process.exit(1);
}
console.log("E2E UI: كل الفحوص نجحت");
