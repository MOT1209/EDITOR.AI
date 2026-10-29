# نظام الإضافات: مهارات مخصّصة وأدوات MCP مخصّصة

يتيح للمالك إضافة/تعديل/تفعيل/تعطيل/حذف **مهارات** و**أدوات MCP** دون تعديل كود النواة (`lib/skills/catalog`، `mcp/server.ts`).
الواجهة: **`/extensions`**. سطر الأوامر: `pnpm ext`. واجهة HTTP: `/api/extensions`. الكود: `lib/extensions/*` و`mcp/custom-tools.ts`.

> **مبدأ التصميم:** الحزمة **بيانات** وليست كوداً. لا شيء في الحزمة يُنفَّذ مباشرة؛ التنفيذ دائماً عبر
> (أ) سجل إجراءات داخلي معتمد، (ب) نص تعليمات لنموذج، (ج) مدخل أصلي مُسجَّل في كود التطبيق، أو (د) برنامج خارجي
> مُدرج في قائمة يتحكم بها المالك خارج مساحة العمل.

## 1) صيغة الحزمة (الإصدار 1)

حزمة = `manifest.json` + ملفات نصية مسطحة اختيارية (≤8 ملفات، ≤64KB للملف). تُتداول بصيغتين متكافئتين:

```
tagline_prompt/            ← مجلد (pnpm ext install tagline_prompt)
├── manifest.json
└── instructions.md
```
```jsonc
// أو ملف حزمة واحد (الاستيراد/التصدير من الواجهة)
{ "format": "montage-extension", "formatVersion": 1, "kind": "skill|tool", "manifest": { … }, "files": { "instructions.md": "…" } }
```

أمثلة عاملة ومُختبرة آلياً في `examples/extensions/`.

### حقول البيان

| الحقل | الوصف |
|---|---|
| `kind` | `skill` أو `tool` |
| `id` | snake_case صغيرة 3-48 حرفاً. **اسم التشغيل** `ext_<id>` (مهارة في SkillManager / أداة في MCP) — بادئة تمنع تصادم المدمج بنيوياً |
| `version` | `major.minor.patch`؛ الإصدارات المحفوظة **غير قابلة للتعديل** |
| `name`, `description`, `category`, `tags`, `author`, `license` | وصف وتصنيف؛ الفئات: analysis, editing, audio, visual, text, generation, export, utility |
| `stability` | `stable` \| `experimental` (الافتراضي experimental ويظهر بوسم «تجريبي») |
| `compat` | `{ formatVersion: 1, montage: ">=0.2.0 <1.0.0" }` — نطاق إصدار المنصة؛ غير المتوافق يُرفض حفظاً وتفعيلاً |
| `permissions` | الصلاحيات التي **تعلنها** الإضافة (قائمة أدناه) |
| `dependencies` | `skills` (مدمجة)، `actions` (سجل الإجراءات)، `native` (إدخالات أصلية) — المفقود خطأ تحقق |
| `config` | `{ schema, defaults }` إعدادات قابلة للضبط من الواجهة |
| `limits` | `timeoutMs` (0.5–120s)، `maxOutputBytes` |
| `input` / `output` | مخططات (مجموعة JSON Schema محدودة، انظر أدناه) |
| `execution` | نوع التنفيذ ونقطة الدخول (انظر القسم 2) |
| `integrity` | `{ algorithm: "sha256", digest }` تُحسب عند الحفظ/التصدير؛ عدم التطابق عند الاستيراد = رفض |
| `requiresApproval` (أدوات) | يفرض موافقة المستخدم عند كل استدعاء (لا يخفّض أبداً ما تفرضه خطورة الإجراء) |

**مجموعة المخطط المدعومة:** `type` (string/number/integer/boolean/array/object)، `enum`، `minimum/maximum`، `minLength/maxLength`، `items/maxItems`، `properties/required`، `default`، `description`. **غير مدعوم عمداً:** `$ref`، `pattern` (ReDoS)، العودية، العمق >3. التحقق **صارم**: الحقول غير المعرّفة تُرفض.

