# 🎬 خطة تطوير EDITOR.AI — نظام المونتاج متعدد الوكلاء

> مستند عمل: الفحص الشامل (MONTAJI_REPORT.html) + هذه الخطة التنفيذية.
> المرجع: التزام `54cf36b` — مسار Python `src/agents/` + وكيل المديرة في Next.js.

---

## ملخص الوضع الحالي (ما يعمل اليوم)

| الجبهة | الحالة |
|--------|--------|
| Next.js 14 (Editor + وكيل المديرة) | ✅ tsc نظيف، تتصدير ثابت |
| مسار Python متعدد الوكلاء | ✅ 2185 سطراً، يعمل بالكامل مع تدهور أنيق |
| خطة EDL عبر LLM (CrewAI/Groq) | ✅ «فيديو حماسي» — قص صمت حقيقي + تسريع/إبطاء + crop 9:16 |
| البوابات + الأدلة التشخيصية | ✅ 3 بوابات، حفظ في `.montage_ai/pipeline/` |
| الأمان (مفاتيح) | ✅ 0 ملفات حساسة في git، فحص ثلاثي |

---

## المرحلة 1 — إكمال الممرات المعلّقة (الأولوية القصوى)

### 1.1 Whisper كلمة-بكلمة في `analyst_agent.py`
- **الهدف:** استبدال `NotImplementedError` في `transcribe_word_level` بتفريغ حقيقي.
- **الخيار A (الأسرع):** Groq API — `whisper-large-v3-turbo` بالمفتاح الموجود (OPENCODE_*). `httpx` جاهز.
- **الخيار B (الأوفلاين):** `faster-whisper` (pip، يعمل على CPU بدون GPU).
- **التسليم:** `AnalystReport.transcription.words[]` مملوء بتوقيتات كلمة-بكلمة؛ إزالة `_demo_words`.
- **معيار النجاح:** `python -m src.main test_video.mp4` ينتج ترجمات من الصوت الفعلي (لا ديمو).

### 1.2 الرندر الفعلي في `render_agent.py`
- **الهدف:** تنفيذ `build_command()` عبر `subprocess` بدل رفعه فقط.
- **الخطوات:**
  1. ترندير كل مقطع KEEP في ملف وسيط (`-ss/-to` + zoompan + ASS).
  2. `concat` demuxer للدمج + `afftdn` + `loudnorm` (ضبط الصوت إلزامي).
  3. رفع النتيجة لبوابة `validate_render` ثم للمدير.
- **التسليم:** `render.json` + ملف فيديو نهائي في `.montage_ai/output/<job_id>/final.mp4`.
- **معيار النجاح:** خرج 9:16 صالح بـ libx264 + AAC، يعمل في أي مشغل.

### 1.3 ربط المسار بواجهة Next.js
- **الخيار A (مباشر):** `app/api/agents/pipeline/route.ts` — `child_process.spawn` لـ `.venv/Scripts/python -m src.main` مع تمرير الملف المرفوع.
- **الخيار B (أنظف):** FastAPI مصغر (`src/server_api.py`) والـ route يوكيل إليه.
- **التسليم:** زر «المسار الكامل» في Editor يعرض: تقرير التحليل → الخطة (قبل التصدير) → تأكيد المستخدم → رندر.
- **ملاحظة:** يعالج السؤال المعلّق «عارض الخطة مقابل التصدير المباشر» لصالح عارض الخطة.

---

## المرحلة 2 — ذكاء إضافي (متوسطة)

> حالة 2026-08: **اكتمل تنفيذ المرحلة 2 في ملفات المدير/الملفات المساعدة** + استعادة ملفات الصوت/الناقد.
> 🔴 ملاحظة أمان للمستودع: وكيل Claude Code آخر يعمل على نفس المستودع — افحص `git status` قبل أي خطوة؛
>   قد يكون أنشأ `audio_agent`/`critic_agent` ثم أزالها عبر `git clean` (استُعيدت من __pycache__ — راجع الأسفل).

