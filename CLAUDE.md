# CLAUDE.md — دليل Claude Code لمشروع EDITOR.AI (MontageAI)

منصة مونتاج فيديو + إنشاء محتوى بالذكاء الاصطناعي، واجهة عربية، تشغيل محلي أولاً.

## المعمارية (طبقة واحدة لكل سطر)

- **الواجهة**: Next.js 14 (App Router, TypeScript) — `app/`, `components/editor/*`, `components/shorts/*`.
- **مسارات API**: `app/api/*` — `ai/*` (ذكاء توليدي، بعضها مدفوع)، `agents/*` (تشغيل مسار Python)، `export/*`, `ffmpeg/*`, `skills/*`.
- **مسار الوكلاء (Python)**: `src/agents/*` — CEO → Analyst → Director → Critic → Audio → Render، مع بوابات جودة (`validation.py`).
- **نظام المهارات (TS)**: `lib/skills/*` — `BaseSkill` + `SkillManager` + `Workflow` + كتالوج (43 مهارة) + workflows (`default`, `viral-shorts`, `content-from-idea`).
- **العقد المشترك**: مخطط EDL موجود بلغتين — `src/agents/edl_schema.py` (Pydantic) ↔ `lib/agents/types.ts` (TypeScript).

## الأوامر (نسخ-لصق)

```bash
pnpm dev                          # خادم التطوير (المنفذ 3000)
npx tsc --noEmit                  # فحص أنواع TypeScript
npm test                          # اختبارات الواجهة (Vitest)
node scripts/check-contract.ts    # تطابق عقد EDL (Python ↔ TS) — 60 فحصاً
python -m pytest                  # اختبارات مسار الوكلاء (32 حالة)
python -m src.main test_video.mp4 --demo   # تشغيل المسار كاملاً بلا مفاتيح
```

CI (`.github/workflows/ci.yml`) يشغّل: py_compile + pytest + tsc + Vitest + check-contract + gitleaks على كل push إلى main.

## المبادئ التي لا تُنتهك

1. **التدهور الأنيق إلزامي**: بلا مفتاح/حزمة/GPU/شبكة → المسار لا ينهار أبداً، بل يعطي بديلاً محلياً أو نتيجة فارغة + تحذير.
2. **البوابات مستقلة عن CrewAI** (`src/agents/validation.py`) — كود نقي صالح لو استُبدل الإطار.
3. **عقد EDL موحّد**: أي تغيير في `edl_schema.py` يُطبَّق في `lib/agents/types.ts` **معاً**، ثم `node scripts/check-contract.ts` يجب أن يمرّ (Python superset مسموح).
4. **حماية المفاتيح**: لا أسرار في git. المفاتيح تُقرأ عبر `lib/server/api-keys.ts` (header ثم env). `.env.local`/`.montage_ai`/`.venv` مستثناة.
5. **عربية كل الواجهات والتوثيق** (المستخدم النهائي عربي).

## أعراف إلزامية عند التعديل

- **ضابط التكلفة**: أي مسار API يستدعي مزوّداً مدفوعاً (chat/vision/whisper/tts) يجب أن يمرّ عبر `guardCost` + `recordSpend` من `lib/server/cost-guard.ts` قبل/بعد الاستدعاء (النمط في `app/api/ai/tts/route.ts`). النظير في Python: `BudgetTracker` في `src/agents/utils.py`.
- **تحقق المدخلات**: الملفات المرفوعة عبر `validateVideoUpload`/`validateAudioUpload`، والحقول عبر `clampString`/`pickEnum` من `lib/server/validate.ts`.
- **مراجعة ما بعد الرندر**: أي تغيير في الرندر يجب أن يبقى متوافقاً مع `src/agents/render_review.py` (المدمج في بوابة `validate_render`).
- **إضافة مهارة فيديو**: اتبع `lib/skills/README.md` — ملف في `catalog/` + تسجيل في `catalog/index.ts` + اختبار في `lib/skills/skills.test.ts`.
- **لا تذكر أي معرّف نموذج** (Sonnet/Opus/gpt-...) في أي التزام أو كود أو PR — يبقى في المحادثة فقط.

## مهارات التطوير الجاهزة (`.claude/skills/`)

- `add-video-skill` — سقالة مهارة فيديو جديدة بنمط BaseSkill.
- `edl-contract-change` — تغيير عقد EDL بأمان على الجانبين.
- `add-ai-route` — سقالة مسار API موصول بضابط التكلفة والتحقق.

## اختبار التغييرات (قبل أي التزام)

شغّل: `npx tsc --noEmit` + `npm test` + `node scripts/check-contract.ts` + `python -m pytest` — كلها يجب أن تنجح. لتغييرات الواجهة، اختبرها بصرياً عبر `pnpm dev` (فحص الأنواع لا يثبت صحة الميزة).
