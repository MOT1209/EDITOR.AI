# تقرير الفحص الشامل — EDITOR.AI (MontageAI)

> تاريخ الفحص: 2026-10-29 · الفرع: `ccr-c3a3df8d-fho3s5` · الأساس: `d8c5436`
> المنهج: قراءة التنفيذ الفعلي (لا التعليقات ولا README) + تشغيل كل الفحوص + إعادة إنتاج
> الأعطال المشتبه بها بأوامر حقيقية. كل بند مصنّف بإحدى الدرجات:
>
> - **Verified** — جُرِّب فعلياً (أمر/اختبار/تشغيل) ونتيجته مسجّلة.
> - **Partially verified** — تتبّع شيفرة كامل + تشغيل جزئي.
> - **Not implemented** — غير موجود في الشيفرة (أو زر/مسار بلا منطق).
> - **Not tested** — لم يُختبر في هذه البيئة (السبب مذكور).
>
> هذا التقرير يصف الحالة **قبل** الإصلاحات. ما أُصلح لاحقاً موثّق في
> `docs/audit/IMPLEMENTATION_REPORT.md` مع مرجع الالتزام.

---

## 0. البيئة وخط الأساس (Baseline)

| الأداة | الإصدار |
|--------|---------|
| Node.js | v22.22.0 · pnpm 10.28.0 |
| Python | 3.13.17 (pydantic 2.13، بلا crewai/litellm مثبّتة) |
| FFmpeg / FFprobe | 6.1.1 (`/usr/bin`) — بلا GPU (لا NVENC) |
| مفاتيح مزوّدين | لا شيء (لا `OPENCODE_API_KEY` / `HF_TOKEN` / `PEXELS_API_KEY`) |

| الأمر | النتيجة الفعلية قبل أي تعديل |
|-------|-----------------------------|
| `pnpm install --frozen-lockfile` | ✅ نجح |
| `npx tsc --noEmit` | ✅ 0 أخطاء |
| `npm test` (Vitest) | ✅ 17/17 (3 ملفات) |
| `node scripts/check-contract.ts` | ✅ 60 فحصاً، 0 أخطاء |
| `python -m compileall -q src/` | ✅ |
| `python -m pytest -v` | ✅ 32/32 |
| `npx next lint` | ✅ بلا تحذيرات |
| `npm run build` | ✅ (26 صفحة/مساراً) — لكن `/api/budget` بُني **ثابتاً (○)** انظر B-9 |
| `python -m src.main test_assets/test_video.mp4 --demo --no-broll` | ✅ `final.mp4` 20.0s، h264+aac، المراجعة نجحت (black 0%، صوت −15.3dB) |
| `pnpm audit --prod` | ⚠️ 33 ثغرة معروفة (3 critical / 14 high) كلها عبر `next@14` و`postcss` و`uuid` — انظر S-10 |

**مصدر العيّنة:** `test_assets/test_video.mp4` (= `test_video.mp4` في الجذر، نفس البايتات):
h264 640×360 @25fps + aac، المدة 30.000s.

---

## 1. القدرات العاملة المُتحقَّق منها

