# إعداد خادم MCP — MontageAI

خادم [Model Context Protocol](https://modelcontextprotocol.io) يتيح لوكلاء الذكاء الاصطناعي
(Claude Desktop / Claude Code / Cursor أو أي عميل MCP) العمل على **مشاريع مونتاج حقيقية**:
استيراد وسائط، تحليلها بـ FFmpeg، تعديل التايملاين، تشغيل مسار الوكلاء، والرندر مع تحقق
ffprobe — بأدوات مكتوبة الأنواع، لا بأوامر shell.

> المعمارية والقرارات: [`docs/architecture/MCP_ARCHITECTURE.md`](architecture/MCP_ARCHITECTURE.md).

## المتطلبات

| المتطلب | لماذا | التحقق |
|---------|-------|--------|
| Node.js 20+ (المُختبَر: 22) + pnpm | تشغيل الخادم (`tsx`) | `node -v` |
| FFmpeg + FFprobe في `PATH` | كل التحليل والرندر | `ffmpeg -version && ffprobe -version` |
| Python 3.10+ مع `pydantic` | فقط لأدوات الخطط (`create_editing_plan`) | `python3 -c "import pydantic"` |

```bash
pnpm install --frozen-lockfile
pip install -r src/requirements.txt     # اختياري — لأدوات الخطط (يكفي pydantic/httpx/python-dotenv)
pnpm mcp                                # تشغيل يدوي للتجربة (ينتظر عميلاً على stdin)
pnpm mcp:e2e                            # اختبار حقيقي كامل عبر stdio على test_assets/test_video.mp4
```

إن لم يكن FFmpeg في `PATH`: اضبط `FFMPEG_PATH` (و`FFPROBE_PATH` إن لم يكن بجواره).

## النقل (Transport)

**stdio فقط.** الخادم يعمل كعملية فرعية لعميلك على جهازك نفسه؛ لا منفذ شبكة يُفتح.
Streamable HTTP **غير مُفعّل عمداً**: التطبيق بلا حسابات، والنقل البعيد يتطلب مصادقة
وتفويضاً لكل عملية — لم يُبنَ بعد (انظر «القيود»).

## إعداد العملاء

استبدل `/path/to/EDITOR.AI` بالمسار المطلق للمستودع. `cwd` إلزامي (الخادم يجد
`tsconfig.json` و`src/` لمسار Python منه).

### Claude Code

```bash
cd /path/to/EDITOR.AI
claude mcp add montage-ai \
  --env MONTAGE_MEDIA_ROOTS="$HOME/Videos" \
  -- pnpm --dir /path/to/EDITOR.AI -s mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "montage-ai": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/EDITOR.AI", "-s", "mcp"],
      "env": {
        "MONTAGE_MEDIA_ROOTS": "/Users/me/Videos",
        "MONTAGE_MCP_APPROVAL": "elicit"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "montage-ai": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/EDITOR.AI", "-s", "mcp"],
      "env": { "MONTAGE_MEDIA_ROOTS": "/home/me/Videos" }
    }
  }
}
```

> `-s` (silent) مهم: أي نص من pnpm على stdout يفسد بروتوكول JSON-RPC. الخادم نفسه
> يحوّل كل سجلاته إلى stderr.

## متغيرات البيئة

| المتغير | الافتراضي | المعنى |
|---------|-----------|--------|
| `MONTAGE_WORKSPACE` | `<repo>/.montage_ai/workspace` | جذر مساحة العمل (المشاريع، الوسائط المنسوخة، الرندرات، سجل التدقيق). |
| `MONTAGE_MEDIA_ROOTS` | (فارغ) | مجلدات **إضافية** يُسمح بالاستيراد منها (مفصولة بـ `:` على Linux/macOS و`;` على Windows). `<workspace>/inbox` مسموح دائماً. |
| `MONTAGE_MCP_APPROVAL` | `elicit` | سياسة الموافقة: `elicit` (اسأل المستخدم عبر MCP)، `auto` (تفويض مسبق)، `deny` (رفض كل العمليات المحمية). |
| `MONTAGE_MAX_RENDER_JOBS` | `2` | الحد الأقصى لمهام الرندر المتزامنة. |
| `MONTAGE_PLAN_TIMEOUT_MS` | `600000` | مهلة مسار وكلاء Python. |
| `MONTAGE_PYTHON` | `.venv` ثم `python3` | مفسّر Python لأدوات الخطط. |
| `MAX_UPLOAD_BYTES` | 2GB | أقصى حجم لملف مستورد. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | من `PATH` | مسارات ثابتة للأدوات. |

مفاتيح المزوّدين (`OPENCODE_API_KEY`، `HF_TOKEN`...) **لا تُمرَّر** لمسار Python من MCP إلا
عند `allowPaidProviders=true` وبموافقة المستخدم، ولا تظهر أبداً في نتائج الأدوات.

## الصلاحيات والموافقة

| الفئة | الأدوات | السلوك |
|-------|---------|--------|
| قراءة | `list_*`، `get_*`، `inspect_media`، `analyze_scenes`، `detect_*`، `review_editing_plan`، `run_skill`، `run_workflow` | بلا موافقة؛ لا تغيّر المشروع. |
| تعديل قابل للتراجع | `split/trim/move_clip`، `set_clip_volume`، `add_text_overlay`، `add_captions`، `apply_effect`، `add_audio_clip`، `import_media`، `undo/redo_edit` | بلا موافقة؛ كل عملية في السجل (`list_edit_history`). |
| تتطلب موافقة | `delete_clip`، `apply_editing_plan`، `export_project`، `create_editing_plan` مع `allowPaidProviders` | عبر MCP elicitation؛ عميل بلا elicitation ⇒ رفض `APPROVAL_DENIED` مع إرشاد. |
| رندر خفيف | `generate_preview` (≤60s، 360p) | بلا موافقة. |

إذا كان عميلك لا يدعم elicitation وتريد السماح للوكيل بالتصدير، اضبط
`MONTAGE_MCP_APPROVAL=auto` في إعداد الخادم — هذا قرارك أنت، لا يستطيع النموذج تغييره.

## دورة حياة الاتصال

1. العميل يشغّل `pnpm -s mcp` كعملية فرعية ويُجري `initialize`.
2. الخادم يطبع سطر جاهزية على **stderr** (مساحة العمل، الجذور، سياسة الموافقة).
3. كل استدعاء أداة يُسجَّل في `<workspace>/audit.log` (اسم الأداة، المشروع، النجاح، الرمز، الزمن — بلا محتوى ولا أسرار).
4. الرندر يعمل في الخلفية داخل العملية؛ الحالة دائمة في `renders/<jobId>/status.json`.
   إغلاق العميل ينهي العملية: مهمة كانت جارية تظهر لاحقاً كـ `failed` («توقفت عملية الخادم»)، ولا يُترك مخرَج جزئي.
5. `SIGINT`/`SIGTERM` ⇒ إغلاق نظيف.

## الأدوات (مولَّدة من الخادم الفعلي)

الأعمدة: الاسم، المدخلات (`?` = اختياري)، النوع، الوصف. كل أداة لها `outputSchema`
مهيكل؛ الأخطاء تعود `isError: true` ونصاً آخر سطر فيه JSON:
`{"error":{"code","message","hint"}}` — الرموز: `NOT_FOUND`، `INVALID_INPUT`، `OUT_OF_RANGE`،
`FORBIDDEN_PATH`، `UNSUPPORTED`، `CONFLICT`، `DEPENDENCY_MISSING`، `EXECUTION_FAILED`، `TIMEOUT`،
`CANCELLED`، `APPROVAL_DENIED`، `LIMIT_EXCEEDED`، `NOTHING_TO_UNDO`، `INTERNAL`.

| الأداة | المدخلات | النوع | الوصف |
|--------|----------|-------|-------|
| `list_projects` | — | قراءة | يعرض مشاريع مساحة العمل على الخادم (ليس مشاريع localStorage في المتصفح). |
| `get_project` | `projectId` | قراءة | يعيد حالة المشروع الكاملة (ProjectState) كما سيصدّرها المحرّك. |
| `create_project` | `name` `aspect?` `resolution?` `fps?` | تعديل | ينشئ مشروعاً فارغاً في مساحة العمل. استورد فيديو بعدها عبر import_media. |
| `get_project_status` | `projectId` | قراءة | ملخص: المدة، الأصول، آخر مهام الرندر، الخطط، والسجل — للتخطيط قبل التعديل. |
| `import_media` | `projectId` `path` `name?` | تعديل | ينسخ ملف فيديو/صوت/صورة إلى مشروع بعد التحقق (جذر مسموح، امتداد، حجم، ffprobe). أول فيديو يصبح المصدر الأساسي بمقطع كامل. المسارات خارج جذور الاستيراد تُرفض. |
| `list_media_assets` | `projectId` | قراءة | يعرض الوسائط المستوردة في المشروع. |
| `inspect_media` | `projectId` `assetId` | قراءة | بيانات وصفية حقيقية عبر ffprobe: المدة، الترميز، الأبعاد، fps، الصوت. (يغطي ما كان مقترحاً كـ get_media_metadata.) |
| `analyze_scenes` | `projectId` `assetId?` `threshold?` `minSceneSeconds?` | قراءة | نقاط تغيّر المشهد الحقيقية عبر FFmpeg (select=scene). لا يعدّل المشروع. |
| `detect_silence` | `projectId` `assetId?` `noiseDb?` `minDurationSeconds?` | قراءة | فترات الصمت الحقيقية عبر FFmpeg silencedetect (بزمن المصدر). لا يعدّل المشروع. |
| `detect_beats` | `projectId` `assetId?` `maxSeconds?` | قراءة | بدايات صوتية (onsets) وتقدير BPM من طاقة الصوت الحقيقية (طريقة حسابية بسيطة — راجع confidence). |
| `get_timeline` | `projectId` | قراءة | المسارات والمقاطع بترتيب التصدير، والمدة الناتجة. (المقاطع مغناطيسية: start يُحسب من الترتيب.) |
| `list_tracks` | `projectId` | قراءة | مسارات المشروع مع عدد عناصر كل مسار. |
| `list_clips` | `projectId` `trackId?` | قراءة | مقاطع الفيديو (اختيارياً لمسار واحد) مع نقاط الدخول/الخروج بزمن المصدر وموضعها على التايملاين. |
| `split_clip` | `projectId` `clipId` `atSeconds` | تعديل | يقسم مقطعاً عند زمن على التايملاين إلى مقطعين (قابل للتراجع). |
| `trim_clip` | `projectId` `clipId` `inPoint?` `outPoint?` | تعديل | يغيّر نقطة الدخول و/أو الخروج بزمن المصدر؛ المقاطع اللاحقة تُزاح تلقائياً (قابل للتراجع). |
| `move_clip` | `projectId` `clipId` `toIndex` | تعديل | يغيّر ترتيب مقطع داخل مساره (التايملاين مغناطيسي: الترتيب يحدد الموضع). |
| `delete_clip` | `projectId` `clipId` | مدمّرة (موافقة) | يحذف مقطعاً ويُغلق الفجوة. عملية مدمّرة تتطلب موافقة المستخدم (قابلة للتراجع بعدها). |
| `set_clip_volume` | `projectId` `clipId` `volume` | تعديل | 0 = صامت، 1 = الأصلي، حتى 2. |
| `add_text_overlay` | `projectId` `text` `start` `end` `position?` `color?` `fontSize?` `animation?` | تعديل | نص فوق الفيديو بزمن التايملاين (يُحرق في التصدير عبر ASS). |
| `add_captions` | `projectId` `cues` `lang?` `replace?` | تعديل | أسطر ترجمة بزمن التايملاين (بلا تداخل). replace=true يستبدل الموجود. |
| `apply_effect` | `projectId` `kind` `effectId?` `enabled?` `clipId?` `filter?` | تعديل | kind=project_effect: تأثير يُطبَّق في التصدير على كل المقاطع (تفعيل/تعطيل). kind=color_filter: فلتر لون لمقطع واحد. |
| `add_audio_clip` | `projectId` `assetId` `start?` `volume?` `kind?` | تعديل | يضع أصل صوت مستورداً (موسيقى/تعليق) على مسار الصوت بزمن التايملاين — يُمزج فعلياً في التصدير. |
| `undo_edit` | `projectId` | تعديل | يتراجع عن آخر تعديل (يمكن إعادته عبر redo_edit). |
| `redo_edit` | `projectId` | تعديل | يعيد آخر تعديل تم التراجع عنه. |
| `list_edit_history` | `projectId` | قراءة | العمليات القابلة للتراجع/الإعادة (الأحدث أولاً، حتى 50). |
| `list_skills` | `category?` | قراءة | كتالوج مهارات lib/skills. المهارات تُنتج اقتراحات/حسابات ولا تعدّل المشروع؛ بعضها يعتمد بدائل محاكاة عند غياب تحليل حقيقي — راجع provenance في run_skill. |
| `run_skill` | `skill` `projectId?` `useRealAnalysis?` `document?` | قراءة | يشغّل مهارة واحدة على مستند مبني من المشروع (المدة الحقيقية؛ وصمت/مشاهد حقيقية إن useRealAnalysis). لا يعدّل المشروع. provenance=simulated يعني نتيجة غير مبنية على تحليل حقيقي. |
| `list_workflows` | — | قراءة | مسارات المهارات المسجّلة وخطواتها. |
| `run_workflow` | `workflow` `projectId?` `useRealAnalysis?` `document?` | قراءة | يشغّل مسار مهارات كاملاً ويعيد ناتج كل خطوة مع provenance. لا يعدّل المشروع — لتعديل التايملاين استخدم أدوات التايملاين أو الخطط. |
| `create_editing_plan` | `projectId` `request` `language?` `aspect?` `mood?` `allowPaidProviders?` | تعديل | يشغّل مسار الوكلاء (Analyst → Director → Critic → Audio) على فيديو المشروع ويحفظ خطة EDL. لا يغيّر المشروع. افتراضياً بلا مزوّدات مدفوعة (المفاتيح تُزال من البيئة)؛ allowPaidProviders=true يتطلب موافقة المستخدم. |
| `review_editing_plan` | `projectId` `planId` | قراءة | يتحقق من الخطة مقابل المصدر الحالي ويلخّص التغييرات المتوقعة قبل التطبيق. |
| `apply_editing_plan` | `projectId` `planId` | مدمّرة (موافقة) | يطبّق خطة مراجَعة على التايملاين (مقاطع + ترجمات + نصوص) كعملية واحدة قابلة للتراجع — يتطلب موافقة المستخدم. |
| `generate_preview` | `projectId` `start?` `end?` `wait?` | تعديل | رندر منخفض الدقة (360p، حتى 60s) لنافذة من التايملاين. wait=true ينتظر الانتهاء (حتى 120s). |
| `export_project` | `projectId` `wait?` | تعديل | تصدير كامل بالإعدادات (الدقة/الصيغة/الجودة) — مكلف زمنياً ويتطلب موافقة المستخدم. يعمل في الخلفية: تابع عبر get_render_status. النجاح = status=completed فقط (بعد مراجعة ffprobe). |
| `get_render_status` | `projectId` `jobId?` | قراءة | حالة مهمة معاينة/تصدير (أو آخر المهام إن لم يُحدَّد jobId). |
| `cancel_render` | `projectId` `jobId` | تعديل | يوقف مهمة جارية ويحذف المخرَج الجزئي. |
| `validate_render` | `projectId` `jobId` | تعديل | يعيد فحص ملف المخرَج: ffprobe (مدة/مسارات/أبعاد) + blackdetect + volumedetect. |

ملاحظة: الأداة المقترحة `get_media_metadata` مدمجة في `inspect_media` (نفس العملية — تجنّب التكرار).

## سير عمل نموذجي لوكيل

```text
create_project → import_media(path) → inspect_media → detect_silence / analyze_scenes
→ create_editing_plan(request) → review_editing_plan  ← اعرض التغييرات على المستخدم
→ apply_editing_plan (موافقة) → generate_preview → export_project (موافقة)
→ get_render_status حتى completed → validate_render
```

قواعد للوكيل: لا تعرض خطة كتعديل منجز؛ لا تعلن نجاح تصدير إلا عند `status=completed`
و`review.passed=true`؛ `provenance=simulated` في نتائج المهارات يعني بيانات تقديرية.

## أدوات مخصّصة (بلا تعديل الخادم)

أدوات يضيفها المالك من `/extensions` (أو `pnpm ext install`) تظهر لعميلك باسم `ext_<id>` بعد تفعيلها وبعد منح صلاحياتها.
- **التحديث:** الخادم يفحص السجل كل ~2ث ويرسل `notifications/tools/list_changed`. العملاء الداعمون لـ listChanged يحدّثون القائمة تلقائياً؛ غيرهم يعيدون الاتصال أو يستدعون `tools/list` من جديد. لفرض المزامنة: أداة `refresh_custom_tools`.
- `list_custom_tools` تعرض المكشوف فعلاً والمتخطّى وسببه. الصلاحيات تُفحص عند كل استدعاء؛ الكاتبة/المكلفة تطلب موافقة (elicitation).
- التفاصيل والأمان: `docs/EXTENSIONS.md`.

## فتح مشاريع MCP في المحرّر

المحرّر (`pnpm dev`) يقرأ مساحة العمل نفسها: «المشاريع» ← «مساحة العمل على الخادم».
الحفظ من المحرّر يكتب إلى المشروع كعملية `ui_save` قابلة للتراجع عبر `undo_edit`.
شغّل الاثنين بنفس `MONTAGE_WORKSPACE` (أو الافتراضي من جذر المستودع).

## استكشاف الأخطاء

| العَرَض | السبب والحل |
|---------|-------------|
| العميل لا يرى أدوات / «unexpected token» | شيء يكتب على stdout: استخدم `pnpm -s`، ولا تضف `console.log` في الشيفرة المشتركة. |
| `FORBIDDEN_PATH` عند الاستيراد | الملف خارج `MONTAGE_MEDIA_ROOTS` و`inbox` (أو رابط رمزي يشير للخارج). |
| `DEPENDENCY_MISSING` | FFmpeg/FFprobe غير موجود، أو حزم Python لأدوات الخطط. |
| `APPROVAL_DENIED` | العميل لا يدعم elicitation أو رفض المستخدم — راجع «الصلاحيات». |
| `UNSUPPORTED` عند التصدير | مقاطع من أكثر من مصدر فيديو (غير مدعوم بعد). |
