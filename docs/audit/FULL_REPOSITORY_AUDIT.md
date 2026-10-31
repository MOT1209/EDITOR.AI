# التدقيق الشامل للمستودع — المرحلة 1 (EDITOR.AI / MontageAI)

> التاريخ: 2026-10-31 · الفرع: `ccr-3587eedd-u75ugk` · الأساس: `660f4f0`
> المنهج: قراءة التنفيذ الفعلي + تشغيل كل الفحوص + اختبارات توصيف (`tests/audit/known-gaps.test.ts`) تثبت القيود بالدليل.
> هذا التدقيق **سبقه** تدقيق في 2026-10-29 (`EDITOR_AI_AUDIT.md` + `IMPLEMENTATION_REPORT.md`). لم أعتمد على ادعاءاته: أعدت تشغيل خط الأساس
> وفحصت الشيفرة مجدداً. ما لم أستطع إعادة التحقق منه مذكور صراحة كـ **Not re-verified**.

## 0. مفتاح التصنيف

| الوسم | المعنى |
|-------|--------|
| **Verified** | شُغِّل فعلياً في هذه الجلسة (أمر/اختبار/طلب HTTP حي) ونتيجته مسجّلة |
| **Code-verified** | قُرئت الشيفرة وتُبّع مسارها، دون تشغيل |
| **Not re-verified** | يعتمد على تقرير سابق (Playwright/واجهة) ولم أعد تشغيله هنا |
| **Assumption** | استنتاج لم يُختبر — مذكور بوضوح |
| **Not tested** | غير ممكن في هذه البيئة (السبب مذكور) |

## 1. البيئة وخط الأساس (Verified)

Node 22.23.4 · pnpm 10.28 · Python 3.13.18 · FFmpeg 6.1.1 (بلا GPU) · لا مفاتيح مزوّدين.

| الفحص | قبل المرحلة 2 | بعد المرحلة 2 |
|-------|---------------|---------------|
| `npx tsc --noEmit` | ✅ 0 أخطاء | ✅ |
| `pnpm lint` | ✅ | ✅ |
| `pnpm test` | ✅ 114 نجح / 2 تخطّي (116) | ✅ 159+ (1 تخطّي: `bwrap` غير متاح) |
| `python -m pytest` | ✅ 36 (بعد `pip install` الاعتماديات الدنيا) | ✅ 36 |
| `node scripts/check-contract.ts` | ✅ | ✅ |
| `pnpm mcp:e2e` | ✅ (لم يُعَد قبل الإصلاح؛ نتيجة 2026-10-29 20/20) | ✅ |
| `pnpm build` | ✅ على Next 14 | ✅ على Next 15.5.28 (بعد إصلاحين، انظر F-01) |
| `pnpm audit --prod` | ⚠️ **33** (3 حرجة / 14 high) | ✅ 0 |

## 2. الهيكل (Code-verified)

| الطبقة | الملفات | الحجم/ملاحظات |
|--------|---------|----------------|
| واجهة Next | `app/*`, `components/editor/*`, `components/shorts/*`, `components/extensions/*` | `Editor.tsx` أحادي **3559 سطراً** |
| مسارات API | 34 مساراً `app/api/**` | `ai/*` (15)، `agents/*` (3)، `export/*`، `projects/*`، `extensions/*`، `skills`، `assets/*`، `jobs`، `budget`، `thumbnail`، `ffmpeg/probe` |
| محرّك المشروع | `lib/engine/*` | مخطط v2، عمليات تايملاين نقية، مساحة عمل JSON، ffprobe/ffmpeg، تصدير، جسر خطط |
| التصدير | `lib/server/ffmpeg-export.ts` (759) | بانٍ نقي `buildExportPlan` + `runExport` |
| مهارات | `lib/skills/*` | 43 مهارة + 3 workflows |
| إضافات | `lib/extensions/*` | حزم بيانات، سجل إجراءات، sandbox (bwrap/unshare)، توقيع |
| MCP | `mcp/server.ts` (1001) | 37 أداة مدمجة + `ext_*` ديناميكية |
| وكلاء Python | `src/agents/*` | CEO→Analyst→Director→Critic→Audio→Render + بوابات |
| قاعدة بيانات | **لا يوجد** | ملفات JSON على القرص (`workspace/projects/*`, `.montage_ai/*`) + `localStorage` في المتصفح |
| مصادقة | **لم تكن موجودة** | فقط حارس Host/Origin؛ أُضيف رمز اختياري في المرحلة 2 |
| CI | `.github/workflows/ci.yml` | py + tsc + lint + vitest + contract + e2e + build + gitleaks (+ تدقيق تبعيات أُضيف) |

