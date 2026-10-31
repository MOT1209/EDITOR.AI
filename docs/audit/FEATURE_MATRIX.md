# مصفوفة الميزات — EDITOR.AI (2026-10-31)

الدرجات: ✅ منفَّذة ومُتحقَّق منها · ◐ جزئية · 🎭 محاكاة (موسومة) · ❌ غير موجودة · ❓ لم تُختبر هنا.
عمود «الدليل» يذكر ما شُغِّل فعلاً (V = Verified، C = Code-verified، NR = Not re-verified، NT = Not tested).

| الميزة | الحالة | الدليل | ملفات | ثغرة/ملاحظة | معرّف |
|--------|--------|--------|-------|-------------|-------|
| رفع فيديو + تحقق ffprobe + رفض المزيّف | ✅ | V: HTTP حي (200 للعيّنة، 400 للمزيّف ويُحذف) + tests/security | `app/api/ffmpeg/probe/route.ts`, `lib/server/uploads.ts` | الاستجابة تعيد `ref` معتماً بلا مسار (T-03) | — |
| حدود حجم/نوع/تخزين للرفع | ✅ (بعد المرحلة 2) | V: tests/security (413/507/امتداد) | `lib/server/validate.ts`, `storage.ts` | رفع GB ما يزال مكلفاً في الذاكرة (P-1) | P-1 |
| تنظيف الملفات المؤقتة | ✅ (بعد المرحلة 2) | V: tests/security/storage | `lib/server/storage.ts`, `scripts/cleanup.ts` | لا يغطي `ASSETS_DIR` ولا مساحة العمل عمداً | — |
| عمليات التايملاين (قص/تقسيم/نقل/حذف/تراجع) | ✅ | V: 16 اختبار وحدة + MCP e2e | `lib/engine/timeline.ts` | واجهة المستخدم: NR | — |
| تايملاين متعدد المسارات | ✅ (المرحلة 3/4) | V: `render.integration.test.ts` + Playwright يدوي | `render-plan.ts`, `timeline.tsx` | يُركَّب عند التصدير؛ المعاينة الحية تقريبية (المرندرة مرجعية) | F-11 |
| **تصدير متعدد المسارات (تركيب)** | ✅ (المرحلة 3) | V: اختبار PIP بالبكسل | `render-compile.ts` | المسار القديم باقٍ لمشاريع المصدر الواحد | F-11 |
| **تصدير من عدة مصادر وسائط** | ✅ (المرحلة 3) | V: ffmpeg حقيقي | `render-sources.ts` | مصدر مفقود = خطأ صريح | F-10 |
| صوت إضافي (موسيقى/تعليق) في تصدير الواجهة | ✅ (المرحلة 3/4) | V: volumedetect | `/api/assets/upload`, `Inspector` | الصوت بلا ref يُحجب (إقرار صريح) | F-12 |
| صوت إضافي في تصدير MCP (أصول الخادم) | ✅ | V: اختبار MCP + `jobs.ts` | `lib/engine/jobs.ts` | `blob:` يُرفض بتحذير | — |
| معالجة audio blob | ✅ (المرحلة 4) | V: زر «رفع للخادم» في الخصائص | `inspector.tsx` | — | F-13 |
| تكبير/تحريك (zoom/pan/smartZoom) للمقطع | ✅ (المرحلة 3) | V: اختبار خطة | `render-compile.ts` | smartZoom كقيم ثابتة (لا مفاتيح) | F-14 |
| تأثيرات على مستوى المشروع | ✅ | V: `ffmpeg-export.test.ts` (8) | `buildEffectChain` | `clip.effects` للعرض فقط | F-15 |
| ترجمات/نصوص (ASS) | ✅ | V: اختبارات بانٍ + e2e | `buildAss` | — | — |
| صور B-roll كطبقات | ✅ | C + اختبار بانٍ | `buildImageOverlays` | مقيّد بـ `ASSETS_DIR` | — |
| تطابق المعاينة والتصدير | ◐ | NR (Playwright سابق) + V: `buildSegments` | `Editor.tsx` | فروق F-12/F-14؛ لا اختبار واجهة آلي | F-16 |
| مزامنة التايملاين | ✅ | V: مصدر واحد `timeline.ts` للمحرّر وMCP | — | — | — |
| مراجعة ما بعد الرندر (ffprobe+blackdetect+volume) | ✅ | V: pytest + vitest + e2e | `render_review.py`, `media.ts:reviewRender` | — | — |
| إلغاء التصدير + مهلة + حذف الجزئي | ✅ | V: اختبار MCP + HTTP | `export-jobs.ts`, `runExport` | المهام في ذاكرة العملية (D-02) | D-02 |
| NVENC / auto-editor / Windows | ❓ | NT | `hasNvenc`, `auto_editor_utils.py` | — | — |
| خادم MCP (37 أداة + `ext_*`) | ✅ | V: e2e 20+ فحصاً + 20 اختبار تكامل | `mcp/server.ts` | stdio فقط، لا مصادقة نقل بعيد | — |
| موافقة العمليات المكلفة/المدمّرة (MCP) | ✅ | V: elicitation، رفض بلا دعم | `mcp/approval.ts` | — | — |
| موافقة العمليات في HTTP `/api/extensions` | ✅ (بعد المرحلة 2) | V: tests/security/approvals | `lib/server/approvals.ts` | `grant` و`DELETE confirm` بلا مصافحة (SEC-03b) | SEC-03b |
| وكلاء Python (5 مراحل + بوابات) | ✅ | V: pytest 36 + `--demo` سابقاً | `src/agents/*` | بلا مفاتيح ⇒ تفريغ فارغ + تحذير | — |
| جسر الخطة ↔ التايملاين (تطبيق + تراجع) | ✅ | V: اختبار تكامل MCP↔Python | `lib/engine/plans.ts` | crop 9:16 وDucking غير مطبّقين (معلن) | F-14 |
| عقد EDL موحّد Python↔TS | ✅ | V: 60 فحصاً | `scripts/check-contract.ts` | — | — |
| نظام المهارات (43) | ◐ | V: تسجيل/تشغيل؛ C: التنفيذ | `lib/skills/*` | أغلبها استدلالي (`simulated`) | S-1 |
| إضافات مخصّصة (مهارات/أدوات MCP) | ✅ | V: 5 ملفات اختبار | `lib/extensions/*` | sandbox يُتخطّى بلا `bwrap` (NT هنا) | — |
| عزل عمليات الإضافات | ◐ | V: `unshare`؛ bwrap NT | `lib/extensions/sandbox.ts` | FFmpeg الأساسي بلا عزل namespace | SEC-08 |
| ضابط التكلفة | ✅ | V: 5 اختبارات + C: المسارات | `cost-guard.ts` | الحالة في الذاكرة/ملف محلي | — |
| تفريغ صوتي (Whisper) | ◐ | C | `/api/ai/transcribe*` | يحتاج مفتاحاً؛ NT | — |
| ترجمة/سكربت/عناوين/TTS | ◐ | C | `/api/ai/*` | مفتاح مزوّد؛ NT بمزوّد حقيقي | — |
| كشف مشاهد/صمت/BPM حقيقي | ✅ | V: `media.test.ts` (FFmpeg حقيقي) | `lib/engine/media.ts` | كشف الوجوه/الأجسام محاكاة 🎭 | S-1 |
| `/api/ai/{faces,objects,reframe,scenes(vision),analyze}` | 🎭/◐ | C | `app/api/ai/*` | موسومة `simulated` بلا مفتاح | S-1 |
| تخزين المشاريع | ◐ | V: MCP/engine؛ NR: localStorage | `lib/engine/store.ts`, `lib/project.ts` | JSON على القرص، بلا قاعدة بيانات ولا نسخ احتياطي ولا قفل تزامن متعدد العمليات (C) | D-02 |
| مصادقة/مستخدمون/أدوار | ❌ → ◐ | V: رمز واحد مشترك | `lib/server/auth.ts` | لا مستخدمين ولا أدوار | SEC-02 |
| تسجيل مهيكل | ◐ | V: tests/security | `lib/server/logger.ts` | مطبّق على المسارات الجديدة/pipeline؛ باقي `console` في `mcp/stdio.ts` مقصود | D-05 |
| ترويسات أمان | ✅ | V: curl/اختبار | `next.config.js` | CSP كاملة مؤجلة | SEC-12 |
| CI | ✅ | C (YAML)؛ NT على GitHub | `.github/workflows/ci.yml` | لا Playwright | F-16 |
