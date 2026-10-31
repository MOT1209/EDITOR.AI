# منصة المهارات القابلة للتوسعة (المرحلة 5)

> **الخلاصة:** المنصة موجودة ومُختبرة منذ مرحلة الإضافات (`lib/extensions/*`، `/extensions`، `docs/EXTENSIONS.md`).
> هذه المرحلة **لم تعِد بناءها** بل أغلقت فجواتها المثبتة أدناه. المرجع التفصيلي لصيغة الحزمة: `docs/EXTENSIONS.md`.

## 1) مطابقة المطلوب ↔ الموجود (قبل أي إضافة)

| المطلوب | الحال قبل المرحلة | ما فُعل |
|---|---|---|
| مدير مهارات: مثبّتة / إنشاء / استيراد / تصدير / تعديل / تفعيل-تعطيل / حذف / إصدارات / سجل تنفيذ / صلاحيات | ✅ موجود (`ExtensionsManager`, `DetailPanel`, `Editor`, `Tester`) | لا تغيير |
| **تحديث** | ◐ إصدار جديد يدوي (PUT/استيراد `update`) | + تحديث من الفهرس بنقرة (إصدار أعلى فقط) |
| **سوق/اكتشاف** | ❌ | + تبويب «اكتشاف» + `/api/extensions/catalog` (محلي، انظر القسم 5) |
| مواصفة: id/name/description/version/author/input/output/permissions/dependencies/execution/compat | ✅ | لا تغيير |
| مواصفة: **required capabilities** | ❌ (الصلاحيات ≠ قدرات المضيف) | + حقل `capabilities` + فحص خادم (`capabilities.ts`) |
| فئات مدمجة (8) | ◐ 7 فئات داخلية، **لا ضبط جودة** | + `QualityControlSkill` + `lib/skills/domains.ts` + إجراءان (`render.review`, `timeline.preflight`) + 3 حزم أمثلة |
| فرض الصلاحيات على الخادم | ✅ (`checkGrants` + منح المالك + موافقات) | + اختبار قبول عبر HTTP |
| تكامل الحزم المستوردة | ⚠️ **ثغرة**: البصمة الواردة كانت تُعاد وتُختم قبل الفحص فتمرّ حزمة معدّلة | أُصلح: تُتحقق أولاً (استيراد/فهرس) |

## 2) المواصفة (نسخة 1) — مطابقة الحقول المطلوبة

| حقل المطلوب | حقل البيان | ملاحظات |
|---|---|---|
| Unique ID | `id` | `^[a-z][a-z0-9_]{2,47}$`، اسم التشغيل `ext_<id>` |
| Name / Description | `name` / `description` | |
| Version | `version` | semver؛ الإصدارات المحفوظة غير قابلة للتعديل |
| Author | `author` (+ `license`) | |
| Input / Output schema | `input` / `output` | مجموعة JSON Schema محدودة وآمنة، التحقق صارم |
| Required capabilities | `capabilities` | `ffmpeg` \| `python` \| `ai.chat` \| `workspace` |
| Required permissions | `permissions` | `project.read/write`، `render.export`، `media.read`، `skills.run`، `ai.invoke`، `exec.external` |
| Dependencies | `dependencies.{skills,actions,native}` | المفقود = خطأ تحقق |
| Execution configuration | `execution` + `config` + `limits` | `prompt` \| `workflow` \| `native` \| `external` (مهارات)؛ `declarative` \| `executable` (أدوات) |
| Compatibility | `compat.{formatVersion, montage}` | نطاق semver لإصدار المنصة؛ غير المتوافق يُرفض حفظاً وتفعيلاً |

أمثلة عاملة ومُختبرة آلياً (`lib/extensions/examples.test.ts`): `examples/extensions/` — `text-stats.skill`، `viral-scan.skill` (مسار مركّب)،
`tagline_prompt/` (تعليمات نموذج)، `silence-report.tool`، `export-video.tool`، **و`qc-preflight.skill`، `render-preflight.tool`، `render-review.tool` (ضبط جودة)**.

## 3) مكوّنات التشغيل (Runtime) وأين تُفرض

| المكوّن | الملف | الدور |
|---|---|---|
| Registry | `store.ts` + `skills-bridge.ts` | حالة دائمة (حزم/إصدارات/منح/سجل) وإدراج المهارات في `SkillManager` باسم `ext_*` |
| Validator | `validate.ts` + `manifest.ts` + `schema.ts` | بنية، توافقية، تكامل، تبعيات، وسائط الإجراءات، قدرات/صلاحيات |
| Dispatcher | `runtime.ts` (`executeSkill`/`invokeTool`) + `mcp/custom-tools.ts` | يوجّه إلى سجل الإجراءات/سير العمل/المدخل الأصلي/الخارجي |
| Dependency resolver | `validate.ts` | مهارات مدمجة، إجراءات، مدخلات أصلية (مفقود = رفض) |
| Permission enforcement | `runtime.checkGrants` + `service.grantPermissions/setEnabled` + `lib/server/approvals.ts` | الإعلان لا يكفي؛ المنح من المالك؛ المكلف/الكاتب/الخارجي بموافقة؛ **كل ذلك في الخادم** |
| Capability enforcement | `capabilities.ts` + `runtime.assertCapabilities` | القدرة المفقودة ⇒ `DEPENDENCY_MISSING` + حالة «غير متاح» |
| Execution lifecycle | `service.runExtension` | معطّل/اختبار/تشغيل → تنفيذ بمهلة/حد مخرجات/تزامن → سجل تشغيل (نتيجة، مدة، مصدر) |
| Error reporting | `ExecResult.error{code,message}` + `runs` | رموز موحّدة؛ فشل المنفِّذ يُعاد 200 مع `ok:false` ليعرضه المختبر |
| Version compat | `semver.ts` + `compat` | يُفحص عند الحفظ والتفعيل وتبديل الإصدار |

