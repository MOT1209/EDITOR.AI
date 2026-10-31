# CLAUDE.md — دليل Claude Code لمشروع EDITOR.AI (MontageAI)

منصة مونتاج فيديو + إنشاء محتوى بالذكاء الاصطناعي، واجهة عربية، تشغيل محلي أولاً.

## المعمارية (طبقة واحدة لكل سطر)

- **الواجهة**: Next.js 14 (App Router, TypeScript) — `app/`, `components/editor/*`, `components/shorts/*`.
- **مسارات API**: `app/api/*` — `ai/*` (ذكاء توليدي، بعضها مدفوع)، `agents/*` (تشغيل مسار Python)، `export/*`, `ffmpeg/*`, `skills/*`.
- **مسار الوكلاء (Python)**: `src/agents/*` — CEO → Analyst → Director → Critic → Audio → Render، مع بوابات جودة (`validation.py`).
- **نظام المهارات (TS)**: `lib/skills/*` — `BaseSkill` + `SkillManager` + `Workflow` + كتالوج (43 مهارة) + workflows (`default`, `viral-shorts`, `content-from-idea`).
- **العقد المشترك**: مخطط EDL موجود بلغتين — `src/agents/edl_schema.py` (Pydantic) ↔ `lib/agents/types.ts` (TypeScript).
- **محرّك المشروع**: `lib/engine/*` — مخطط `ProjectState` (نسخة 2)، عمليات تايملاين نقية (قص/تقسيم/دمج/نقل بين مسارات/التصاق)، مساحة عمل على الخادم مع undo/redo، تحليل FFmpeg، جسر خطط Python.
- **الرندر متعدد المسارات**: `lib/engine/render-plan.ts` (خطة متحقَّقة) → `render-compile.ts` (ffmpeg) → `lib/server/ffmpeg-export.ts` (مشغّل)؛ `needsCompositor()` يفرّق بينه وبين المسار القديم. الدلالات والتفاوتات والمحظورات في `docs/RENDERING.md`. رفع الوسائط: `/api/assets/upload` (مراجع معتمة `upload:<uuid>`).
- **واجهة المحرّر**: `components/editor/{timeline,inspector,media-library}.tsx` — كل أداة تستدعي عملية من `lib/engine/timeline.ts` عبر `COMMIT_PROJECT` (تدخل التراجع). لا عنصر بلا وظيفة؛ ما لا يُدعم (keyframes) يُذكر نصاً.
- **الإضافات**: `lib/extensions/*` + `mcp/custom-tools.ts` — مهارات وأدوات MCP مخصّصة من سجل دائم (حزم بيانات، سجل إجراءات معتمد، صلاحيات ممنوحة، قدرات مضيف `capabilities`، إصدارات/تراجع، فهرس اكتشاف محلي)، واجهة `/extensions`، `docs/EXTENSIONS.md` و`docs/SKILLS_PLATFORM.md`.
- **خادم MCP**: `mcp/*` (stdio، SDK الرسمي، 37 أداة مدمجة + أدوات مخصّصة ديناميكية `ext_*`) — `docs/MCP_SETUP.md` و`docs/architecture/MCP_ARCHITECTURE.md`.

## الأوامر (نسخ-لصق)

```bash
pnpm dev                          # خادم التطوير (المنفذ 3000)
npx tsc --noEmit                  # فحص أنواع TypeScript
npm test                          # اختبارات الواجهة (Vitest)
node scripts/check-contract.ts    # تطابق عقد EDL (Python ↔ TS) — 60 فحصاً
python -m pytest                  # اختبارات مسار الوكلاء (36 حالة)
python -m src.main test_video.mp4 --demo   # تشغيل المسار كاملاً بلا مفاتيح
pnpm lint                         # ESLint
pnpm mcp                          # خادم MCP (stdio)
pnpm mcp:e2e                      # E2E حقيقي لخادم MCP على test_assets/test_video.mp4 (يشمل أداة مخصّصة ديناميكية)
pnpm ext validate <مجلد|ملف>      # فحص/تثبيت/تصدير حزم الإضافات (انظر docs/EXTENSIONS.md)
pnpm build                        # بناء الإنتاج
```

CI (`.github/workflows/ci.yml`) يشغّل: py_compile + pytest + tsc + lint + Vitest (مع FFmpeg) + check-contract + E2E MCP + build + gitleaks على كل push/PR إلى main.