| # | القدرة | الدليل | التصنيف |
|---|--------|--------|---------|
| W-1 | مسار Python الكامل (Analyst → Director → Critic → Audio → Render) بلا مفاتيح | تشغيل `--demo` أعلاه: 5 مقاطع، 3 إبقاء، رندر 5.2s | Verified |
| W-2 | الرندر الفعلي في Python (`render_agent.py`) — trim/concat/zoompan/ASS/loudnorm | `final.mp4` موجود، 0.8MB | Verified |
| W-3 | مراجعة ما بعد الرندر (`render_review.py`: ffprobe + blackdetect + volumedetect) مدمجة في `validate_render` | سجل «مراجعة ما بعد الرندر: نجحت» + اختبارات pytest | Verified |
| W-4 | بوابات الجودة لكل مرحلة مستقلة عن CrewAI (`validation.py`) | pytest + فحص CI لتطابق المراحل والبوابات | Verified |
| W-5 | عقد EDL بلغتين متطابق (Python superset) | `check-contract` 60/60 | Verified |
| W-6 | ضابط التكلفة (TS + Python BudgetTracker) كمنطق | اختبارات Vitest/pytest | Verified (المنطق) — التغطية في المسارات ناقصة، انظر B-6 |
| W-7 | تحقق المدخلات (`validateVideoUpload`، `clampString`، `pickEnum`) | Vitest 7 حالات | Verified (المنطق) — غير مطبّق في كل المسارات، انظر S-2 |
| W-8 | تصدير FFmpeg من الواجهة (`lib/server/ffmpeg-export.ts`) — مقاطع، سرعة، لون، تأثيرات، ASS للنصوص والترجمات، صور B-roll | تتبّع شيفرة + بناء ناجح | Partially verified (لا اختبار آلي للأمر قبل هذا الفحص) |
| W-9 | حالة التصدير على القرص (JSON ذري عبر tmp+rename) | تتبّع شيفرة | Partially verified |
| W-10 | سجل الوكلاء والمهارات (43 مهارة، 3 مسارات عمل) مسجّلة | Vitest `skills.test.ts` | Verified (التسجيل فقط — انظر الفقرة 2) |
| W-11 | تصدير NLE عبر auto-editor مع رسالة 503 عند غياب الثنائية | تتبّع شيفرة؛ الثنائية غير مثبّتة | Not tested (لا auto-editor هنا) |
| W-12 | استيراد صور Pexels مقيّد بمضيف `pexels.com` عبر HTTPS (حماية SSRF) | تتبّع شيفرة | Partially verified |

---

## 2. ميزات معطوبة / ناقصة / محاكاة / منفصلة

### 2.1 أعطال صحة (Correctness)

| # | العطل | إعادة الإنتاج / الدليل | التصنيف |
|---|-------|------------------------|---------|
| B-1 | **`normalize_plan` يُسقط محتوى الإبقاء**: CUT يسبق KEEP متداخلاً → يمتد القطع فوق الإبقاء (عكس التعليق «الإبقاء يسيطر»). | `segments=[CUT 0–5, KEEP 3–10]` → الناتج `[(0,10,CUT)]` — الفيديو كله محذوف ثم ترفضه البوابة. | Verified |
| B-2 | **مقاطع «كشف المشاهد» تُصدِّر لقطات خاطئة**: تُنشأ بـ `inPoint=0, outPoint=0` على مسار `video` إضافي؛ `buildSegments` يحوّلها إلى `0..duration` لكل مقطع، فتُلصق بداية الفيديو مكرّرة بعد المقاطع الأصلية. | `Editor.tsx` (aiSceneDetect) + `ffmpeg-export.ts:buildSegments` | Partially verified |
| B-3 | **مواضع مقاطع «إزالة الصمت» على التايملاين وهمية**: `start = i * 0.5` بدل التتابع الفعلي — التايملاين لا يعكس خطة التصدير. | `Editor.tsx` (aiRemoveSilence) | Partially verified |
| B-4 | **الموسيقى والتعليق الصوتي (audioClips) لا تدخل التصدير إطلاقاً**؛ المعاينة تُسمعها والتصدير يتجاهلها (روابط `blob:` لا يراها الخادم). انحراف صامت بين المعاينة والمخرَج. | `grep audioClips lib/server/ffmpeg-export.ts` → لا شيء | Verified |
| B-5 | **كل مسار `video` في التايملاين يرسم كل المقاطع** (لا تصفية بـ `trackId`). | `timeline.tsx:renderTrackContent` | Verified (قراءة) |
| B-6 | **زرّا «قص» و«تقسيم» في التايملاين بلا `onClick`** — لا يوجد تقسيم/قص مقطع في الواجهة. | `timeline.tsx:221-226` | Not implemented |
| B-7 | **لا Undo/Redo ولا سجل عمليات** في المحرّر. | لا `undo` في `components/` | Not implemented |
| B-8 | **حلقة استطلاع التصدير لا تنتهي** إن أعادت حالة المهمة 404 دائماً؛ لا إلغاء للتصدير ولا مهلة لعملية ffmpeg في `runExport`. | `Editor.tsx:startExport` + `runExport` | Verified (قراءة) |
| B-9 | **`/api/budget` يُبنى ثابتاً** (`○` في `next build`) → يعرض إنفاق لحظة البناء دائماً في الإنتاج. | ناتج `npm run build` | Verified |
| B-10 | **المهارات على الخادم تُرجع بيانات عشوائية كأنها نجاح**: `callEndpoint` يستدعي مساراً نسبياً (`/api/ai/silence`) من Node فيفشل، فتسقط المهارة إلى `Math.random`. | `runSkill("SilenceDetectionSkill",{filePath:"/nonexistent"})` → `ok:true` مع فترات صمت عشوائية | Verified |
| B-11 | **`SpeechRecognitionSkill` لا يفرّغ شيئاً**: يُنتج «مقطع كلام 1..n» بتوقيتات ثابتة. | قراءة الشيفرة | Verified (قراءة) |
| B-12 | **مشروع محفوظ لا يعيد ربط الفيديو**: `localStorage` يحفظ البيانات الوصفية فقط؛ إعادة الفتح تُفقد الوسائط ولا رسالة واضحة. لا تحقق مخطط/نسخة عند التحميل أو الاستيراد. | `lib/project.ts`، `importProject` | Verified (قراءة) |
| B-13 | **تجاوز حصة `localStorage` يُبتلع بصمت** (`console.error` فقط) مع حفظ صور مصغرة data-URL كبيرة داخل المشروع. | `saveProjects` | Verified (قراءة) |
| B-14 | `/api/ffmpeg/probe` **لا يفحص الوسائط** رغم اسمه — يكتب الملف فقط بلا تحقق نوع/حجم. | قراءة | Verified (قراءة) |
| B-15 | خطة الصوت في Python (موسيقى + Ducking) **مواصفة فقط** لا تُطبَّق في الرندر — مذكور كتحذير في المخرَج. | ناتج تشغيل `--demo` | Verified |

