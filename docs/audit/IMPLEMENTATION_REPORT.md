# تقرير التنفيذ — EDITOR.AI (MontageAI)

> الفرع: `ccr-c3a3df8d-fho3s5` · الأساس: `d8c5436` · التاريخ: 2026-10-29
> الحالة قبل العمل: [`EDITOR_AI_AUDIT.md`](EDITOR_AI_AUDIT.md) · المعمارية: [`../architecture/MCP_ARCHITECTURE.md`](../architecture/MCP_ARCHITECTURE.md) · الإعداد: [`../MCP_SETUP.md`](../MCP_SETUP.md)

**الخلاصة الصادقة:** المشروع أصبح محرّراً محلياً يمكن لوكلاء MCP تشغيله على حالة مشروع حقيقية
مع تحقق فعلي من المخرَج، والاختبارات (بما فيها E2E بـ FFmpeg حقيقي) تنجح في هذه البيئة.
**ليس جاهزاً للإنتاج كخدمة مستضافة**: لا مصادقة، `next@14` عليه ثغرات معروفة، ولا عزل لعمليات
FFmpeg — انظر القسم 7.

## 1. النتائج الأصلية (ملخص — التفاصيل في تقرير الفحص)

| # | النتيجة | الحالة الآن |
|---|---------|-------------|
| S-1 | Path traversal في اسم ملف التصدير (`format` → `/tmp/pwned`) | ✅ مُصلح — تحقق مخطط؛ اختُبر حياً عبر HTTP (400، لا ملف) + اختبار وحدة |
| S-2 | `/api/export` بلا تحقق بنية المشروع | ✅ `parseProject` (enum + حدود) |
| S-3 | `/api/ai/silence` يفحص أي ملف على القرص | ✅ محصور في uploads/مساحة العمل |
| S-4 | لا حماية CSRF/DNS-rebinding للخادم المحلي | ✅ `middleware.ts` (403 حياً لـ Origin/Host غريب) |
| S-5 | رفع بلا تحقق، كشف المسار المطلق | ✅ تحقق + ffprobe + حذف غير الصالح؛ لا مسارات في GET/رسائل الخطأ |
| S-6 | استدعاءات مدفوعة بلا `guardCost` (7 مسارات) | ✅ كلها محمية + أُزيلت استدعاءات المتصفح المباشرة للمزوّد |
| S-7 | `/api/skills` يلوّث مهارات مشتركة + SSRF عبر `apiBaseUrl` | ✅ مدير معزول + إعدادات منقّاة |
| S-9 | تحميل فيديو المسار كاملاً للذاكرة | ✅ بث |
| S-10 | ثغرات `next@14` | ⏳ موثّق، لم يُرقَّ (هجرة كبرى) |
| B-1 | `normalize_plan` يُسقط الإبقاء | ✅ + 4 اختبارات pytest |
| B-2 | مقاطع المشاهد تُصدِّر لقطات خاطئة | ✅ مسار علامات fx بنطاقات حقيقية |
| B-3 | مواضع مقاطع إزالة الصمت وهمية | ✅ تتابع حقيقي |
| B-4 | الصوت الإضافي لا يدخل التصدير | ◐ يُمزج للأصول على الخادم (MCP)؛ صوت المتصفح `blob:` ⇒ تحذير صريح |
| B-5/B-6/B-7 | المسارات ترسم كل المقاطع؛ أزرار قص/تقسيم ميتة؛ لا تراجع | ✅ تصفية بالمسار، تقسيم/حذف فعليان، تراجع/إعادة + اختصارات |
| B-8 | استطلاع تصدير لا ينتهي، لا إلغاء/مهلة | ✅ استطلاع محدود، `DELETE /api/export`، مهلة + حذف الجزئي |
| B-9 | `/api/budget` ثابت | ✅ `ƒ` في البناء |
| B-10/B-11 | مهارات الخادم تُرجع عشوائياً كنجاح | ✅ `provenance` (real-analysis/computed/simulated) + تحليل حقيقي مسبق |
| B-12/B-13 | لا تحقق/نسخة/حصة/إعادة ربط في localStorage | ✅ مخطط v2 + ترقية + حصة + إعادة ربط بالمدة |
| 2.2 | نتائج محاكاة غير موسومة | ✅ `simulated:true` + `warning` (الواجهة تعرضه آلياً) أو نتيجة فارغة |
| A-5 | `fluent-ffmpeg` غير مستخدم | ✅ أُزيل |
| — | لا MCP إطلاقاً | ✅ خادم stdio رسمي، 37 أداة |
| — | **جديد اكتُشف أثناء العمل**: preview المحرّر يشغّل المصدر الخام (يعرض المقطوع) | ✅ المشغّل يتبع خطة التصدير |
| — | **جديد**: كشف BPM يقع في خطأ الأوكتاف | ✅ تنعيم الغلاف + أقصر تأخير قِمّي (90/120/150 BPM مختبرة) |
| — | **جديد**: نتائج أخطاء MCP تُرفض من العملاء (structuredContent مقابل مخطط النجاح) | ✅ اكتُشف بـ E2E عبر stdio وأُصلح + اختبار انحدار |

