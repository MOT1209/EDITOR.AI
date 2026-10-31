# تدقيق الأمان — EDITOR.AI (2026-10-31)

نموذج التهديد: (أ) مستخدم محلي يشغّل الخادم على جهازه ويزور مواقع أخرى (CSRF/DNS rebinding)؛ (ب) نشر عن بُعد/شبكة محلية؛
(ج) وسائط مرفوعة غير موثوقة؛ (د) وكيل/عميل MCP أو إضافة تحاول تجاوز الصلاحيات؛ (هـ) سلسلة التوريد (تبعيات).
**الحالة** = بعد المرحلة 2 (تفاصيل الإصلاح والاختبارات في `../security/SECURITY_REMEDIATION_REPORT.md`).

| # | الخطورة | الوصف | الملفات | الدليل | الأثر | الحل | الحالة | اعتماديات |
|---|---------|-------|---------|--------|-------|------|--------|-----------|
| **SEC-01** | حرجة | `next@14.2.35` و`postcss/uuid/nanoid`: 33 ثغرة (3 حرجة: RCE في Image Optimization/Windows، 14 high: DoS/SSRF/Server Actions) | `package.json` | `pnpm audit --prod` = 33 (Verified) | RCE/DoS لو عُرِّض الخادم؛ لا `next/image` في الكود يخفّف بعضها (Code-verified) | ترقية Next 15.5.28 + overrides | ✅ **أُغلق**: `audit --prod` = 0؛ build+tests+e2e على 15.5.28 | — |
| **SEC-02** | عالية | لا مصادقة على أي `/api/*` (host/origin فقط). `curl` بلا Origin يمرّ | `middleware.ts` | قراءة + طلب HTTP حي | أي عملية على الجهاز/الشبكة تستدعي التصدير/الحذف/الإضافات | رمز `MONTAGE_API_TOKEN` + فشل مغلق عند `MONTAGE_ALLOWED_HOSTS` | ◐ **مخفَّف**: رمز مشترك واحد (HTTP حي: 401/200/403/503). لا مستخدمين/أدوار/تدوير رموز/تحديد معدل | T-04 |
| **SEC-03** | عالية | الموافقة على تشغيل إجراء مكلف/خارجي تحددها قيمة `confirmed:true` يرسلها العميل | `lib/server/ext-api.ts`, `app/api/extensions/[kind]/[id]/route.ts` | قراءة: `uiApprover(body.confirmed===true)` | طلب واحد أعمى يتجاوز نافذة التأكيد | مصافحة خادم: طلب معلّق ثم استهلاك لمرة واحدة بمفتاح (نوع/معرّف/إجراء)، TTL 5 دقائق | ✅ للتشغيل (`run/test`). **SEC-03b متبقٍ:** `action:"grant"` و`DELETE {confirm:true}` بلا مصافحة (يعتمدان على المصادقة وحارس Origin) | T-05 |
| **SEC-04** | متوسطة | مفاتيح المزوّد تُخزَّن في `localStorage` وتُرسل بترويسات `x-opencode-key/x-hf-token/x-pexels-key` | `lib/api-config.ts`, `lib/server/api-keys.ts`, `modals.tsx` | قراءة | XSS ⇒ سرقة المفاتيح؛ الشبكة غير المشفّرة ⇒ تسريب | في النشر عن بُعد أو `MONTAGE_ACCEPT_CLIENT_KEYS=0` تُتجاهل مفاتيح المتصفح كلياً؛ مفاتيح الخادم من env فقط | ◐ مخفَّف (للاستخدام المحلي الافتراضي ما يزال المتصفح يحمل المفاتيح — قرار تصميمي موثّق) | T-06 |
| **SEC-05** | متوسطة | مدخلات JSON بلا مخطط/حد: `duration` يتحكم بطول حلقات الخادم (subtitles: `duration/3` عنصراً؛ music-sync: `duration/(60/bpm)`) و`frames` بلا سقف | `app/api/ai/*/route.ts` (12 مساراً) | قراءة؛ بعد الإصلاح: 400 حي لـ `duration=1e9` | DoS ذاكرة/CPU بطلب صغير | مخططات zod (`lib/server/schemas.ts`) + `parseJsonBody` (حد 1MB) | ✅ لـ 12 مساراً. **متبقٍ:** `silence`, `skills`, `transcribe*` (multipart/مخططات خاصة) | T-07 |
| **SEC-06** | متوسطة | الرفع: `arrayBuffer()` + `Buffer.from` (نسختان بالذاكرة) بلا رفض مبكر ولا سقف تخزين كلي ولا تنظيف | `app/api/ffmpeg/probe`, `agents/pipeline`, `agents/ceo` | قراءة | استنزاف ذاكرة/قرص | رفض بـ Content-Length (413)، `ensureStorageQuota` (507)، بث إلى القرص (0600)، TTL + `pnpm cleanup` | ✅ مع قيد P-1 (`formData()` يحمّل الجسم) | T-08 |
| **SEC-07** | منخفضة | `agents/pipeline`: امتداد الملف يأتي من اسم العميل (`path.extname(file.name) \|\| ".mp4"`) | `app/api/agents/pipeline/route.ts` | قراءة | كتابة ملف بامتداد اعتباطي في uploads (غير منفَّذ لكنه غير مرغوب) | `safeUploadExt` قائمة سماح | ✅ اختبار | — |
| **SEC-08** | متوسطة | FFmpeg/ffprobe: بيئة كاملة موروثة (مفاتيح)، لا `-protocol_whitelist`، لا حدود موارد، لا عزل | `lib/engine/process.ts`, `ffmpeg-export.ts`, `agents/ceo/route.ts` | قراءة؛ ffprobe على `http://…` يتصل بلا whitelist (V: اختبار تحكم)؛ HLS محلي لا يتصل على FFmpeg 6.1 (V: غير قابل للاستغلال هنا) | عمق الدفاع: وسائط خبيثة/تسريب بيئة/استنزاف | `childEnv()` مصفّاة، `-protocol_whitelist file,pipe` قبل كل `-i`، `prlimit` (CPU/حجم الملف/FD) على Linux | ◐ لا عزل namespace/حاوية/seccomp لـ FFmpeg (حاجز خارجي: يتطلب Docker/bwrap كتبعية نشر). Windows/macOS بلا حدود موارد | T-09 |
| **SEC-09** | منخفضة | استجابة الرفع تعيد `path` مطلقاً على الخادم؛ التصدير يقبل `sourcePath` من العميل (مقيّد بـ `isPathInside`) | `app/api/ffmpeg/probe/route.ts`, `app/api/export/route.ts` | HTTP حي | كشف بنية القرص؛ سطح هجوم لمسارات | معرّفات أصول معتمة بدل المسارات | ✅ **أُغلق (T-03):** مراجع معتمة؛ `path` أُزيل من استجابات الرفع و`/api/export/status` و`/api/jobs` و`/api/projects/[id]` و`agents/ceo`؛ اختبارات `tests/security/media-ref.test.ts`. (صور محفوظة سابقاً بمسار مطلق داخل `ASSETS_DIR` ما تزال تُقبل للتوافق) | T-03 |
| **SEC-10** | منخفضة | مفاتيح تُمرَّر إلى عملية Python (ضرورية لـ CrewAI) | `agents/pipeline`, `agents/export` | قراءة | عملية فرعية موثوقة | حدود `prlimit` فقط؛ تصفية env للمفاتيح غير ممكنة دون كسر المزوّد | ◐ موثّق | — |
| **SEC-11** | معلوماتية | سجلات غير مهيكلة قد تتضمن أسراراً | `app/api/agents/pipeline` (console) | قراءة | تسريب في السجلات | `logger` مع إخفاء المفاتيح/القيم الشبيهة (`sk-`, `hf_`, `Bearer`) | ✅ للمسارات المُنتقلة | D-05 |
| **SEC-12** | منخفضة | لا ترويسات أمان (CSP/XFO/nosniff/Referrer) | `next.config.js` | قراءة | clickjacking | ترويسات + CSP خفيفة (`frame-ancestors 'none'`, `object-src 'none'`…) | ◐ CSP صارمة (script-src بـ nonce) مؤجلة لأن الواجهة تعتمد سكربتات Next المضمّنة وروابط `blob:` | T-11 |
| **SEC-13** | منخفضة (dev) | 10 تحذيرات تبعيات تطوير: vitest/@vitest/mocker (moderate، يتطلب 4.1.11+)، eslint>minimatch/brace-expansion (high، يتطلب eslint 9)، tailwind>postcss-selector-parser | `package.json` | `pnpm audit` | لا تصل للإنتاج (devDependencies) | هجرة vitest 4 / eslint 9 مع `eslint-config-next` 16 | ⏳ محجوب بترقيات كبرى معزولة | T-12 |
| **SEC-14** | معلوماتية | لا أسرار في git؛ gitleaks في CI | `.gitignore`, CI | قراءة | — | — | ✅ | — |

## نقاط قوة مُتحقَّق منها (لا تُزال)

حارس Host/Origin (CSRF/DNS-rebinding) · `isPathInside` و`assertId` على كل مسار عميل (اختبارات traversal/symlink في MCP) · لا وسائط ffmpeg من المدخلات (`buildExportPlan`) ·
`spawn` بمصفوفة بلا shell (`shell:false` صريح الآن) · sandbox الإضافات (bwrap/unshare، بيئة مصفّاة، توقيع) · ضابط التكلفة · SSRF Pexels مقيّد بالمضيف.

## ما لم يُختبر (صراحة)

اختراق فعلي (pentest) · fuzzing لـ FFmpeg بوسائط خبيثة · bwrap (غير متاح في البيئة) · Windows/macOS · CI على GitHub · سلوك Next الإنتاجي خلف reverse proxy.