**الصلاحيات:** `project.read` · `project.write` (موافقة) · `render.export` (تصدير، موافقة) · `media.read` · `skills.run` · `ai.invoke` (ضابط تكلفة) · `exec.external` (موافقة دائماً).
الإعلان وحده لا يكفي: يجب أن **يمنحها المالك** من الواجهة (`grant`)، ولا يُمنح ما لم يُعلنه البيان، ويُعاد الفحص عند كل تشغيل.

## 2) أنواع التنفيذ

### المهارات (`kind: skill`)

| `execution.type` | ما يحدث | `provenance` |
|---|---|---|
| `prompt` | `instructions.md` + المدخلات → نموذج المحادثة عبر `guardCost`/`recordSpend`. بلا مفتاح ⇒ `DEPENDENCY_MISSING` (**لا نتيجة مُختلقة**) | `ai-model` + تحذير: لم يُحلَّل أي وسيط |
| `workflow` | خطوات متسلسلة `skill:<مدمجة>` أو `action:<إجراء>` بوسائط `{{input.x}}` / `{{steps.N.key}}` | الأضعف بين الخطوات (simulated < ai-model < real-analysis < computed) |
| `native` | `entry` يشير إلى إدخال **مسجَّل في الكود** (`lib/extensions/native.ts`)؛ الحزمة لا تستطيع تعريف إدخال | يعلنه الإدخال |
| `external` | `entry` في قائمة سماح المالك (القسم 4) | `computed` + تحذير: غير مُتحقَّق منه |

المهارات المفعّلة تُسجَّل في `SkillManager` الحالي باسم `ext_<id>` (إطار واحد): تعمل في `/api/skills` وفي `run_skill` عبر MCP.
ناتجها يُدمج في المستند تحت مفتاح `ext_<id>` فقط، فلا تكتب فوق حقول مهارات أخرى.

### أدوات MCP (`kind: tool`)

| `execution.type` | الوصف |
|---|---|
| `declarative` | `action` من **سجل الإجراءات** + `args` (قيم ثابتة أو `{{input.x}}`). إجراء غير معروف أو وسيط غير معرّف في الإجراء ⇒ **رفض عند الحفظ وعند التنفيذ** |
| `executable` | برنامج خارجي من قائمة السماح؛ موافقة عند كل استدعاء |

**الإجراءات المتاحة** (`lib/extensions/actions.ts`): `project.list`, `project.timeline`, `media.probe`, `analysis.silence`, `analysis.scenes`, `analysis.beats`, `skills.run` (مدمجة فقط)، `timeline.add_text` (كتابة، موافقة، قابل للتراجع)، `render.export` (تصدير كامل مكلف، موافقة، يُنجَح فقط بـ completed بعد مراجعة ffprobe)، `render.status`.
لإضافة إجراء جديد: أضِفه في الملف نفسه بمخطط مدخلات وصلاحيات وخطورة (`read|write|costly`) — هذا قرار مطوّر لا قرار حزمة.

لا يوجد إجراء يقبل shell أو وسائط FFmpeg أو مسار ملف أو عنوان شبكة من المدخلات.

## 3) دورة الحياة والإصدارات

- الإنشاء/الاستيراد ⇒ **معطّلة دائماً**. التفعيل يتطلب: تحقق ناجح + منح الصلاحيات + **اختبار ناجح للإصدار الفعّال** (أو `acknowledgeUntested` صريح).
- حفظ تعديل ⇒ **إصدار جديد أعلى** (نفس الرقم بمحتوى مختلف ⇒ `CONFLICT`). الإصدار الفعّال المفعّل يبقى كما هو حتى تفعّل الجديد.
- `activate` (تقدّم أو **تراجع** rollback) ⇒ يتحقق من التوافق، يعطّل الإضافة ويلغي الاختبار السابق: إعادة اختبار قبل التفعيل.
- المعرّف المكرر لا يُكتب فوقه (`CONFLICT`)؛ المدمج لا يمكن لمسه (ليس في المخزن، وبادئة `ext_` تفصله).
- الأصل: `user` (أُنشئ محلياً) · `imported` (حزمة) · `experimental` (يغلب على الوسمين) · `builtin` (للقراءة فقط).

التخزين: `<workspace>/extensions/{skills,tools}/<id>/{state.json, v/<ver>.json, runs.jsonl}` + `rev.json` + `mcp-exposure.json`.

## 4) التنفيذ الخارجي (مقيَّد ومعزول، معطّل افتراضياً)