## 2. التغييرات حسب المرحلة

| المرحلة | الالتزام | المحتوى |
|---------|----------|---------|
| أ — الفحص | `8583512` | `docs/audit/EDITOR_AI_AUDIT.md` + خط الأساس + إعادة إنتاج الأعطال |
| ب/ج/د — المحرّك وMCP | `291b2f2` | `lib/engine/*`، `mcp/*`، إعادة هيكلة `ffmpeg-export.ts` (باني نقي، إلغاء، مهلة، نافذة، مزج صوت)، إصلاح `normalize_plan`، إصلاح المهارات، 52 اختباراً |
| ب/هـ — الـ API والمحرّر | `2682568` | الحارس، تحقق/إلغاء التصدير، الرفع، الوسم/الكلفة، المعاينة التابعة للتايملاين، تراجع/إعادة، تقسيم/حذف، التخزين، مساحة العمل في الواجهة |
| و — E2E والتوثيق | (هذا الالتزام) | `scripts/mcp-e2e.ts`، إصلاح أخطاء MCP، CI (pnpm + FFmpeg + E2E + build)، إزالة `fluent-ffmpeg`، التوثيق |

## 3. أدوات MCP المنفّذة فعلياً (37)

- **المشاريع (4):** `list_projects`، `get_project`، `create_project`، `get_project_status`
- **الوسائط (6):** `import_media`، `list_media_assets`، `inspect_media` (يغطي `get_media_metadata`)، `analyze_scenes`، `detect_silence`، `detect_beats`
- **التايملاين (15):** `get_timeline`، `list_tracks`، `list_clips`، `split_clip`، `trim_clip`، `move_clip`، `delete_clip`، `set_clip_volume`، `add_text_overlay`، `add_captions`، `apply_effect`، `add_audio_clip`، `undo_edit`، `redo_edit`، `list_edit_history`
- **المهارات والوكلاء (7):** `list_skills`، `run_skill`، `list_workflows`، `run_workflow`، `create_editing_plan`، `review_editing_plan`، `apply_editing_plan`
- **المعاينة والتصدير (5):** `generate_preview`، `get_render_status`، `cancel_render`، `validate_render`، `export_project`

كلها تعمل على حالة حقيقية (مساحة العمل + FFmpeg + مسار Python)؛ لا أداة تعيد نجاحاً مُختلقاً.
الجدول الكامل بالمدخلات مولّد من الخادم في `docs/MCP_SETUP.md`.

## 4. حالة تكامل الوكلاء والتايملاين

| المتطلب | الحالة | الدليل |
|---------|--------|--------|
| فحص الوسيط الحقيقي | ✅ Verified | `inspect_media`/`detect_*`/Analyst (ffprobe + silencedetect) |
| خطة مُتحقَّق منها | ✅ Verified | `create_editing_plan` + `review_editing_plan` (اختبار تكامل) |
| عرض الخطة والتغييرات المتوقعة | ✅ Verified | `expectedChanges` (المدة قبل/بعد، المحذوف، المقاطع، الترجمات، المتجاهَل) |
| موافقة قبل التغيير المهم | ✅ Verified | elicitation؛ رفض عميل بلا دعم؛ رفض المستخدم لا يغيّر شيئاً (اختبارات) |
| تطبيق على التايملاين الفعلي | ✅ Verified | `apply_editing_plan` ⇒ مقاطع/ترجمات، قابل للتراجع، لا يُطبَّق مرتين |
| رندر بالمحرّك القائم | ✅ Verified | `runExport` (نفس مسار الواجهة) |
| فحص المخرَج بـ FFprobe + مراجعة | ✅ Verified | `reviewRender` + ffprobe مستقل في E2E |
| تقرير النتائج والتحذيرات والفشل | ✅ Verified | `failed`/`failed_validation`/`cancelled` مختبرة؛ مصدر محذوف ⇒ `failed` لا نجاح |
| الخطة ≠ تعديل منجز | ✅ | `create_editing_plan` لا يغيّر المشروع (مختبر بمساواة التايملاين قبل/بعد) |
| وضع demo معلَن | ✅ | MCP لا يستخدم `--demo` إطلاقاً؛ الخطة المحلية تعلن «لا تفريغ حقيقي» |
| crop ذكي 9:16 من الخطة | ❌ Not implemented | غير ممثل في `ProjectState`؛ يُعلن في `ignoredFeatures` |
| خطة الصوت (موسيقى/Ducking) من Python | ❌ Not implemented | مواصفة فقط (موروث) |
| Render agent في Python عبر MCP | ◐ Partially | MCP يرندر من التايملاين؛ مسار Python الكامل يبقى متاحاً من الواجهة/CLI |