## 3. النتائج (Findings)

صيغة كل بند: **الملفات · الدليل · الخطورة · الأثر · الحل · الاعتماديات**. المعرّفات مرجعها `TECHNICAL_DEBT.md` و`DEVELOPMENT_ROADMAP.md`.

### 3.1 التصدير والتايملاين (المطلوب فحصه تحديداً)

| # | الحالة | التفاصيل |
|---|--------|----------|
| **F-10** | **تصدير مصدر وسائط واحد فقط** — Verified | **الملفات:** `lib/server/ffmpeg-export.ts` (`buildSegments`، `buildExportPlan` سطر ~646 `-i sourcePath`)، `app/api/export/route.ts` (`sourcePath` واحد). **الدليل:** `tests/audit/known-gaps.test.ts` G-1: مقطعان بـ `assetId` مختلفين ⇒ مدخل `-i` واحد وكلاهما من `[0:v]`؛ `assetId` مُهمَل. **الخطورة:** عالية (خطأ صامت: لقطة خاطئة بلا تحذير). **الأثر:** إضافة فيديو ثانٍ للتايملاين يُصدَّر مقطوعاً من الفيديو الأول. **الحل:** مدخل لكل أصل + خريطة `assetId→input index` في `buildFilterComplex`، ورفض صريح (400) إن غاب مسار أصل. **الاعتماديات:** F-13 (رفع أصول متعددة)، T-02. |
| **F-11** | **المسارات المتعددة تُلصق ولا تُركَّب** — Verified | **الملفات:** `ffmpeg-export.ts:buildSegments`. **الدليل:** G-2: مقطعان متزامنان على مسارين ⇒ `totalDuration = 20` (10+10) و`concat=n=2`، لا `overlay`. **الخطورة:** عالية. **الأثر:** picture-in-picture/طبقات غير ممكنة؛ المعاينة قد تُظهر ما لا يخرج. **الحل:** نموذج تركيب (z-order حسب المسار، `overlay` بنوافذ `enable`)، أو منع تداخل المقاطع في الواجهة حتى ذلك الحين. **الاعتماديات:** F-10. |
| **F-12** | **صوت التايملاين لا يدخل تصدير الواجهة** — Verified | **الملفات:** `app/api/export/route.ts` (لا `audioInputs`)، `lib/engine/jobs.ts:100,186` (مسار MCP يمزج)، `Editor.tsx:1295` (تحذير فقط). **الدليل:** G-3. **الخطورة:** عالية. **الأثر:** الموسيقى/التعليق الصوتي من المتصفح يسمعها المستخدم في المعاينة ولا تظهر في الملف. **الحل:** رفع الصوت كأصل على الخادم (F-13) وتمريره كـ `audioInputs`. **الاعتماديات:** F-13. |
| **F-13** | **لا معالجة لـ audio blob** — Code-verified | روابط `blob:` (من `generateToneTrack` في `lib/mockAi.ts`، تسجيلات، رفع محلي) صالحة في المتصفح فقط. لا مسار API يستقبل ملفاً صوتياً ليحفظه كأصل (`validateAudioUpload` يُستخدم لـ Whisper فقط). **الخطورة:** عالية (سبب جذري لـ F-12). **الحل:** `POST /api/assets/audio` (تحقق ffprobe + حدود + `saveUpload`) ثم استبدال `blob:` بمعرّف أصل. |
| **F-14** | `zoom/panX/panY/smartZoom` للمقطع عرض فقط — Verified | G-4: لا يقرؤها `ffmpeg-export.ts`. **الخطورة:** متوسطة. **الأثر:** انحراف معاينة/تصدير؛ crop الذكي 9:16 من الوكلاء يُعلن في `ignoredFeatures`. **الحل:** `crop/scale/zoompan` لكل مقطع من هذه الحقول. |
| **F-15** | `clip.effects` للمقطع للعرض فقط؛ التأثيرات على مستوى المشروع — Code-verified | `buildExportPlan` يمرّر `project.effects` لا `clip.effects`. **متوسطة.** |
| **F-16** | تزامن التايملاين | `lib/engine/timeline.ts` مصدر واحد للمحرّر وMCP (16 اختبار وحدة، Verified). تشغيل المعاينة يتبع خطة التصدير (**Not re-verified**، تقرير Playwright سابق). لا اختبار آلي للواجهة (Playwright غير مُدرج في CI) ⇒ **Gap**. |
| **F-17** | تحذير فقط عند فقدان الصوت | Editor يحذّر عند `blob:` أو `musicId` (سطر 1295) — جيد لكنه لا يمنع التصدير. اقتراح: حجب/تأكيد صريح. |