### 2.2 نتائج محاكاة تُعرض كأنها حقيقية (بلا وسم)

المبدأ «التدهور الأنيق» صحيح، لكنه نُفِّذ في عدة مسارات كـ**اختلاق نتائج** بدل «نتيجة فارغة + تحذير»:

| المسار | سلوكه عند غياب المفتاح/الملف | التصنيف |
|--------|----------------------------|---------|
| `/api/ai/subtitles` | عبارات عربية عشوائية **دائماً** (لا يستخدم أي صوت) | Verified (قراءة) |
| `/api/ai/silence` | فترات صمت عشوائية عند غياب الملف | Verified (قراءة) |
| `/api/ai/scenes`، `/api/ai/analyze`، `/api/ai/faces`، `/api/ai/objects`، `/api/ai/reframe` | درجات/مربعات/نقاط `Math.random` بلا وسم | Verified (قراءة) |
| `/api/ai/enhance` | يردّ «تم تحسين جودة الصوت» دون أي معالجة | Verified (قراءة) |
| `/api/ai/music-sync` | شبكة إيقاع حسابية من BPM يُدخله المستخدم + قوة عشوائية — ليس كشف إيقاع | Verified (قراءة) |
| `/api/agents/ceo` | تفريغ وهمي (`mockTranscript`) يُدمج في الخطة؛ الوسم `mock` يخص الخطة فقط | Verified (قراءة) |
| `lib/mockAi.ts` (`analyzeVideoAI`, `detectSilences`, `generateSubtitles`, `translateTranscript`, `aiVoiceover`) | محاكاة؛ أغلبها لم يعد مستدعى من الواجهة (المستورد فعلياً: `aiJobs`, المكتبات الثابتة, `generateToneTrack`) | Verified (grep) |