## 5. الأوامر المنفّذة ونتائجها الفعلية (التشغيل النهائي)

| الأمر | النتيجة |
|-------|---------|
| `pnpm install --frozen-lockfile` | ✅ exit 0 |
| `npx tsc --noEmit` | ✅ 0 أخطاء |
| `pnpm lint` | ✅ No ESLint warnings or errors |
| `pnpm test` (Vitest) | ✅ **81/81** في 9 ملفات، **0 skipped** (كان 17) |
| `node scripts/check-contract.ts` | ✅ 60 فحصاً، 0 أخطاء |
| `python -m compileall -q src/` | ✅ |
| `python -m pytest -v` | ✅ **36/36** (كان 32) |
| `pnpm mcp:e2e` | ✅ 20/20 فحصاً |
| `npm run build` | ✅ (`/api/budget` و`/api/projects*` ديناميكية، Middleware 26.9kB) |
| `pnpm audit --prod` | ⚠️ 33 (نفس خط الأساس — لم تُضف ثغرات؛ كلها عبر next/postcss/uuid) |

تفصيل Vitest: `timeline.test` 16 · `media.test` 11 (FFmpeg حقيقي) · `mcp/server.test` 20 (عميل MCP + FFmpeg + Python) ·
`ffmpeg-export.test` 8 · `editor-state.test` 5 · `host-guard.test` 4 · الموروثة 17.

## 6. أدلة E2E

### 6.1 عبر stdio (عملية منفصلة كعميل حقيقي) — `pnpm mcp:e2e`

```
✓ اكتشاف الأدوات عبر stdio — 37 أداة
✓ import_media (الفيديو العيّنة) — test_video.mp4, 30s
✓ inspect_media (ffprobe) — h264 640×360 @25
✓ detect_silence — 2 فترة        ✓ analyze_scenes — 0 قطع (العيّنة لقطة واحدة)
✓ split_clip عند 12s             ✓ trim_clip → مدة التايملاين 22s
✓ undo_edit / redo_edit
✓ generate_preview — 6.0s, 640×360, black 0%, صوت −18.3dB
✓ export_project — completed
✓ ffprobe مستقل: h264 1280×720 + aac، المدة 22.0s (30 − 8 مقطوعة)
✓ validate_render — passed (drift 0، black 0، −19.3dB)
✓ رفض: ملف خارج الجذور FORBIDDEN_PATH · معرّف بمسار · قص خارج المصدر OUT_OF_RANGE · مقطع مجهول NOT_FOUND
```

### 6.2 تكامل MCP داخل Vitest (FFmpeg حقيقي، بلا تقليد)
تصدير عبر موافقة elicitation (عميل يقبل) + ffprobe؛ رفض بلا elicitation؛ رفض المستخدم لا يغيّر شيئاً؛
إلغاء تصدير جارٍ ⇒ `cancelled` ومجلد المهمة بلا مخرَج جزئي؛ حذف المصدر ⇒ `failed` (لا `completed`)؛
traversal/symlink/`/etc/passwd`/ملف مزيف/امتداد غير مدعوم مرفوضة؛ خطة Python ⇒ مراجعة ⇒ تطبيق ⇒ تراجع.

### 6.3 الواجهة (Playwright على `pnpm dev`)
- فتح مشروع أنشأه MCP من «مساحة العمل على الخادم»: مقطعان (0–10، 10–22) وترجمات بزمن التايملاين، 0 أخطاء console.
- التشغيل من 9.45s تجاوز المصدر 10→18 (وصل 19.31s = 11.31s تايملاين).
- تقسيم (زر/S) ⇒ زر التراجع يتفعّل؛ Ctrl+Z يعيده والإعادة تتفعّل.
- رفع → S → تصدير → تنزيل: ffprobe = h264 1920×1080 + aac، 30.0s.
- HTTP حي: `Origin: evil` ⇒ 403؛ `Host: evil` ⇒ 403؛ traversal ⇒ 400 ولا `/tmp/pwned`؛ ملف مزيف ⇒ 400 ويُحذف؛ إلغاء تصدير ⇒ `cancelled`.