## المبادئ التي لا تُنتهك

1. **التدهور الأنيق إلزامي**: بلا مفتاح/حزمة/GPU/شبكة → المسار لا ينهار أبداً، بل يعطي بديلاً محلياً أو نتيجة فارغة + تحذير.
2. **البوابات مستقلة عن CrewAI** (`src/agents/validation.py`) — كود نقي صالح لو استُبدل الإطار.
3. **عقد EDL موحّد**: أي تغيير في `edl_schema.py` يُطبَّق في `lib/agents/types.ts` **معاً**، ثم `node scripts/check-contract.ts` يجب أن يمرّ (Python superset مسموح).
4. **حماية المفاتيح**: لا أسرار في git. المفاتيح تُقرأ عبر `lib/server/api-keys.ts` (header ثم env). `.env.local`/`.montage_ai`/`.venv` مستثناة.
5. **عربية كل الواجهات والتوثيق** (المستخدم النهائي عربي).
6. **لا نتائج مُختلقة**: البديل التقديري يُوسم `simulated: true` + `warning` (الواجهة تعرضه تلقائياً عبر `apiFetch`)؛ الرندر لا يُعلن ناجحاً إلا بملف يجتاز المراجعة.
7. **منطق التعديل مصدره واحد**: `lib/engine/timeline.ts` يستخدمه المحرّر وMCP معاً.

## أعراف إلزامية عند التعديل

- **ضابط التكلفة**: أي مسار API يستدعي مزوّداً مدفوعاً (chat/vision/whisper/tts) يجب أن يمرّ عبر `guardCost` + `recordSpend` من `lib/server/cost-guard.ts` قبل/بعد الاستدعاء (النمط في `app/api/ai/tts/route.ts`). النظير في Python: `BudgetTracker` في `src/agents/utils.py`.
- **تحقق المدخلات**: الملفات المرفوعة عبر `validateVideoUpload`/`validateAudioUpload`، والحقول عبر `clampString`/`pickEnum` من `lib/server/validate.ts`.
- **مراجعة ما بعد الرندر**: أي تغيير في الرندر يجب أن يبقى متوافقاً مع `src/agents/render_review.py` (المدمج في بوابة `validate_render`) ونظيره في TS `reviewRender` (`lib/engine/media.ts`).
- **إضافة مخصّصة (مهارة/أداة) بلا تعديل النواة**: حزمة في `/extensions` أو `pnpm ext install` — لا تعدّل `mcp/server.ts`. إجراء إعلاني جديد = إدخال في `lib/extensions/actions.ts` (مخطط + صلاحيات + خطورة)، إدخال أصلي = `lib/extensions/native.ts`؛ ولا تُضف قدرة shell/FFmpeg حرة/ملفات/شبكة لأي إجراء.
- **أداة MCP مدمجة جديدة**: `tool(...)` في `mcp/server.ts` بمخطط مدخلات/مخرجات Zod، منطق في `lib/engine/*`، أخطاء `EngineError`، `requireApproval` للمكلف/المدمّر، واختبار في `mcp/server.test.ts`.
- **حدود الملفات**: أي مسار من عميل يمر عبر `isPathInside` ومعرّفات `assertId`؛ لا وسائط ffmpeg من المدخلات — تُبنى في `buildExportPlan`.
- **إضافة مهارة فيديو**: اتبع `lib/skills/README.md` — ملف في `catalog/` + تسجيل في `catalog/index.ts` + اختبار في `lib/skills/skills.test.ts`.
- **لا تذكر أي معرّف نموذج** (Sonnet/Opus/gpt-...) في أي التزام أو كود أو PR — يبقى في المحادثة فقط.

## مهارات التطوير الجاهزة (`.claude/skills/`)

- `add-video-skill` — سقالة مهارة فيديو جديدة بنمط BaseSkill.
- `edl-contract-change` — تغيير عقد EDL بأمان على الجانبين.
- `add-ai-route` — سقالة مسار API موصول بضابط التكلفة والتحقق.

## اختبار التغييرات (قبل أي التزام)

شغّل: `npx tsc --noEmit` + `pnpm lint` + `npm test` + `node scripts/check-contract.ts` + `python -m pytest` + `pnpm mcp:e2e` — كلها يجب أن تنجح. لتغييرات الواجهة، اختبرها بصرياً عبر `pnpm dev` (فحص الأنواع لا يثبت صحة الميزة).
