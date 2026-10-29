# معمارية MCP والمحرّك — EDITOR.AI (MontageAI)

> الإعداد والتشغيل: [`docs/MCP_SETUP.md`](../MCP_SETUP.md) · الفحص: [`docs/audit/EDITOR_AI_AUDIT.md`](../audit/EDITOR_AI_AUDIT.md)

## 1. الصورة الكاملة

```
                ┌───────────────────────── جهاز المستخدم ─────────────────────────┐
  عميل MCP ──stdio──▶ mcp/stdio.ts ─▶ mcp/server.ts (37 أداة، Zod، موافقة، تدقيق)
 (Claude/Cursor)                         │
                                         ▼
  المتصفح ──HTTP──▶ Next.js /api/*  ─▶  lib/engine/*  ◀── المصدر الوحيد لمنطق التعديل
  (Editor.tsx)      (middleware:          ├─ project-schema.ts  مخطط+نسخة+حدود (zod)
     │              Host/Origin)          ├─ timeline.ts        عمليات نقية (split/trim/move/...)
     │                                    ├─ store.ts           مساحة العمل: ذرية + قفل + undo/redo
     └─ reducer (state.ts) يستخدم         ├─ media.ts           ffprobe/silence/scene/beats/review
        نفس timeline.ts + تراجع محلي      ├─ jobs.ts            رندر: حالة دائمة/إلغاء/مهلة/تحقق
                                          ├─ plans.ts           جسر مسار وكلاء Python (EDL)
                                          └─ process.ts         تشغيل آمن (argv، مهلة، إلغاء، سقف)
                                                   │
                       lib/server/ffmpeg-export.ts ┤ buildExportPlan (نقي) + runExport
                                                   │
                         src/agents (Python) ◀─────┘ python -m src.main --plan-only
                   CEO→Analyst→Director→Critic→Audio(→Render)
```

## 2. القرارات وأسبابها

| القرار | السبب | البديل المرفوض |
|--------|-------|----------------|
| **SDK الرسمي** `@modelcontextprotocol/sdk@1.32.1` + `zod@4.6.7` | المعيار، مخططات JSON تلقائية، elicitation، تحقق مخرجات. zod 4.6.7 بدل 3.x لأن `zod<4.6.6` عليه ثغرة high (استنزاف ذاكرة). | تنفيذ JSON-RPC يدوي |
| **stdio فقط** | نموذج النشر محلي؛ لا مصادقة في التطبيق؛ stdio لا يفتح منفذاً. | Streamable HTTP بلا مصادقة (خطر) |
| **محرّك مشترك `lib/engine`** | MCP والواجهة يطبّقان نفس الدوال على نفس `ProjectState`، والتصدير يقرأ نفس الخطة ⇒ لا انحراف. | منطق مكرر في Editor.tsx وفي MCP |
| **تايملاين مغناطيسي** | خطة التصدير القائمة (`buildSegments`) تلصق المقاطع بترتيب `start` بلا فجوات؛ جعلنا هذا صريحاً: كل عملية تعيد الترصيف. | مواضع حرة تتجاهلها خطة التصدير صامتة |
| **مساحة عمل على الخادم** بجانب `localStorage` | وكيل خارجي يحتاج حالة يقرأها ويكتبها؛ الوسائط تُنسخ داخل المشروع فيملكها. | تعديل `localStorage` من الخادم (مستحيل) |
| **`tsx`** لتشغيل الخادم | يحترم `tsconfig` (alias `@/`) بلا خطوة بناء؛ يعيد استخدام شيفرة `lib/` كما هي. | حزمة مُجمّعة منفصلة |
| **لا إطار وكلاء ثانٍ** | MCP يغلّف مسار Python الموجود (CrewAI اختياري) ومهارات `lib/skills`. | LangChain/وكلاء TS جدد |

## 3. نموذج البيانات

- `ProjectState` (في `lib/types.ts`) هو العقد الوحيد. أُضيف حقلان اختياريان:
  `assets?: MediaAsset[]` (وسائط مساحة العمل، `url` نسبي داخل مجلد المشروع) و`schemaVersion?`.
- `project-schema.ts`: نسخة المخطط **2**؛ مشاريع v1 (بلا رقم) تُرقّى (مصفوفات مفقودة ⇒ فارغة).
  الحقول غير المعروفة في المقاطع تُحفظ (`looseObject`) لأن المحرّر يستخدم مثلاً `_removed`.
