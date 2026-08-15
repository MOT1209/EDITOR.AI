# مسار المونتاج المتعدد الوكلاء (Multi-Agent Pipeline)

وحدة Python داخل مشروع **EDITOR.AI** — شبكة وكلاء تقودها **المديرة التنفيذية (CEO Agent)**
وتنتج خطة قص (EDL) لمحتوى السوشال ميديا العمودي القصير. تعمل **إلى جانب** تطبيق
Next.js الحالي وتشاركه عقد الخطة نفسه (camelCase مطابق لـ `lib/agents/types.ts`).

```
src/
├── main.py                  # نقطة دخول CLI
├── requirements.txt
└── agents/
    ├── __init__.py          # يسجّل الوكلاء تلقائياً
    ├── registry.py          # سجل الوكلاء (فصل الإشراف عن التنفيذ)
    ├── edl_schema.py        # مخطط EDL الموحّد (Pydantic) — العقد المشترك
    ├── validation.py        # بوابات الجودة بين المراحل
    ├── ceo_agent.py         # المديرة التنفيذية — إشراف وتنسيق
    ├── analyst_agent.py     # المحلل — ffmpeg حقيقي + سكون/سواد (auto-editor) + نقاط توسعة
    ├── director_agent.py    # المخرج — EDL عبر LLM هرمي + خطة قواعد + طبقات جلوسة + B-Roll + ترجمات
    ├── critic_agent.py      # الناقد الإبداعي — درجة 0-100 + حكم approve/revise + حلقة مراجعة
    ├── audio_agent.py       # مهندس الصوت — خطة موسيقى + Ducking + مؤثرات + LUFS (حتمي)
    ├── render_agent.py      # الرندر — كشف GPU حقيقي + بناء أوامر ffmpeg
    ├── auto_editor_utils.py # غلاف ثنائية auto-editor (اختياري) + احتياطات ffmpeg
    └── export_nle.py        # تصدير EDL إلى برامج المونتاج (Premiere/Resolve/Shotcut/...)
```

## التشغيل

```bash
pip install -r src/requirements.txt          # Python 3.10–3.13 موصى به (مع crewai + litellm)
python -m src.main video.mp4 --request "فيديو حماسي قصير مع ترجمة" --mood "قوي"
python -m src.main video.mp4 --demo          # ترجمات تجريبية بلا Whisper
python -m src.main video.mp4 --no-broll      # تعطيل جلب Pexels
CREWAI_PROCESS=sequential python -m src.main video.mp4   # توفير رموز المزود
```

**auto-editor (اختياري — يُحسّن التحليل ويفعّل تصدير NLE):**

```bash
python scripts/install-auto-editor.py        # يُنزّل الثنائية إلى .montage_ai/bin/ (من git)
python -m src.export_nle video.mp4 premiere plan.json -o out.xml   # تصدير مباشر
```

بثنائية auto-editor تُضاف: فترات السكون (`motion_spans`) والإطارات السوداء
(`black_spans`) في تقرير المحلل، وطبقات الجلوسة الحتمية في خطة المخرج (قصّ/
عادي/سريع)، والتصدير لبرامج المونتاج. بلا الثنائية تتولى احتياطات ffmpeg
(`freezedetect`/`blackdetect`/`silencedetect`) ما أمكن — التدهور أنيق دائماً.

التهيئة تُقرأ من `.env.local` (نفس عرف المشروع):
`OPENCODE_API_KEY` + `OPENCODE_BASE_URL` + `OPENCODE_MODEL` (افتراضي:
Groq llama-3.3-70b-versatile)، `PEXELS_API_KEY` لـ B-Roll، `FFMPEG_PATH`،
`AUTO_EDITOR_PATH` (مسار ثابت للثنائية).

**عملية المرحلة الإبداعية**: `CREWAI_PROCESS` — الافتراضي `hierarchical`
(المديرة التنفيذية تُفوّض وتُراجع عبر `Process.hierarchical`). نافذة TPM
المجانية في Groq (12k/دقيقة) قد لا تتسع لاستدعاءات المديرة المتعددة، فيتدهور
المسار **تلقائياً** إلى `sequential` (يبقى LLM) ثم القواعد المحلية آخر خط
دفاع. `sequential` الصريح يوفّر الرموز من البداية.

كل مخرجات المراحل تُحفظ في `.montage_ai/pipeline/<job_id>/` (`analyst.json`,
`director.json`, `critic.json`, `audio.json`, `edl.json`, `render.json`,
`manifest.json`) — أي فشل يُشخَّص
من الملفات دون إعادة تشغيل المسار.

## لماذا CrewAI (وليس LangGraph)

- **مطابقة للمتطلب**: `Process.hierarchical` بمديرة (CEO) تفوّض وتُراجع — جاهزة.
- **بوابات الجودة**: CrewAI لا يملك آلية إيقاف تقدم المهام عند رفض مُخرَج، لذا
  أضفنا البوابات ككود بين المراحل (تحقق + تصحيح محدود + تغذية أخطاء رجوعاً)
  — وهي مستقلة تماماً عن CrewAI فتبقى صالحة لو استُبدل بالإطار لاحقاً.
- LangGraph يمنح تحكماً أدق (دوّارات/نقاط تفتيش) لكنه يستلزم إطاراً ثانياً
  وفوقية إضافية؛ CrewAI يكفي لمرحلة الإبداع (EDL) بينما تبقى مراحل التحليل
  والرندر **برمجية** (أسرع وأدق بلا LLM).

## التدهور الأنيق (لا يتعطل بلا مفتاح)

| الشرط | السلوك |
|-------|--------|
| بلا `crewai` أو بلا LLM | المخرج ينتج خطة قواعد محلية (قص الصمت + ترجمة + موسيقى) |
| حد معدل المزود (TPM) في `hierarchical` | تدهور تلقائي إلى `sequential` ثم قواعد محلية |
| فشل استجابة LLM | نفس الرجوع مع تسجيل السبب |
| بلا `PEXELS_API_KEY` | الاقتراحات تُبقى ككلمات مفتاحية (المخطط يسمح بلا أصل) |
| بلا auto-editor | سكون/سواد/طبقات تُستكمل باحتياط ffmpeg؛ التصدير NLE يعيد 503 بإرشاد التثبيت |
| لا GPU (NVENC) | فحص تشفير حقيقي ثم libx264 تلقائياً |

## خارطة إكمال الوكلاء (بلا تعديل CEO)

| المرحلة | الحالة | التنفيذ المطلوب |
|---------|--------|-----------------|
| `analyst_agent` | صمت/فحص المصدر ✓ | Whisper word-level، Diarization، MediaPipe (نقاط التوسعة موثقة) |
| `director_agent` | EDL + ترجمات + B-Roll ✓ | ضبط البرومبت/المخطط حسب الحاجة |
| `critic_agent` | درجة إبداعية 0-100 + حكم ✓ | حلقة مراجعة مع المخرج (LLM يستجيب للملاحظات) |
| `audio_agent` | خطة موسيقى + Ducking + LUFS ✓ | دمج المسار الموسيقي في أمر الرندر لاحقاً |
| `render_agent` | أمر ffmpeg + كشف GPU ✓ | تنفيذ الرندر الفعلي (`RenderAgent.render`) |

أي وكيل جديد: عرّف صنفه + `@register_agent("name")` + بوابة في
`validation.STAGE_VALIDATORS` — تنتهي المهمة بلا لمس `ceo_agent.py`.