### 2.1 تتبع الوجه → crop ذكي ✅ (تم)
- MediaPipe/OpenCV عبر `track_faces` (تنفيذ الوكيل الموازي في analyst_agent)؛ المخرج يستهلكها الآن:
  - `DirectorAgent._apply_face_tracks()` — يحرّك `centerX/centerY` نحو الوجه مع استيفاء + تنعيم EMA لمنع القفزات.
  - البرومبت يُغذّى بمسارات الوجه (قاعدة 4 ذكية: اقترب من مركز الوجه إن وُجد).
  - بلا وجوه: يبقى المركز الافتراضي (0.5, 0.42) — سلوك سابق دون تغيير.

### 2.2 تمييز المتحدثين → تلوين الترجمات ✅ (تم)
- `identify_speakers` (الوكيل الموازي: pyannote + بديل صمت منيع)؛ المخرج يوسم الآن:
  - `CaptionLine.speaker: Optional[str]` أُضيف لعقد EDL (Python) — اختياري بلا كسر للقديم.
  - `DirectorAgent._annotate_speakers()` — يربط كل سطر ترجمة بمتحدثه (أقصى تغطية زمنية).

### 2.3 ترقية المزود للهرمية الكاملة ✅ (تم)
- `utils.build_llm_model(base_url, model)` — موجّه بادئات موحّد (groq/، openrouter/، openai/، anthropic/، gemini/).
- تبديل `OPENCODE_BASE_URL` إلى Dev Tier/مزوّد آخر بلا تغيير كود (الموديل ببادئة صريحة يُترك كما هو).
- ملاحظة: ceo_agent يحمل نسخته الخاصة من المنطق — توحيده نحو utils مرغوب بعد اكتمال الوكيل الموازي.

### الاختبار
- `src/tests/test_phase2.py` — 4/4 ناجحة بمعزل عن الحزمة المكسورة مؤقتاً (يتجاوز `__init__.py`):
  موجّه المزود (5 حالات)، قص يتبع الوجه (مراكز متحركة 0.3→0.46→0.36 مع EMA)، تلوين المتحدثين، تدهور أنيق بلا بيانات.
- مسار كامل حي (--demo): analyst → director → render → final.mp4 720×1280 h264 (18.3s) — أدلة كاملة في .montage_ai/pipeline/.

### استعادة ملفات الوكيل الموازي (2026-08)
- `audio_agent.py` + `critic_agent.py` (نماذج AudioPlan/CritiqueReport + الوكيلان الحتميان) أُنشئا من قبل الوكيل
  الآخر ثم أُزيلا (git clean) — استُعيدا بلا فقدان من `__pycache__/*.cpython-310.pyc` عبر `marshal` + `dis`
  (البنية والثوابت مطابقة، والمقارنة بـ cpython-314 أكّدت التطابق الوظيفي).
- ملاحظة: نسخة 3.14 الأحدث أسقطت معامل `plan` من `_find_local_music` دون تحديث الاستدعاء (خطأ كامن) —
  أبقينا توقيع 3.10 المتّسق مع موقع الاستدعاء.

---

## المرحلة 3 — جودة وهندسة (مستمرة)

### ✅ منجز
- **pytest**: 9 حالات (4 موجه/وجه/متحدثين + 5 ناقد/صوت) — `pytest.ini` + `python -m pytest` (1 ثانية محلياً)
- **CI (GitHub Actions)**: `.github/workflows/ci.yml` — py_compile + pytest + tsc + فحص العقد + gitleaks على كل push
- **إصلاح أداء جذري**: استيراد pyannote.audio أصبح كسولاً (كان يسحب lightning/torchcodec ~145s لكل استيراد → أصبح 1.2s)

| البند | الوصف | الأثر |
|-------|-------|-------|
| **pytest** | 20+ حالة: `normalize_plan` (تداخل/فجوات/سقف 60/تسامح camelCase)، البوابات، `extract_json` | يمنع تكرار خطأ «المثال الـ19» |
| **CI (GitHub Actions)** | py_compile + pytest + tsc + gitleaks على كل push | جودة مستمرة + حارس أسرار |
| **معالجة متوازية** | ThreadPool لترندير المقاطع + كاش NVENC/probe | 2–4x تسريع |
| **لوحة تشخيص HTML** | عرض أدلة pipeline بملخص ملون | تصحيح أسرع |
| **توثيق القرارات** | `docs/decisions/` (ADR) لكل خيار معماري | قابلية صيانة |

---

## المرحلة 4 — تكامل auto-editor (WyattBlue) ✅ (تم)