**المهارات (43):** التسجيل سليم، لكن التنفيذ في أغلبها **استدلالي/محاكى** وينتج أوصافاً
(خطط/اقتراحات) **لا تعدّل أي حالة مشروع حقيقية**. مهارات تحتوي `Math.random` في مسار
النتيجة: AutoReframe، FaceDetection، HighlightDetection، HookGeneration، ObjectDetection،
SceneDetection، SilenceDetection. المهارات الحسابية الحتمية (AutoCut، SpeedRamp،
TransitionEffect، MusicDucking، TextOverlay، ExportOptimization...) صحيحة كدوال
لكنها **منفصلة** عن التايملاين والتصدير. التصنيف: Partially verified.

---

## 3. الأمن والخصوصية

| # | البند | الخطورة | الدليل | التصنيف |
|---|-------|---------|--------|---------|
| S-1 | **Path traversal في كتابة ملف التصدير**: `project.format` يُدمج في اسم الملف دون تحقق: `path.join(EXPORT_DIR, id + "." + format)`؛ قيمة `"/../../../../tmp/pwned"` → `/tmp/pwned` (ffmpeg يكتب هناك). | **حرجة** | `node -e` يطبع `/tmp/pwned` | Verified |
| S-2 | `/api/export` لا يتحقق من بنية `project` (resolution/fps/quality/aspect/أرقام المقاطع) — قيم غريبة تصل إلى `filter_complex`. | عالية | قراءة | Verified (قراءة) |
| S-3 | `/api/ai/silence` يقبل **أي مسار مطلق على القرص** ويشغّل ffmpeg عليه (كشف وجود ملفات/قراءة صوتها). | عالية | `isSafeFilePath` يفحص فقط «مطلق وملف» | Verified (قراءة) |
| S-4 | **لا مصادقة ولا فحص Origin/Host** على أي مسار API. الخادم المحلي معرّض لـ CSRF (طلبات `multipart` بسيطة بلا preflight من أي موقع يزوره المستخدم إلى `localhost:3000`) و**DNS rebinding**. | عالية (لتطبيق محلي) | لا `middleware.ts` | Verified |
| S-5 | `/api/ffmpeg/probe` يحفظ أي ملف بأي امتداد (من اسم يرسله العميل) بلا حد حجم، و`GET` يكشف المسار المطلق لمجلد الرفع. | متوسطة | قراءة | Verified (قراءة) |
| S-6 | استدعاءات رؤية/تفريغ مدفوعة **لا تمرّ عبر `guardCost`**: `scenes`، `analyze`، `faces`، `objects`، `reframe`، `transcribe`، `agents/ceo` (Whisper + رؤية + Chat). يخالف عرف CLAUDE.md. | متوسطة (مالية) | جدول grep: guard=0 | Verified |
| S-7 | `/api/skills` POST يمرّر `config` إلى `configure()` على **نسخة مهارة مشتركة (singleton)** — يغيّر إعدادات كل الطلبات اللاحقة؛ يقبل `apiBaseUrl` يجعل الخادم يرسل طلبات إلى عنوان يختاره المرسل (SSRF). `errorLog` بلا حد. | متوسطة | قراءة | Verified (قراءة) |
| S-8 | مفاتيح المستخدم تُحفظ في `localStorage` (مذكور بتنبيه في الواجهة) وتُرسل كترويسة. مقبول محلياً؛ يتطلب CSP وعدم تحميل سكربتات خارجية. | منخفضة | `modals.tsx` | Verified (قراءة) |
| S-9 | `GET /api/agents/pipeline` يقرأ الفيديو كاملاً إلى الذاكرة (`readFile`) — ملفات كبيرة تستنزف الذاكرة. | منخفضة | قراءة | Verified (قراءة) |
| S-10 | تبعيات: `next@14.2.35` عليها ثغرات critical/high (Image Optimization RCE، SSRF، DoS) لا تُصلح إلا في 15.5.x. التطبيق لا يستخدم `next/image` (grep فارغ) مما يقلل التعرض لأخطر البنود. الترقية إلى 15 هجرة كبرى (React 19، APIs غير متزامنة) — **لم تُنفَّذ عمداً** في هذا العمل. | عالية (موروثة) | `pnpm audit --prod` | Verified |
| S-11 | لا أسرار في git (`.env.local`، `.montage_ai`، `.venv` مستثناة؛ gitleaks في CI). | — | `.gitignore` + CI | Verified |

