# تقرير معالجة الأمان والبنية التحتية — المرحلة 2

> التاريخ: 2026-10-31 · الفرع: `ccr-3587eedd-u75ugk` · قبل: `660f4f0` · بعد: التزام المرحلة 2 + هذا التقرير.
> المرجع: [`../audit/SECURITY_AUDIT.md`](../audit/SECURITY_AUDIT.md). كل بند أدناه إما **مُتحقَّق** (أمر/اختبار/HTTP حي) أو **موثّق كمحجوب/متبقٍ** مع السبب.

## 1. ملخص الفحوص النهائية (Verified)

| الفحص | قبل | بعد |
|-------|-----|-----|
| `npx tsc --noEmit` | ✅ | ✅ |
| `pnpm lint` | ✅ | ✅ |
| `pnpm test` (وحدات + تكامل + أمان) | 114 ✓ / 2 تخطّي (116) | **159 ✓ / 1 تخطّي (160)** — المتخطّي `bwrap` غير متاح في هذه البيئة |
| `python -m pytest` | 36 ✓ | 36 ✓ |
| `node scripts/check-contract.ts` | ✅ 60 | ✅ |
| `pnpm mcp:e2e` | ✅ | ✅ (كل الفحوص) |
| `pnpm build` | ✅ Next 14 | ✅ Next **15.5.28** (Middleware 35.1kB) |
| `pnpm audit --prod` | **33** (3 حرجة، 14 high) | **0** |
| `pnpm audit` (كل التبعيات) | — | 10 (dev-only: 1 low، 7 moderate، 2 high) — SEC-13 |
| HTTP حي على `next start` (رمز مفروض) | — | بلا رمز 401 · رمز خاطئ 401 · رمز صحيح 200 · Origin غريب مع رمز صحيح 403 · `duration=1e9` ⇒ 400 · رفع حقيقي ⇒ 200 · ملف مزيّف ⇒ 400 ويُحذف |

## 2. تقرير التبعيات (محدَّث)

| الحزمة | قبل | بعد | السبب |
|--------|-----|-----|-------|
| `next` | 14.2.35 | **15.5.28** | 3 حرجة + 14 high (RCE Image Optimization، DoS، SSRF). 15.5.28 هو آخر إصدار 15.x يغلق كل التحذيرات؛ **16.x متاح لكن لم أقفز إليه** (هجرة أكبر، تحذير إهمال `next lint`) |
| `eslint-config-next` | 14.2.35 | 15.5.28 | مطابقة |
| `uuid` | 9.0.1 | 11.1.1 | ثغرة bounds (v3/v5/v6)؛ `@types/uuid` أُزيل (الأنواع مضمّنة) |
| `postcss` | 8.5.15 (+8.4.31 مضمّنة في next) | 8.5.32 عبر `overrides` | 4 ثغرات (path traversal/file read) تمر عبر `next>postcss` |
| `nanoid`, `source-map-js`, `browserslist`, `js-yaml`, `brace-expansion`, `vite`, `tinypool` | متعددة | `pnpm.overrides` (انظر `package.json`) | تحذيرات transitive |
| `vitest` | 2.1.9 | 3.2.7 | ثغرات حرجة في `tinypool`/`vitest` (dev) |
| `react` / `react-dom` | 18.3.1 | 18.3.1 (لم تُرفع) | Next 15 يدعم React 18 في App Router؛ لا حاجة لـ React 19 |

**تغييرات كود لازمة لـ Next 15:** `params` أصبحت `Promise` (6 مسارات)، و`dynamic(..., {ssr:false})` ممنوعة في Server Components ⇒ نُقلت صفحتا `/` و`/shorts` إلى `"use client"`، وفُصل محمّل `/extensions` في `ExtensionsLoader.tsx` ليبقى `metadata` في الصفحة.
**ما لم يُصلَح (SEC-13 — محجوب):** `vitest` يحتاج 4.1.11+ و`eslint>minimatch` يحتاج ESLint 9 — هجرتان كبيرتان (تغيّر تهيئة ESLint flat وإهمال `next lint`)؛ كلاهما dev فقط ولا يصل للإنتاج. مُدرجان كـ T-12.

## 3. الأولويات الاثنتا عشرة — الحالة

