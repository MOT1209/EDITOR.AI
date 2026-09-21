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

## الأوامر

```bash
pnpm dev                          # خادم التطوير (3000)
npx tsc --noEmit                  # فحص أنواع TS
npm test                          # اختبارات الواجهة (Vitest)
node scripts/check-contract.ts    # تطابق عقد EDL
python -m pytest                  # اختبارات Python
python -m src.main <video> --demo # تشغيل المسار كاملاً بلا مفاتيح
```

## المبادئ التي لا تُنتهك

1. **التدهور الأنيق إلزامي** — بلا مفتاح/حزمة/GPU/شبكة لا ينهار المسار (بديل محلي أو نتيجة فارغة + تحذير).
2. **البوابات مستقلة عن CrewAI** — `src/agents/validation.py` كود نقي.
3. **عقد EDL موحّد** — عدّل `edl_schema.py` و`lib/agents/types.ts` معاً، ثم `node scripts/check-contract.ts` يجب أن يمرّ.
4. **حماية المفاتيح** — لا أسرار في git؛ المفاتيح عبر `lib/server/api-keys.ts` (header ثم env).
5. **عربية الواجهات والتوثيق**.

## كيف تضيف بأمان

- **مهارة فيديو جديدة**: ملف `lib/skills/catalog/<X>Skill.ts` يمدّ `BaseSkill` → سجّله في `lib/skills/catalog/index.ts` (`SKILL_CLASSES` + التصدير) → أضِف اختباراً في `lib/skills/skills.test.ts`. المرجع: `lib/skills/README.md`.
- **مسار API مدفوع**: اتبع نمط `app/api/ai/tts/route.ts` — اقرأ المفتاح عبر `api-keys.ts`، مرّر عبر `guardCost`/`recordSpend` (`lib/server/cost-guard.ts`)، تحقق المدخلات عبر `lib/server/validate.ts`، وأعطِ fallback عند غياب المفتاح.
- **تغيير عقد EDL**: عدّل الملفين معاً ثم شغّل `check-contract` + pytest + tsc.
- **مراجعة ما بعد الرندر**: أبقِ توافق `src/agents/render_review.py` (بوابة `validate_render`).

## الاختبار قبل الالتزام

شغّل الأربعة: `npx tsc --noEmit` + `npm test` + `node scripts/check-contract.ts` + `python -m pytest` — كلها تنجح. تغييرات الواجهة تُختبر بصرياً عبر `pnpm dev`.

## قيود

- لا تذكر أي معرّف نموذج (أسماء LLM) في الالتزامات أو الكود أو PR.
- لا تدفع إلى `main` بلا إذن صريح؛ لا force-push؛ لا حذف فروع بلا إذن.