**الخصوصية:** ما يبقى على الجهاز وما يُرسل للمزوّد موثّق بدقة في README (القسم «ما يعمل
محلياً مقابل ما يحتاج مفتاحاً»). تصحيح مطلوب: الفيديو **يُرفع إلى خادم Next المحلي**
(`.montage_ai/uploads`) لكل عمليات التحليل/التصدير — أي «محلي» = على جهازك عبر خادمك،
لا «في المتصفح فقط». لا تنظيف تلقائي لهذا المجلد (انظر A-4).

---

## 4. المعمارية والتبعيات

| # | الملاحظة | التصنيف |
|---|----------|---------|
| A-1 | **نموذجا مشروع منفصلان**: الواجهة (`ProjectState` في `localStorage`) ومسار Python (`EdlPlan` في `.montage_ai/pipeline/job_*`). لا جسر يطبّق خطة EDL على تايملاين الواجهة ولا يحفظ مشروعاً على الخادم. | Verified |
| A-2 | `Editor.tsx` أحادي (3277 سطراً) — الحالة مستخرجة في `state.ts` لكن العمليات (قص/تقسيم) غير موجودة كدوال نقية قابلة لإعادة الاستخدام. | Verified |
| A-3 | مسارا Python (`/api/agents/pipeline`) والتصدير يعملان **داخل معالج الطلب** (حتى 300s) — لا طابور ولا إلغاء من العميل. التصدير وحده خلفي (fire-and-forget) مع حالة على القرص. | Verified |
| A-4 | لا دورة حياة للوسائط: `.montage_ai/uploads` و`exports` و`pipeline` تنمو بلا تنظيف؛ كل نقرة «تحليل» قد تعيد رفع الفيديو. | Verified (قراءة) |
| A-5 | `fluent-ffmpeg` مدرج كتبعية لكنه **غير مستخدم** (كل الاستدعاءات `spawn` مباشر) — والحزمة مؤرشفة upstream. | Verified (grep) |
| A-6 | CrewAI/litellm في `requirements.txt` لكنها غير مثبّتة هنا؛ المسار يتدهور بأناقة (W-1). | Verified |
| A-7 | `vitest` يغطي `lib/**` فقط؛ لا اختبارات لمسارات API ولا لبناء أوامر FFmpeg في TS. | Verified |

---

## 5. MCP — الوضع الحالي

| البند | التصنيف |
|-------|---------|
| خادم MCP (أي نقل: stdio / Streamable HTTP) | **Not implemented** — لا تبعية `@modelcontextprotocol/*` ولا شيفرة MCP في المستودع |
| أدوات مكتوبة الأنواع للمشاريع/الوسائط/التايملاين/الرندر | Not implemented |
| حالة مشروع على الخادم يمكن لوكيل خارجي تعديلها | Not implemented (A-1) |
| موافقة المستخدم على العمليات المكلفة/المدمِّرة | Not implemented (الاستثناء: مسار Python «خطة ثم تأكيد ثم رندر» في الواجهة) |
| سجل عمليات وتراجع | Not implemented (B-7) |
| حدود نظام الملفات لمساحة العمل | جزئي: `isPathInside` موجود ومستخدم في التصدير/التنزيل فقط |

---

## 6. أوامر قابلة لإعادة الإنتاج

```bash
# خط الأساس
pnpm install --frozen-lockfile
npx tsc --noEmit && npm test && node scripts/check-contract.ts
python -m compileall -q src/ && python -m pytest -v
npx next lint && npm run build

# مسار Python الكامل بلا مفاتيح (رندر حقيقي + مراجعة)
python -m src.main test_assets/test_video.mp4 --demo --no-broll

# B-1: normalize_plan يُسقط الإبقاء
python -c "from src.agents.edl_schema import normalize_plan, EdlSource as S; \
p=normalize_plan({'source':{'path':'x','duration':10},'segments':[{'start':0,'end':5,'keep':False},{'start':3,'end':10,'keep':True}]},S(path='x',duration=10)); \
print([(s.start,s.end,s.keep) for s in p.segments])"      # → [(0.0, 10.0, False)]

# S-1: مسار الإخراج يهرب من مجلد التصدير
node -e "console.log(require('path').join('/r/.montage_ai/exports','job_1.'+'/../../../../tmp/pwned'))"   # → /tmp/pwned

# B-10: مهارة على الخادم تُرجع بيانات عشوائية كنجاح (داخل Vitest)
#   getSkillManager().runSkill("SilenceDetectionSkill",{duration:30,filePath:"/nonexistent"}) → ok:true + فترات عشوائية
```