### 3.2 الرندر والتحقق

| # | الحالة |
|---|--------|
| **R-1** | مراجعة ما بعد الرندر (ffprobe + blackdetect + volumedetect) في Python (`render_review.py`) وTS (`reviewRender`) — **Verified** (pytest 36 + vitest + e2e). الرندر لا يُعلن نجاحاً دون اجتياز المراجعة. |
| **R-2** | إلغاء/مهلة/حذف المخرَج الجزئي — **Verified** (اختبار MCP "cancel"، `DELETE /api/export`). |
| **R-3** | NVENC/auto-editor/Windows — **Not tested** (غير متوفرة هنا). |
| **R-4** | `runExport` يعمل داخل عملية Next نفسها بلا طابور خارجي؛ `maxDuration=120` على مسار التصدير — **Code-verified**. تصدير طويل يعتمد على بقاء العملية (لا استئناف بعد إعادة التشغيل). |

### 3.3 النتائج المحاكاة والمهارات

| # | الدليل | الحالة |
|---|--------|--------|
| **S-1** | `Math.random` في 7 مهارات (`FaceDetection`, `ObjectDetection`, `AutoReframe`, `SilenceDetection`, `HookGeneration`, `SceneDetection`, `HighlightDetection`) و`lib/mockAi.ts` | موسومة `provenance=simulated` (BaseSkill) — **Code-verified**. المتبقي استدلالي لا تحليل حقيقي. |
| **S-2** | `/api/ai/subtitles` يولّد عبارات عربية عشوائية دوماً | موسوم `simulated:true` — **Code-verified** |
| **S-3** | 43 مهارة: التسجيل سليم (Vitest `skills.test.ts`)، التنفيذ استدلالي في الأغلب ولا يعدّل حالة المشروع | **Partially verified** |
| **S-4** | لا تفريغ صوتي محلي في TS (Whisper يحتاج مفتاحاً؛ faster-whisper اختياري في Python) | **Code-verified** |

### 3.4 قابلية التمديد

| المجال | الحالة | الدليل |
|--------|--------|--------|
| المهارات | ✅ ملف في `catalog/` + تسجيل + اختبار؛ أو حزمة بيانات عبر `/extensions` | `lib/skills/README.md`، `lib/extensions/*` 5 ملفات اختبار (Verified) |
| MCP | ✅ أدوات مخصّصة `ext_*` من السجل دون تعديل `mcp/server.ts`؛ إضافة أداة مدمجة = `tool(...)` + Zod + اختبار | `mcp/custom-tools.test.ts` (Verified) |
| الحدّ | سجل الإجراءات مغلق عمداً (لا shell/ffmpeg حر)؛ إجراء جديد يتطلب تعديل `lib/extensions/actions.ts` | تصميم مقصود |
| الوكلاء | CEO يعمل في مسارين متوازيين: `app/api/agents/ceo/route.ts` (TS، 638 سطراً) و`src/agents/ceo_agent.py` (Python) بمنطق متباين — **Code-verified** ⇒ ازدواج (D-03) |