يتطلب قرارات من المالك في بيئة الخادم — لا يمكن للواجهة/MCP/الحزمة تفعيله:
```bash
MONTAGE_EXT_EXTERNAL=1
MONTAGE_EXT_ALLOWLIST=/etc/montage/allowlist.json   # خارج مساحة العمل (يُرفض داخلها)
MONTAGE_EXT_SANDBOX=auto                            # auto (افتراضي) | bwrap | unshare | none
```
```json
{ "entries": { "my_script": { "command": "/usr/bin/python3", "args": ["/opt/tools/run.py"], "permissions": [], "timeoutMs": 20000 } } }
```
الحزمة تشير إلى `"entry": "my_script"` فقط. التنفيذ: `spawn` بلا shell، `command` مطلق، بيئة مصفّاة (بلا مفاتيح)، cwd مؤقت، مهلة وسقف مخرجات، المدخل JSON عبر stdin والمخرج JSON عبر stdout، **موافقة المستخدم عند كل تشغيل**.

**العزل (`lib/extensions/sandbox.ts`)** — مطلوب افتراضياً؛ إن لم يتوفر أي أسلوب **يُرفض التشغيل** (لا تدهور صامت):

| الأسلوب | ما يمنعه فعلاً | ملاحظة |
|---|---|---|
| `bwrap` (bubblewrap) | الشبكة، الكتابة على نظام الملفات، رؤية مساحة العمل والمنزل، /tmp مشترك | الأقوى؛ يُفضَّل تثبيته (`apt install bubblewrap`) |
| `unshare` (user+net+mount ns) | الشبكة، ورؤية مساحة العمل والمنزل وجذر المستودع | **أضعف**: بقية نظام الملفات تبقى مقروءة/قابلة للكتابة بصلاحيات المستخدم |
| `none` | لا شيء | قرار صريح من المالك؛ يُوسم تحذيراً في كل نتيجة |

مُتحقَّق منه باختبار عملية حقيقية (`sandbox.test.ts`): الاتصال بالشبكة يفشل وملف مساحة العمل غير مرئي، وبدون العزل يُرى. لا حدود ذاكرة/CPU (استخدم حاوية/cgroups لذلك). Linux فقط؛ على غيره اضبط `none` صراحةً أو لا تستخدم التنفيذ الخارجي.

## 4-ب) توقيع الحزم وسياسة الثقة

بصمة SHA-256 تكشف العبث فقط. **توقيع Ed25519** يثبت أن حائز المفتاح وقّع المحتوى نفسه (حقل `signature` على مستوى الحزمة، خارج البيان):
```bash
pnpm ext keygen mykey                                   # mykey.key.pem (سرّي، لا يُرفع إلى git) + mykey.pub.json
pnpm ext sign examples/extensions/tagline_prompt --key mykey.key.pem --signer owner --out signed.json
MONTAGE_EXT_TRUSTED_KEYS=/etc/montage/trusted.json pnpm ext verify signed.json   # trusted | untrusted | invalid | unsigned
```
- `MONTAGE_EXT_TRUSTED_KEYS`: ملف `{ "keys": [{ "name", "publicKey" }] }` **خارج مساحة العمل** (داخلها يُتجاهل).
- `MONTAGE_EXT_REQUIRE_SIGNED=1`: أي حزمة **مستوردة** يجب أن تكون موقّعة بمفتاح موثوق — يُفحص عند الحفظ والتفعيل **وعند كشف الأداة لـ MCP** (سحب الثقة لاحقاً يوقفها فوراً). الإضافات المنشأة محلياً مستثناة.
- توقيع غير صالح (محتوى عُدّل بعد التوقيع) يُرفض دائماً. التوقيع **لا يثبت أمان** الحزمة، بل مصدرها وسلامتها.
- تعديل حزمة موقّعة أو نسخها يُسقط التوقيع (الإصدار الجديد غير موقّع).

## 4-ج) حدود الموارد

`MONTAGE_EXT_MAX_CONCURRENT` (4) تزامن عام · `MONTAGE_EXT_MAX_PER_EXT` (2) لكل إضافة · `MONTAGE_EXT_RATE_PER_MIN` (60) معدّل لكل إضافة. التجاوز ⇒ `LIMIT_EXCEEDED` دون تنفيذ. داخل العملية (محلي)؛ لا يحدّ الذاكرة/CPU.

