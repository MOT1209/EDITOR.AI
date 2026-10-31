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

  // تحديد متعدد: Ctrl+نقر على المقطعين
  await clips.nth(0).click();
  await clips.nth(n - 1).click({ modifiers: ["Control"] });
  check("تحديد متعدد (Ctrl+نقر)", (await pg.locator("text=2 محدّدة").count()) === 1);
  await pg.keyboard.press("Escape");

  // قائمة السياق: عناصر المقطع
  await clips.nth(n - 1).click({ button: "right" });
  const items = await pg.locator("[role=menu] [role=menuitem]").allTextContents();
  check("قائمة السياق: تقسيم/دمج/نسخ/حذف", ["تقسيم", "دمج", "نسخ", "حذف"].every((w) => items.some((t) => t.includes(w))), items.join("|"));
  await pg.keyboard.press("Escape");

  // تغيير ارتفاع المسار بالسحب
  const row = pg.locator("[data-track-id]").first();
  const h0 = (await row.boundingBox()).height;
  const sep = pg.locator('[role=separator][aria-orientation=horizontal]').first();
  const sb = await sep.boundingBox();
  await pg.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 40, { steps: 5 });
  await pg.mouse.up();
  check("تغيير ارتفاع المسار بالسحب", (await row.boundingBox()).height > h0 + 20);

  // مجلدات المكتبة: إنشاء مجلد وتصفية
  await pg.locator('input[aria-label="اسم مجلد جديد"]').fill("لقطات");
  await pg.keyboard.press("Enter");
  check("إنشاء مجلد في المكتبة", (await pg.getByRole("button", { name: "لقطات", pressed: true }).count()) === 1);
  await pg.getByRole("button", { name: "كل الوسائط" }).click();
  await pg.locator('input[aria-label="بحث في الوسائط"]').fill("bgm");
  check("بحث المكتبة يصفّي النتائج", (await pg.locator('li:has-text("للتايملاين")').count()) === 1);
  await pg.locator('input[aria-label="بحث في الوسائط"]').fill("");

  // وصولية أساسية: لا زر ولا حقل بلا اسم
  const unnamed = await pg.evaluate(() => {
    const bad = [];
    for (const b of document.querySelectorAll("button, [role=button]")) {
      if (!(b.getAttribute("aria-label") || b.textContent?.trim() || b.getAttribute("title"))) bad.push(b.outerHTML.slice(0, 80));
    }
    for (const i of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      const id = i.id;
      const labelled = i.getAttribute("aria-label") || i.getAttribute("title") || i.getAttribute("placeholder") || (id && document.querySelector(`label[for="${id}"]`)) || i.closest("label");
      if (!labelled) bad.push(i.outerHTML.slice(0, 80));
    }
    return bad;
  });
  check("وصولية: كل زر وحقل له اسم", unnamed.length === 0, unnamed.slice(0, 5).join(" || "));

  await pg.getByRole("button", { name: "الوسائط" }).first().click(); // يعيد التركيز بعد فحص الوصولية
  await clips.nth(n - 1).click(); // أعد تحديد الطبقة (الخطوات السابقة ألغت التحديد)
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