| # | المطلوب | الحالة | الدليل / الملفات |
|---|---------|--------|------------------|
| 1 | ترقية التبعيات المعرّضة | ✅ | القسم 2؛ `audit --prod` = 0 |
| 2 | TypeScript/lint/build/runtime | ✅ | القسم 1 + تشغيل `next start` حي |
| 3 | تحقق آمن من الرفع | ✅ | `lib/server/uploads.ts`, `app/api/ffmpeg/probe`, `agents/pipeline`, `agents/ceo`: رفض مبكر 413 بـ Content-Length، `validateVideoUpload`، فحص ffprobe (يحذف غير الصالح)، امتداد من قائمة سماح (SEC-07)، صلاحيات 0600 |
| 4 | حدود الحجم/النوع/التخزين | ✅ | `MAX_UPLOAD_BYTES` (قائم)، `MONTAGE_MAX_STORAGE_BYTES` (جديد، 507)، اختبار `storage.test.ts` |
| 5 | تنظيف تلقائي | ✅ | `lib/server/storage.ts` (`maybeCleanup` عند الرفع كل ≤10 دقائق + `pnpm cleanup [--dry-run]`). TTL: uploads 24س، exports 72س، pipeline 48س. لا يتبع الروابط الرمزية، يرفض الجذر، **لا يمسّ مساحة عمل المشاريع** (اختبارات) |
| 6 | تأمين تنفيذ FFmpeg | ✅/◐ | وسائط بمصفوفة بلا shell (`shell:false` صريح)، `-protocol_whitelist file,pipe` قبل كل `-i`، بيئة مصفّاة. **اختبار تحكم:** ffprobe على `http://127.0.0.1:…` يتصل بلا whitelist ولا يتصل معه. **ملاحظة صادقة:** قائمة HLS محلية لا تتصل على FFmpeg 6.1.1 أصلاً، فالتصليب هنا عمق دفاع لا إصلاح ثغرة مُثبتة |
| 7 | عزل العمليات وحدود الموارد | ◐ | `prlimit` (CPU/حجم الملف/FD) على Linux — **مُتحقَّق بالنواة:** ffmpeg مع `--fsize=20000` يُقتل (اختبار). **لا** عزل namespace/seccomp/حاوية لـ FFmpeg الأساسي؛ **Windows/macOS بلا حدود**. محجوب خارجياً بتوفر Docker/bwrap على المضيف ⇒ T-09 |
| 8 | منع تنفيذ shell عشوائي | ✅ | لا `shell:true` في المستودع (grep)؛ لا وسائط ffmpeg من المدخلات (`buildExportPlan`)؛ استدعاءات `spawnSync` في `agents/ceo` تمر عبر `runFfmpegSync` المصلَّب |
| 9 | تفويض ومصادقة من الخادم | ◐ | `lib/server/auth.ts` + `middleware.ts`: `MONTAGE_API_TOKEN` (≥16 حرفاً، مقارنة بزمن ثابت)، فشل مغلق للنشر عن بُعد (503)، رمز ضعيف ⇒ 503. **مصافحة موافقة** (`approvals.ts`) تُبطل `confirmed:true` الأعمى لتشغيل الإضافات. **متبقٍ (SEC-03b):** `grant` و`DELETE {confirm:true}`؛ ولا مستخدمين/أدوار (T-04/T-05) |
| 10 | حماية الأسرار ومفاتيح المزوّد | ◐ | لا `NEXT_PUBLIC_*` أسرار (grep)؛ في النشر عن بُعد أو `MONTAGE_ACCEPT_CLIENT_KEYS=0` تُتجاهل مفاتيح المتصفح؛ سجلات تُخفي المفاتيح؛ العمليات الفرعية للـ ffmpeg بلا env الأسرار. **متبقٍ:** الوضع المحلي الافتراضي ما يزال يقبل مفتاح المتصفح من localStorage (قرار UX محلي، تنبيه قائم في الواجهة) |
| 11 | تحقق كل المدخلات الخارجية بمخططات | ◐ | 12 مساراً `ai/*` بـ zod (`schemas.ts`, `request.ts`: حد 1MB، 413/400). **غير مغطّى بعد:** `ai/silence`, `ai/transcribe*`, `skills`, `assets/*` (T-07) |
| 12 | معالجة أخطاء وسجلات مهيكلة | ◐ | `logger.ts` (JSON إلى stderr، إخفاء أسرار، مستويات)؛ طُبّق على الرفع والـ pipeline. باقي المسارات ما تزال `console`/نص ثابت (D-05/D-06) |
| — | ترويسات أمان | ✅/◐ | `next.config.js`: nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP خفيفة؛ CSP صارمة مؤجلة (T-11) |
| — | تدقيق تبعيات في CI | ✅ | خطوة `pnpm audit --prod --audit-level=high` (لم تُشغَّل على GitHub — NT) |