## 5) خادم MCP

- الأدوات المخصّصة المفعّلة تُسجَّل ديناميكياً في الخادم الحالي (SDK الرسمي) باسم `ext_<id>`؛ **لا تعديل لـ `mcp/server.ts`**.
- تُكشف فقط عند: مفعّلة + صالحة + متوافقة + صلاحياتها ممنوحة (+ التنفيذ الخارجي ممكّن للمنفّذات). غير ذلك يظهر في `skipped` مع السبب.
- **عند كل استدعاء** يُعاد تحميل الحزمة من السجل والتحقق من الحالة والمدخلات (مخطط صارم) والصلاحيات، فسحب منحة يوقف أداة معروضة فوراً.
- العمليات الكاتبة/المكلفة/الخارجية تمرّ بموافقة MCP elicitation (`MONTAGE_MCP_APPROVAL`) كالأدوات المدمجة.
- الاستجابة: `{ tool, version, provenance, result, warnings, durationMs }`؛ الأخطاء: `isError` + `[CODE]` + سطر JSON أخير (نفس عقد المدمجة).
- أدوات وصفية: `list_custom_tools` (ما هو مكشوف فعلاً/المتخطّى/السجل)، `refresh_custom_tools` (مزامنة فورية).
- **تحديث القائمة:** يفحص الخادم السجل كل ~2 ثانية (`rev.json`) ويضيف/يزيل/يحدّث الأدوات ثم يرسل `notifications/tools/list_changed`.
  العملاء الداعمون لـ `listChanged` يحدّثون تلقائياً؛ **غيرهم يلزمهم إعادة الاتصال أو استدعاء `tools/list` من جديد.** إن كان الخادم متوقفاً فالتغيير يسري عند بدء التشغيل التالي.
- سجل التعرّض الفعلي: `<workspace>/extensions/mcp-exposure.json` (تعرضه الواجهة مع حالة تشغيل العملية).
- النقل الافتراضي **stdio** (محلي). لا يوجد نقطة MCP بعيدة؛ إضافة واحدة تتطلب مصادقة وتفويضاً وحماية شبكة أولاً (غير منفّذة).

## 6) الأمان — ما يُمنع وما لا يُغطّى

يُمنع: أمر shell، وسائط FFmpeg حرة، وصول ملفات حر، طلب شبكة حر، إجراء غير مسجّل، كتابة فوق مدمج/موجود، تعديل إصدار محفوظ، مفتاح مخطط غير مدعوم، مراجع تجتاز `__proto__`.

حدود صريحة:
- حزمة `prompt` خبيثة قد تحاول التأثير على نموذج؛ لكنها بلا أدوات/أثر جانبي ومخرجاتها تُتحقق بمخطط وتُوسم `ai-model`.
- البصمة وحدها لا تثبت هوية الناشر؛ التوقيع (4-ب) يثبتها لمن يضبط قائمة الثقة، وهو اختياري افتراضياً.
- عزل البرامج الخارجية بحسب الأسلوب (القسم 4) — `unshare` لا يقيّد نظام الملفات كاملاً. لا حدود ذاكرة/CPU.
- التطبيق محلي بلا حسابات: «مستخدم آخر» غير موجود؛ الحماية من الكتابة فوق إضافة قائمة قائمة على المعرّف والإصدار.

## 7) واجهة HTTP

`GET /api/extensions?kind=skills|tools&q=&category=&tag=&label=&status=` · `POST /api/extensions {op: validate|create|import}` ·
`GET|PUT|DELETE|POST /api/extensions/<kind>/<id>` (POST: `enable|disable|grant|config|activate|duplicate|test|run`) · `GET …/<id>/export`.
محمية بحارس Host/Origin (`middleware.ts`)؛ الحذف يتطلب `confirm:true`، والتنفيذ الكاتب/الخارجي يتطلب `confirmed:true` بعد نافذة تأكيد.

## 8) سطر الأوامر

```bash
pnpm ext validate examples/extensions/tagline_prompt
pnpm ext install  examples/extensions/silence-report.tool.json   # يثبّت معطّلاً
pnpm ext list tools
pnpm ext export tools silence_report out.json
```