> دمج ثنائية **auto-editor** (Nim CLI، ترخيص Unlicense) بنمط هجين: استدعاء الباينري
> للتحليل والتصدير، واحتياطات ffmpeg عند غيابه — التدهور أنيق دائماً (مبدأ 1).

### الإضافات
- **`scripts/install-auto-editor.py`** — تنزيل متعدد المنصات من GitHub Releases إلى
  `.montage_ai/bin/` (مستثنى من git)؛ `--force` و`--version` (افتراضي latest).
- **`src/agents/utils.py::resolve_auto_editor()`** — ترتيب الكشف: `AUTO_EDITOR_PATH`
  ← `.montage_ai/bin/` ← `PATH`؛ يرجع `None` عند الغياب (بخلاف ffmpeg الإلزامي).
- **`src/agents/auto_editor_utils.py`** — الغلاف + الاحتياطات:
  - `detect_motion_spans` (سكون) / `detect_black_spans` (سواد) عبر `--edit` + قراءة v3؛
    الاحتياط: `freezedetect` / `blackdetect`.
  - `loudness_tiers` (طبقات قصّ/عادي/سريع عبر `--edit:N/--when:N`)؛
    الاحتياط: عتبتا `silencedetect` (−30dB/−12dB).
  - `edl_to_cut_ranges` (بناء `--cut` بالإطارات) + `preview_stats` (حتمية بلا ثنائية).
- **العقد (مبدأ 3):** `AnalystReport.motion_spans/black_spans` في `edl_schema.py` +
  `AnalystReport` (مع `WordTiming`/`SilenceSpan`/`SpeakerSegment`/`FaceTrack`) في
  `lib/agents/types.ts` + تسجيله في `scripts/check-contract.ts` (60 فحصاً متطابقاً).
- **المخرج:** `_apply_loudness_tiers()` حتمية في `_rule_based_plan` (الصاخب ≥−12dB
  يُسرَّع 1.3×) + تغذية البرومبت بفترات السكون/السواد (قاعدة 6).
- **التصدير NLE:** `src/export_nle.py` + `app/api/agents/export/route.ts` +
  زر «تصدير NLE» في مودال المسار (Premiere/Resolve/Shotcut/Kdenlive/FCP) —
  غياب الثنائية يعيد 503 بإرشاد التثبيت.
- **معاينة القص:** `PipelineResult.preview_stats` + `previewStats` في استجابة pipeline
  + عرضها في مودال المسار (محتفظ به / مقصّ / نسبة / مقاطع).
- **الاختبارات:** `src/tests/test_auto_editor.py` (14 حالة: v3، طبقات، سكون/سواد
  بثنائية مقلَّدة، `--cut`، معاينة، تكامل المخرج) — 23/23 ناجحة مع الحالية.

### التشغيل
```bash
python scripts/install-auto-editor.py      # تثبيت اختياري للثنائية (~44MB)
python -m pytest src/tests                 # 23 حالة (بلا ثنائية مضمونة أيضاً)
```

---

## المبادئ الثابتة (لا تُنتهك)

1. **التدهور الأنيق إلزامي:** بلا crewai/LLM/Pexels/GPU → المسار لا ينهار أبداً.
2. **البوابات مستقلة عن CrewAI** (كود نقي) — صالحة لو استُبدل الإطار.
3. **مخطط EDL موحّد** (Pydantic camelCase ↔ TypeScript) — أي تغيير في العقد يُطبَّق في الملفين معاً.
4. **حماية المفاتيح:** فحص staged diff قبل كل التزام؛ `.env.local`/`.montage_ai`/`.venv` مستثناة.
5. **عربية كل الواجهات والتوثيق** (المستخدم النهائي عربي).

---

## الجدول الزمني التقديري

| المرحلة | المدة | المخرجات |
|---------|-------|----------|
| 1.1 Whisper | ½ يوم | ترجمات حقيقية كلمة-بكلمة |
| 1.2 رندر | ½ يوم | فيديو نهائي كامل |
| 1.3 ربط الواجهة | 1 يوم | تشغيل من المتصفح + عارض خطة |
| 2.x الذكاء | 2–3 أيام | crop يتبع الوجه + متحدثون ملوّنون |
| 3.x الجودة | مستمر | CI + اختبارات + لوحة تشخيص |

**المجموع للنسخة «منتج كامل»:** ~4–5 أيام عمل.