## 4. اختبارات الانحدار (44 جديدة — كلها تمر)

| الملف | يحمي من |
|-------|---------|
| `tests/security/auth.test.ts` (8) | تجاوز الرمز، رمز ضعيف، فشل مغلق عن بُعد، CSRF مع رمز صحيح |
| `tests/security/approvals.test.ts` (4) | `confirmed:true` أعمى، إعادة استخدام، نطاق/إجراء مختلف، انتهاء الصلاحية |
| `tests/security/input-validation.test.ts` (9) | DoS بمدد ضخمة (subtitles/music-sync)، حدود المصفوفات، 400/413 الفعلي من المسارات، امتداد الرفع، رفض Content-Length |
| `tests/security/storage.test.ts` (6) | حذف بحسب العمر، dry-run، رابط رمزي خارجي، جذر ضحل، حماية المشاريع، السقف |
| `tests/security/hardening.test.ts` (8) | تصفية env، whitelist (اتصال http مرفوض)، prlimit فعلي بالنواة، لا تسرب مفاتيح للعمليات الفرعية، عدم تراجع وظيفي |
| `tests/security/logger-keys.test.ts` (4) | تسريب أسرار بالسجلات، مفاتيح المتصفح عن بُعد |
| `tests/security/headers.test.ts` (1) | ترويسات الأمان |
| `tests/audit/known-gaps.test.ts` (4) | توصيف G-1..G-4 (قيود التصدير) — **تفشل عمداً عند إصلاحها** |

لم أتحقق من أن هذه الاختبارات **تفشل على الكود القديم** بتشغيله على نسخة قديمة (إلا اختبار الـ whitelist الذي أثبتُّ له تحكماً يدوياً، وسلوك `duration=1e9` الذي ظهر في القراءة). هذا حد معلن.

## 5. التوثيق البيئي المحدَّث

`.env.example` (قسم «الأمان») و`README.md` (الجودة/القيود) و`package.json` (`pnpm cleanup`). المتغيرات الجديدة: `MONTAGE_API_TOKEN`, `MONTAGE_ACCEPT_CLIENT_KEYS`, `MONTAGE_MAX_STORAGE_BYTES`, `MONTAGE_{UPLOAD,EXPORT,PIPELINE}_TTL_HOURS`, `MONTAGE_PROC_LIMITS`, `MONTAGE_PROC_CPU_SECONDS`, `MONTAGE_PROC_MAX_FILE_BYTES`, `MONTAGE_PROC_MAX_OPEN_FILES`, `MONTAGE_LOG_LEVEL`.

## 6. المحجوب / المتبقي صراحة

| البند | السبب |
|-------|--------|
| عزل FFmpeg بحاوية/seccomp | يتطلب Docker/bwrap على المضيف؛ ليس قابلاً للتحقق في هذه البيئة (bwrap غير متاح) |
| ESLint 9 / vitest 4 | هجرات كبيرة؛ dev فقط |
| مستخدمون/أدوار، تحديد معدل | خارج نطاق التصليب؛ T-04 |
| `grant`/`DELETE` بمصافحة | يتطلب تعديل واجهة الإضافات؛ T-05 |
| CSP صارمة | تتطلب nonce وتحويل سكربتات مضمّنة؛ T-11 |
| إزالة المسار المطلق من استجابة الرفع | يغيّر عقد الواجهة ⇒ T-03 |
| تشغيل CI على GitHub، Windows/macOS، NVENC، مفاتيح مزوّد حقيقية | Not tested |

## 7. تحذير تشغيلي

الرمز المشترك (`MONTAGE_API_TOKEN`) يحمي من الوصول غير المصرّح لكنه **ليس نظام هوية**. قبل أي نشر عام نفّذ على الأقل T-04 وT-05 وT-09 وT-11، وضع الخادم خلف HTTPS وreverse proxy.