---

## 7. مهام الإصلاح مرتّبة بالأولوية (مع معايير القبول)

| الأولوية | المهمة | معيار القبول |
|----------|--------|--------------|
| P0 | S-1/S-2: تحقق مخطط المشروع في `/api/export` (enum للصيغة/الدقة/fps/الجودة/النسبة + حدود أرقام) | قيمة `format` خارج القائمة → 400؛ اختبار وحدة لا يكتب خارج `EXPORT_DIR` |
| P0 | B-1: إصلاح دمج CUT→KEEP في `normalize_plan` | حالة الاختبار أعلاه تُبقي `[3,10]` KEEP؛ pytest جديد |
| P0 | S-3: حصر `/api/ai/silence` في مجلد الرفع | مسار خارج `.montage_ai/uploads` لا يُفحص |
| P0 | S-4: حارس Host/Origin للـ API المحلي | طلب بـ `Origin: https://evil.example` أو `Host` غير محلي → 403؛ الطلبات المحلية تمر |
| P1 | B-8/A-3: مهلة + إلغاء لعملية التصدير، واستطلاع محدود في الواجهة | `DELETE`/إلغاء يقتل ffmpeg ويضع الحالة `cancelled`؛ اختبار |
| P1 | B-10/2.2: وسم النتائج المحاكاة `simulated:true` + تحذير عربي | كل fallback عشوائي يحمل الوسم؛ الواجهة تعرضه |
| P1 | S-6: `guardCost`/`recordSpend` حول كل استدعاء مدفوع | grep: كل مسار به `fetch` لمزوّد مدفوع يستدعي `guardCost` |
| P1 | B-9: `dynamic = "force-dynamic"` لـ `/api/budget` | البناء يعرضه `ƒ` |
| P1 | MCP: خادم stdio رسمي + محرّك مشروع على الخادم (مخطط، تخزين ذري، عمليات تايملاين نقية، تراجع، تحليل وسائط حقيقي، رندر/مراجعة، موافقة) | اكتشاف الأدوات واستدعاؤها عبر عميل MCP حقيقي في الاختبار؛ E2E بالفيديو العيّنة مع ffprobe |
| P1 | A-1: جسر EDL ↔ مشروع (تطبيق خطة Python على التايملاين بعد موافقة) | خطة `--plan-only` تتحول لمقاطع قابلة للتراجع |
| P2 | B-2/B-3/B-5/B-6/B-7: إصلاح التايملاين (مواضع، تصفية المسارات، تقسيم/حذف، Undo/Redo) | اختبارات المختزل + فحص بصري |
| P2 | B-12/B-13: نسخة مخطط + تحقق عند التحميل/الاستيراد + معالجة الحصة | ملف مشروع تالف → رسالة واضحة؛ تجاوز الحصة → إشعار |
| P2 | B-4: تضمين الصوت الإضافي في التصدير عند وجود ملف على الخادم، وإلا تحذير صريح | المخرَج يحوي مزيجاً أو يعيد تحذيراً |
| P3 | S-10: هجرة Next 15 (منفصلة، مع اختبار بصري كامل) | `pnpm audit --prod` بلا critical |
| P3 | A-4: تنظيف دوري للملفات المؤقتة والمرفوعات القديمة | أداة تنظيف + توثيق |
| P3 | A-5: إزالة `fluent-ffmpeg` غير المستخدم | `grep` فارغ + بناء ناجح |