**العزل:** الحزمة **بيانات** لا شيفرة؛ لا شيء مستورد يُنفَّذ داخل عملية التطبيق. التنفيذ القابل للتشغيل الخارجي (`external/executable`) معطّل افتراضياً،
ويتطلب قائمة سماح يتحكم بها المالك + موافقة عند كل تشغيل + عملية فرعية معزولة (`sandbox.ts`: `unshare`/`bwrap` إن توفّرا — راجع التدقيق SEC-08 لحدود العزل).

## 4) مقارنة المهارات المدمجة بالمجالات الثمانية (قبل إنشاء أي جديد)

المرجع الرسمي في `lib/skills/domains.ts` (اختبار آلي: كل مجال فيه ≥1 مهارة مسجّلة، وكل مهارة مدمجة في مجال واحد بالضبط).

| المجال | مهارات موجودة | القرار |
|---|---|---|
| تحليل الفيديو | Scene/Shot/Face/Object/Highlight/ViralMoment/PersonTracking/FaceTracking | **مغطى** — لم يُنشأ جديد |
| مونتاج الفيديو | AutoCut/SmartTrim/AutoReframe/AutoZoom/SpeedRamp/Shorts/BRoll | **مغطى** |
| معالجة الصوت | AudioEnhancement/NoiseReduction/SilenceDetection/MusicDucking/BeatDetection/AutoMusicSync/SoundEffects/TTS/VoiceCloning | **مغطى** |
| الترجمات | AutoCaption/SubtitleTranslation/SpeechRecognition/TextOverlay | **مغطى** |
| المؤثرات البصرية | TransitionEffect/BackgroundRemoval/VideoStabilization/Upscale | **مغطى** |
| تصحيح الألوان | AutoColorGrading/ColorCorrection | **مغطى** |
| تحسين التصدير | ExportOptimization | **مغطى** (إعدادات جاهزة فعلية في `lib/engine/export-presets.ts`) |
| **ضبط الجودة** | — (المنطق موجود في `reviewRender` لكنه غير مكشوف كمهارة) | **فجوة ⇒ أُضيف** `QualityControlSkill` (حساب حتمي على المستند، يوسم ما لا يستطيع فحصه `skipped`) + إجراءا `render.review`/`timeline.preflight` للأدوات والمهارات المخصّصة |

> **صدق المصدر:** معظم المهارات المدمجة استدلالية (`simulated`) بلا مفتاح/تحليل مسبق — المنصة توسمها ولا تعرضها كتحليل حقيقي (`lib/skills/provenance.ts`).
> الحقيقية فعلاً: ما يستند إلى إجراءات المحرّك (`analysis.*`, `media.probe`, `render.review`, `timeline.preflight`).

## 5) غير مدعوم عمداً (موثّق لا مُحاكى)
- **سوق بعيد/تنزيل حزم من الإنترنت وتحديث تلقائي في الخلفية:** غير موجود. الفهرس محلي؛ التحديث إجراء يدوي من المالك. السبب: كل حزمة بيانات قد تحمل تعليمات لنموذج أو سير عمل؛ تنزيلها دون مراجعة توسّع سطح الهجوم. (التوقيع `signing.ts` + `MONTAGE_EXT_REQUIRE_SIGNED` جاهزان لمتجر موقّع مستقبلاً.)
- **تنفيذ شيفرة مستوردة (JS/Python) داخل التطبيق:** ممنوع. المسار الوحيد: مدخل أصلي مسجَّل في كود التطبيق، أو برنامج خارجي في قائمة سماح المالك بعزل عملية فرعية.
- **حل تبعيات بين إضافات مخصّصة** (إضافة تعتمد إضافة): غير مدعوم؛ التبعيات على المدمج/الإجراءات/المدخلات الأصلية فقط.
- **تحديث يفعّل نفسه:** إضافة مفعّلة تبقى على إصدارها المختبَر عند حفظ إصدار أعلى؛ تفعيل الجديد صريح (`activate`) ويعطّلها ويُلغي الاختبار ويُسقط المنح التي لم يعد البيان يعلنها (قرار أمني).
- **قدرات مستقبلية** (`gpu`, `network`): غير معرّفة؛ الشبكة غير متاحة لأي إجراء أصلاً.
