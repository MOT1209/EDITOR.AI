# AGENTS.md — عقد الوكلاء لمشروع EDITOR.AI (MontageAI)

دليل محايد للأدوات لأي وكيل ذكاء اصطناعي (Cursor / Codex / Copilot / Claude Code وغيرها)
يعمل على هذا المستودع. المشروع: منصة مونتاج فيديو + إنشاء محتوى بالذكاء الاصطناعي،
واجهة عربية، تشغيل محلي أولاً ثم SaaS لاحقاً.

## المعمارية

| الطبقة | المسار | الدور |
|--------|--------|------|
| الواجهة | `app/`, `components/editor/*`, `components/shorts/*` | Next.js 14 + TypeScript + Tailwind |
| مسارات API | `app/api/*` | `ai/*` (ذكاء توليدي)، `agents/*` (تشغيل Python)، `export/*`, `ffmpeg/*`, `skills/*` |
| مسار الوكلاء | `src/agents/*` | Python: CEO → Analyst → Director → Critic → Audio → Render + بوابات (`validation.py`) |
| نظام المهارات | `lib/skills/*` | `BaseSkill` + `SkillManager` + `Workflow` + كتالوج (43 مهارة) |
| عقد EDL | `src/agents/edl_schema.py` ↔ `lib/agents/types.ts` | مخطط موحّد بلغتين |
| محرّك المشروع | `lib/engine/*` | مخطط+نسخة، عمليات تايملاين نقية، مساحة عمل (undo/redo)، تحليل FFmpeg، رندر+تحقق، جسر الخطط |
| خادم MCP | `mcp/*` | stdio، 37 أداة مدمجة (Zod in/out) + أدوات مخصّصة ديناميكية `ext_*`، موافقة elicitation، تدقيق — انظر `docs/MCP_SETUP.md` |
| الإضافات | `lib/extensions/*` + `mcp/custom-tools.ts` | مهارات/أدوات مخصّصة من حزم بيانات، سجل إجراءات معتمد، صلاحيات، عزل وتوقيع — انظر `docs/EXTENSIONS.md` |

## الأوامر

```bash
pnpm dev                          # خادم التطوير (3000)
npx tsc --noEmit                  # فحص أنواع TS
npm test                          # اختبارات الواجهة (Vitest)
node scripts/check-contract.ts    # تطابق عقد EDL
python -m pytest                  # اختبارات Python
python -m src.main <video> --demo # تشغيل المسار كاملاً بلا مفاتيح
pnpm mcp                          # خادم MCP عبر stdio
pnpm mcp:e2e                      # E2E حقيقي لخادم MCP (FFmpeg + ffprobe)
```

## المبادئ التي لا تُنتهك

1. **التدهور الأنيق إلزامي** — بلا مفتاح/حزمة/GPU/شبكة لا ينهار المسار (بديل محلي أو نتيجة فارغة + تحذير).
2. **البوابات مستقلة عن CrewAI** — `src/agents/validation.py` كود نقي.
3. **عقد EDL موحّد** — عدّل `edl_schema.py` و`lib/agents/types.ts` معاً، ثم `node scripts/check-contract.ts` يجب أن يمرّ.
4. **حماية المفاتيح** — لا أسرار في git؛ المفاتيح عبر `lib/server/api-keys.ts` (header ثم env).
5. **عربية الواجهات والتوثيق**.
6. **لا نتائج مُختلقة** — أي بديل تقديري يُوسم `simulated: true` + `warning`؛ لا نجاح رندر بلا ملف يجتاز `reviewRender`.
7. **منطق التعديل في `lib/engine/timeline.ts` فقط** — الواجهة وMCP يستخدمانه؛ لا تكرّره.

## كيف تضيف بأمان

- **مهارة فيديو جديدة**: ملف `lib/skills/catalog/<X>Skill.ts` يمدّ `BaseSkill` → سجّله في `lib/skills/catalog/index.ts` (`SKILL_CLASSES` + التصدير) → أضِف اختباراً في `lib/skills/skills.test.ts`. المرجع: `lib/skills/README.md`.
- **مسار API مدفوع**: اتبع نمط `app/api/ai/tts/route.ts` — اقرأ المفتاح عبر `api-keys.ts`، مرّر عبر `guardCost`/`recordSpend` (`lib/server/cost-guard.ts`)، تحقق المدخلات عبر `lib/server/validate.ts`، وأعطِ fallback عند غياب المفتاح.
- **تغيير عقد EDL**: عدّل الملفين معاً ثم شغّل `check-contract` + pytest + tsc.
- **مراجعة ما بعد الرندر**: أبقِ توافق `src/agents/render_review.py` (بوابة `validate_render`).

## الاختبار قبل الالتزام

شغّل: `npx tsc --noEmit` + `pnpm lint` + `pnpm test` + `node scripts/check-contract.ts` + `python -m pytest` + `pnpm mcp:e2e` — كلها تنجح. تغييرات الواجهة تُختبر بصرياً عبر `pnpm dev`.

- **إضافة مخصّصة بلا تعديل النواة**: حزمة عبر `/extensions` أو `pnpm ext install` (لا تعدّل `mcp/server.ts`)؛ إجراء إعلاني جديد في `lib/extensions/actions.ts` ولا shell/FFmpeg حرة/ملفات/شبكة.
- **أداة MCP مدمجة جديدة**: سجّلها في `mcp/server.ts` عبر `tool(...)` بمخطط مدخلات ومخرجات Zod، نفّذ المنطق في `lib/engine/*`، أعد أخطاء `EngineError` (لا `structuredContent` مع الخطأ)، واطلب `requireApproval` للمكلف/المدمّر، وأضف اختباراً في `mcp/server.test.ts`.

## قيود

- لا تذكر أي معرّف نموذج (أسماء LLM) في الالتزامات أو الكود أو PR.
- لا تدفع إلى `main` بلا إذن صريح؛ لا force-push؛ لا حذف فروع بلا إذن.