## 7. القيود والعوائق المتبقية (غير مخفية)

| القيد | الأثر | المقترح |
|-------|-------|---------|
| `next@14.2.35` — ثغرات critical/high (Image Optimization RCE، SSRF، DoS) | خطر عند تعريض الخادم للشبكة؛ التطبيق لا يستخدم `next/image` | هجرة Next 15.5.x منفصلة مع اختبار بصري كامل |
| لا مصادقة؛ Streamable HTTP غير مُفعّل | محلي فقط | مصادقة + تفويض لكل أداة قبل أي نقل بعيد |
| لا عزل sandbox لـ FFmpeg | وسائط خبيثة تعمل بصلاحيات المستخدم | مستخدم محدود/حاوية للوسائط غير الموثوقة |
| مصدر فيديو واحد لكل تصدير | لا مونتاج متعدد المصادر | تعميم `buildFilterComplex` لعدة مدخلات |
| صوت المتصفح (`blob:`) والموسيقى المولّدة لا تدخل التصدير | انحراف معلن (تحذير) | رفع الصوت كأصل على الخادم |
| crop ذكي/Ducking من خطط Python غير مطبّقين على التايملاين | الخطة أغنى من التطبيق (معلن) | حقول zoom/pan في `VideoClip` إلى `buildExportPlan` |
| `clip.effects` للعرض فقط؛ التأثيرات على مستوى المشروع | مربك للمستخدم | نقل التأثيرات لكل مقطع |
| مهارات كثيرة استدلالية (`provenance=simulated`) | لا تحليل حقيقي خلفها | ربطها بـ `lib/engine/media` تدريجياً |
| لا تنظيف تلقائي لـ `.montage_ai/uploads` | نمو القرص | أداة تنظيف بعمر |
| لا تفريغ صوتي محلي في TS (Whisper يحتاج مفتاحاً؛ faster-whisper اختياري في Python) | ترجمات MCP المحلية فارغة | ربط faster-whisper عند توفره |
| اختبار المسار بمفاتيح مزوّد حقيقية | **Not tested** — لا مفاتيح في البيئة | تشغيل يدوي بمفتاح |
| auto-editor / NVENC / Windows | **Not tested** — غير متوفرة في البيئة | — |
| CI على GitHub | **Not tested** هنا — يُتحقق عند الدفع/PR (YAML صالح، الخطوات مجرّبة محلياً) | مراقبة أول تشغيل |

## 8. الملفات المتغيّرة

**جديدة:** `lib/engine/{errors,project-schema,timeline,process,media,store,jobs,plans}.ts` (+ `timeline.test.ts`, `media.test.ts`)،
`mcp/{server,stdio,approval}.ts` (+ `server.test.ts`)، `middleware.ts`، `lib/server/{host-guard,export-jobs}.ts` (+ `host-guard.test.ts`, `ffmpeg-export.test.ts`)،
`lib/skills/provenance.ts`، `app/api/projects/**` (3 مسارات)، `tests/editor-state.test.ts`، `src/tests/test_normalize_plan.py`، `scripts/mcp-e2e.ts`،
`docs/audit/{EDITOR_AI_AUDIT,IMPLEMENTATION_REPORT}.md`، `docs/architecture/MCP_ARCHITECTURE.md`، `docs/MCP_SETUP.md`.

**معدّلة:** `lib/server/ffmpeg-export.ts`، `lib/project.ts`، `lib/types.ts`، `lib/api-config.ts`، `lib/agents/types.ts`،
`lib/skills/{BaseSkill.ts,catalog/SilenceDetectionSkill.ts,catalog/SceneDetectionSkill.ts}`، `src/agents/edl_schema.py`،
`components/editor/{Editor,state,timeline,project-modals}.ts(x)`، `components/shorts/ShortsStudio.tsx`،
`app/api/{export,export/status,export/download,ffmpeg/probe,budget,skills,agents/ceo,agents/pipeline}/**`،
`app/api/ai/{analyze,enhance,faces,metadata,music-sync,objects,reframe,scenes,silence,subtitles,transcribe}/route.ts`،
`package.json`/`pnpm-lock.yaml` (+`@modelcontextprotocol/sdk@1.32.1`، `zod@4.6.7`، `tsx@4.23.15`؛ −`fluent-ffmpeg`)، `vitest.config.ts`، `next.config.js`،
`.github/workflows/ci.yml`، `.env.example`، `README.md`، `AGENTS.md`، `CLAUDE.md`.
