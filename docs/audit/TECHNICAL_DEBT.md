# الدين التقني — EDITOR.AI (2026-10-31)

الخطورة = أثر على الصحة/الصيانة. «اعتماديات» ترجع لمعرّفات `DEVELOPMENT_ROADMAP.md`.

| # | الخطورة | البند | الملفات | الدليل | الأثر | الحل المقترح | اعتماديات |
|---|---------|-------|---------|--------|-------|--------------|-----------|
| **D-01** | عالية | `Editor.tsx` أحادي 3559 سطراً (تحميل/تصدير/ذكاء/تايملاين/مودالات) | `components/editor/Editor.tsx` | `wc -l` | بطء تعديل، مخاطر انحدار، لا اختبارات | تقسيم إلى hooks (`useExport`, `useAiTools`, `usePlayback`) ومكوّنات، بالتدريج تحت اختبارات Playwright | R-FE-1 |
| **D-02** | عالية | حالة المهام في ذاكرة العملية (`aiJobs` Map) وملفات JSON بلا قفل متعدد العمليات | `lib/mockAi.ts:12`, `lib/engine/store.ts` | قراءة | فقدان المهام عند إعادة التشغيل؛ سباق كتابة لو تعددت العمليات | طابور مهام دائم (SQLite) + قفل ملفات؛ SQLite للمشاريع | R-BE-1 |
| **D-03** | عالية | ازدواج منطق CEO: TS (`app/api/agents/ceo/route.ts` 638 سطراً) وPython (`ceo_agent.py` 408) | المسارين | قراءة | انحراف سلوك، صيانة مضاعفة | توحيد على مسار Python عبر الجسر، وإبقاء مسار TS غلافاً رفيعاً | R-AG-1 |
| **D-04** | متوسطة | `lib/mockAi.ts` (583 سطراً) يمزج محاكاة قديمة بمرافق حيّة (`aiJobs`, `EFFECTS_LIBRARY`, `generateToneTrack`) | `lib/mockAi.ts` | grep: 3 مستوردين | التباس «محاكاة/حقيقي» | فصل `jobs.ts` و`libraries.ts`، حذف الدوال غير المستدعاة بعد grep | R-FE-1 |
| **D-05** | متوسطة | تسجيل غير موحّد: `console.*` في مسارات (تم تحويل pipeline فقط) | `app/api/**`, `lib/**` | grep | لا ربط طلبات/مستويات | استبدال تدريجي بـ `logger` + معرّف طلب | R-SEC-2 |
| **D-06** | متوسطة | معالجة أخطاء غير موحّدة: بعض المسارات `try/catch` بنص ثابت، بعضها `errorResponse` | `app/api/**` | قراءة | رسائل متباينة وأكواد HTTP | غلاف `withRoute()` يوحّد الأخطاء/السجلات/المصادقة | R-SEC-2 |
| **D-07** | متوسطة | لا اختبارات واجهة آلية؛ تقارير Playwright يدوية (غير محفوظة في المستودع) | — | لا `playwright.config` | انحدارات صامتة في المعاينة/التصدير | Playwright smoke في CI (رفع→تقسيم→تصدير) | R-QA-1 |
| **D-08** | متوسطة | مخططات التحقق مشتتة: `validate.ts` يدوي، `project-schema.ts`، zod في MCP/ai | متعدد | قراءة | ازدواج وفجوات | توحيد على zod وتوليد أنواع TS | R-SEC-2 |
| **D-09** | منخفضة | `tsx`, `zod` مثبتة بإصدار دقيق؛ `lucide-react@0.378`, `framer-motion@11` قديمة | `package.json` | قراءة | تأخر ترقيات | جدولة ترقية دورية + Renovate | R-DEP-1 |
| **D-10** | منخفضة | ملفات HTML تقارير في الجذر (`MONTAJI_REPORT.html`, `تقرير-*.html`) و`plan.md` | الجذر | `ls` | ضجيج | نقل إلى `docs/archive/` | — |
| **D-11** | منخفضة | `README/CLAUDE.md` أعداد قديمة (اختبارات/تبعيات) | وثائق | مقارنة | تضليل | توليد الأعداد في CI أو حذفها | — |
| **D-12** | متوسطة | `next lint` مُهمل في Next 16؛ ESLint 8 منتهي الدعم | `package.json` | مخرجات `pnpm lint` | ثغرات dev (SEC-13) وهجرة قسرية | ESLint 9 flat config + CLI مباشر | T-12 |
| **D-13** | متوسطة | `runExport` داخل عملية الويب؛ لا عامل منفصل | `ffmpeg-export.ts`, `export/route.ts` | قراءة | CPU يجمّد الخادم (Assumption) | عملية عامل (child_process.fork) أو طابور | R-BE-1 |
| **D-14** | منخفضة | `tests/audit/known-gaps.test.ts` اختبارات توصيف مؤقتة | `tests/audit` | — | يجب تحديثها عند إصلاح F-10..F-14 | قلب التأكيدات إلى اختبارات قبول عند الإصلاح | R-ED-* |

## كود مكرر/غير ضروري (Verified بـ grep)

- `lib/mockAi.ts`: دوال `analyzeVideoAI`, `detectSilences`, `generateSubtitles`, `translateTranscript`, `aiVoiceover` غير مستوردة من الواجهة (D-04).
- مسار `.montage_ai/uploads` مُعرَّف في 3 أماكن (`ffmpeg-export.ts:UPLOAD_DIR`، `agents/ceo`، `agents/pipeline`) و`storage.ts:managedDirs` يعيد اشتقاقه — توحيد مرجعي مطلوب (صغير).
- `fluent-ffmpeg` أُزيل سابقاً ✅.