- المدة على التايملاين لمقطع = `(outPoint − inPoint) / speed`. الترجمات والنصوص بزمن التايملاين.
- `project.effects` تُطبَّق في التصدير على كل المقاطع؛ `clip.colorFilter` لكل مقطع؛
  `clip.effects` **للعرض فقط** (لا يقرؤه التصدير) — موثّق في `timeline.ts`.
- مقاطع الصور (B-roll) تراكب بزمن مطلق على المسار ولا تدخل الترصيف.

## 4. التخزين ودورة حياة الوسائط

```
<MONTAGE_WORKSPACE>/
  projects/<p_id>/project.json     (tmp+rename ذري، تحقق مخطط عند كل قراءة/كتابة)
  projects/<p_id>/history.json     (undo/redo — حتى 50 لقطة كاملة)
  projects/<p_id>/media/<asset><ext>   (نسخة من الملف المستورد — المشروع يملكها)
  projects/<p_id>/renders/<r_id>/{status.json, output.*}   (لكل مهمة مجلدها — لا كتابة فوق مخرَج آخر)
  projects/<p_id>/plans/<plan_id>.json (+ _work/ أدلة مسار Python)
  audit.log                        (JSONL)
  inbox/                           (جذر استيراد افتراضي)
```

| أين | ماذا يبقى | ما يغادر الجهاز |
|-----|-----------|-----------------|
| المتصفح (`localStorage`) | بيانات المشروع فقط (تايملاين، ترجمات، إعدادات) + صورة مصغرة ≤150KB. **الفيديو لا يُحفظ** — يُعاد ربطه عند الفتح (نفس المدة ⇒ تُحفظ التعديلات). | لا شيء |
| خادم Next المحلي | `.montage_ai/uploads` (كل فيديو يُرفع للتحليل/التصدير)، `exports`، `pipeline`. | لا شيء (الخادم على جهازك) |
| مساحة عمل MCP | كما أعلاه. | لا شيء |
| مزوّد LLM (اختياري، بمفتاحك) | — | صوت مستخرج (Whisper)، إطارات (رؤية)، نص (ترجمة/خطة) — فقط عند ضبط مفتاح، وعبر `guardCost`. من MCP: فقط مع `allowPaidProviders=true` + موافقة. |

**التنظيف:** حذف المشروع = حذف مجلده. مجلد `uploads` القديم لا يُنظَّف آلياً بعد (قيد معروف).

## 5. الأمن

| التهديد | الحماية | الاختبار |
|---------|---------|----------|
| تنفيذ أوامر/وسائط ffmpeg من الوكيل | لا أداة تقبل وسائط ffmpeg؛ كل الأوامر من `buildExportPlan`/`media.ts` بمصفوفة argv (لا shell)؛ القيم من مشروع متحقَّق منه (enum/حدود). | `ffmpeg-export.test.ts` |
| Path traversal | المعرّفات `^[A-Za-z0-9_-]{1,80}$`؛ `isPathInside` لكل مسار مشتق؛ مسار الأصل يُحل من السجل لا من العميل. | `server.test.ts` («رفض معرّفات بمسار») |
| قراءة ملفات خارج المسموح | الاستيراد: فحص لفظي **قبل** أي stat (لا كشف وجود ملفات)، ثم `realpath` (روابط رمزية)، امتداد، حجم، ffprobe. | traversal + symlink + `/etc/passwd` |
| تسريب أسرار | مفاتيح المزوّد تُزال من بيئة Python افتراضياً؛ لا مسارات مطلقة في المخرجات (`outputPath` نسبي)؛ رسائل ffprobe منقّاة من المسارات. | «لا مسارات مطلقة» |
| استنزاف الموارد | مهلة لكل عملية، سقف مخرجات stdout، حد مهام متزامنة (2)، مهمة تصدير واحدة لكل مشروع، معاينة ≤60s، حدود المخطط (500 مقطع...). | — |
| CSRF / DNS rebinding على `localhost:3000` | `middleware.ts` + `host-guard.ts`: Host مسموح فقط + Origin مطابق. | `host-guard.test.ts` + curl حي (403) |
| عمليات مكلفة/مدمّرة بلا علم المستخدم | `requireApproval` (elicitation)؛ رفض افتراضي لعميل بلا دعم. | «refuses ... without elicitation» |
| SSRF عبر المهارات | `/api/skills` و`run_skill` يحذفان `apiBaseUrl`/`endpoint` من الإعدادات؛ مدير مهارات معزول لكل طلب. | — |

**غير مُنفَّذ:** عزل حاوية/sandbox لعمليات ffmpeg على وسائط غير موثوقة (العملية تعمل بصلاحيات
المستخدم). للوسائط من مصادر غير موثوقة شغّل الخادم تحت مستخدم محدود الصلاحيات.