### 3.5 تنسيق الوكلاء (Agent orchestration)

- مسار Python: مراحل مرتّبة + بوابات مستقلة عن CrewAI (`validation.py`) — **Verified** (pytest + فحص CI يطابق `STAGE_VALIDATORS` مع `STAGE_ORDER`).
- الجسر إلى المحرّر: `create_editing_plan → review → apply_editing_plan` بموافقة وتراجع — **Verified** (اختبار تكامل MCP↔Python؛ كان يُتخطّى بلا حزم Python، يعمل الآن بعد `pip install`).
- خطة الصوت (موسيقى/Ducking) من Python = مواصفة فقط (**Code-verified**، يتكرر في F-12).
- لا طابور مهام دائم: المهام في ذاكرة العملية (`aiJobs` في `lib/mockAi.ts`، مستورد من مسارات `jobs`/`export`) ⇒ تضيع عند إعادة التشغيل (D-02).

### 3.6 الأمان

التفاصيل الكاملة في [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md). الخلاصة: 33 ثغرة تبعيات (أُغلقت)، لا مصادقة (أُضيفت اختيارية)، تأكيد موافقة يقرره العميل (أُصلح)، مدخلات JSON بلا حدود (أُصلحت لـ 12 مساراً)، رفع بلا سقف/تنظيف (أُصلح).

### 3.7 الأداء

| # | البند | الخطورة |
|---|-------|---------|
| **P-1** | رفع الملف: `arrayBuffer()` ثم `Buffer.from` (نسختان في الذاكرة) — أُصلح بالبث إلى القرص؛ لكن `req.formData()` نفسه يحمّل الجسم في الذاكرة/ملف مؤقت في Next ⇒ ملفات GB ما تزال مكلفة (**Code-verified**، حل جذري: رفع مجزّأ/TUS) | متوسطة |
| **P-2** | `Editor.tsx` 3559 سطراً في ملف واحد ⇒ إعادة رسم/بناء/صيانة | متوسطة |
| **P-3** | `runExport` يُنفَّذ في عملية الخادم نفسها (CPU شديد يجمّد باقي الطلبات) — **Assumption** لم يُقَس | متوسطة |
| **P-4** | لا فحص أداء/Lighthouse أُجري — **Not tested** | — |

### 3.8 اختبارات وCI والتوثيق

- Vitest يغطي `lib/**`, `mcp/**`, `tests/**`. **لا اختبارات واجهة (DOM/Playwright)** ⇒ Editor.tsx بلا شبكة أمان (F-16).
- اختبارات مسارات API: كانت غائبة؛ أُضيفت لمسارات `ai/subtitles`، `ai/music-sync`، `ffmpeg/probe` (tests/security).
- CI يشمل gitleaks؛ أُضيف `pnpm audit --prod --audit-level=high`. لم يُشغَّل CI على GitHub هنا (**Not tested**).
- التوثيق عربي ومفصّل؛ بعض الأعداد في CLAUDE.md/README قديمة (مثل «116 اختباراً») وتم تحديث README.

## 4. ما يعمل فعلاً (Verified هذه الجلسة)

رفع + ffprobe + رفض الملف المزيّف (HTTP حي) · مصادقة الرمز وحارس Origin (HTTP حي على `next start`) · رفض DoS (HTTP حي) · مسار Python كامل (pytest) · تصدير FFmpeg حقيقي (e2e) · MCP عبر stdio (e2e) · بناء Next 15 · مصفوفة الاختبارات أعلاه.

## 5. خطة التنفيذ ذات الأولوية

انظر [`../roadmap/DEVELOPMENT_ROADMAP.md`](../roadmap/DEVELOPMENT_ROADMAP.md) (مراحل 3–8 مع معايير القبول والاعتماديات).