## 6. الوكلاء والتايملاين (من الخطة إلى المخرَج)

1. `create_editing_plan` ⇒ `python -m src.main <media> --plan-only --no-broll` (Analyst يفحص المصدر
   فعلياً بـ ffprobe/silencedetect؛ Director يبني EDL؛ Critic وAudio يراجعان). النتيجة تُحفظ
   **ولا تغيّر المشروع**. بلا مفتاح: لا تفريغ صوتي (الترجمات فارغة) — يُعلن كتحذير.
2. `review_editing_plan` ⇒ نظير `validate_plan`: حدود، تداخل، وجود إبقاء، تطابق مدة المصدر،
   وملخص: المدة قبل/بعد، الثواني المحذوفة، عدد المقاطع/الترجمات، وما سيُتجاهل (crop/zoompan).
3. `apply_editing_plan` (موافقة) ⇒ مقاطع الإبقاء ⇒ مقاطع تايملاين، الترجمات/النصوص تُحوَّل من
   زمن المصدر إلى زمن التايملاين (`sourceToTimeline`)؛ عملية واحدة قابلة للتراجع؛ لا تُطبَّق مرتين.
4. `generate_preview` / `export_project` ⇒ `runExport` ثم `reviewRender` (ffprobe + أبعاد + مدة ±50%
   + blackdetect + volumedetect). الحالة `completed` **فقط** بعد نجاح المراجعة؛ وإلا `failed_validation`.

**الفجوة المعروفة:** وكيل Render في Python له خط رندر خاص (zoompan 9:16، ASS كلمة-بكلمة) لا يمر عبر
مشروع التايملاين؛ مسار MCP يرندر من التايملاين عبر `ffmpeg-export.ts`. الـ crop الذكي لا يُمثَّل في
`ProjectState` بعد ويُعلن كـ «ignoredFeatures» في المراجعة.

## 7. المهارات (`lib/skills`)

`run_skill`/`run_workflow` يبنيان المستند من المشروع (المدة الحقيقية؛ ومع `useRealAnalysis` صمتاً
ومشاهد حقيقية من FFmpeg)، ويعيدان `provenance` لكل خطوة:
`real-analysis` (تحليل حقيقي)، `computed` (حساب حتمي على المدخلات)، `simulated` (بديل استدلالي/عشوائي).
المهارات **لا تعدّل المشروع** — التعديل عبر أدوات التايملاين أو الخطط.

## 8. المعاينة في المحرّر

المشغّل يشغّل المصدر لكنه يتبع خطة التصدير: `timelineToSource` عند التحريك، وعند بلوغ
`clipSourceEnd` يقفز لـ `inPoint` المقطع التالي مع سرعته وصوته. المؤشر وطول التايملاين بزمن المخرَج.
تحقق بصري (Playwright): التشغيل من 9.45s تجاوز المصدر 10→18 ووصل 19.31s (= 11.31s تايملاين).

## 9. الأدوات والمهارات المخصّصة (الإضافات)

- **سجل دائم** `lib/extensions/store.ts` تحت `<workspace>/extensions/` (حزم بإصدارات غير قابلة للتعديل + حالة + منح + سجل تنفيذ).
- **المرسِل** `lib/extensions/runtime.ts` (`invokeTool`/`executeSkill`): مدخلات صارمة ← صلاحيات (معلنة ∩ ممنوحة) ← موافقة بحسب خطورة الإجراء ← مهلة ← تحقق مخرجات ← provenance صادق.
- **الحد الأمني** `lib/extensions/actions.ts`: سجل إجراءات معتمد؛ الأداة الإعلانية لا تنفّذ إلا إجراءً مسجّلاً بمخطط وصلاحيات وخطورة. التنفيذ الخارجي: قائمة سماح المالك خارج مساحة العمل، معطّل افتراضياً.
- **ربط MCP** `mcp/custom-tools.ts`: `server.registerTool/remove` ديناميكياً (SDK يرسل `tools/list_changed`)، فحص دوري لـ `rev.json`، إعادة تحقق عند كل استدعاء، سجل تعرّض فعلي `mcp-exposure.json`.
- **المهارات** تُسجَّل كـ `BaseSkill` (`DynamicSkill`) في `SkillManager` الحالي باسم `ext_<id>` — لا إطار ثانٍ.
- قرارات: بادئة `ext_` بدل كشف الاسم الحر (منع التصادم بنيوياً)؛ `objectToZod` صارم (SDK يُسقط الحقول الزائدة بصمت لو مُرّر raw shape — اكتُشف في E2E)؛ لا نقطة MCP بعيدة.

