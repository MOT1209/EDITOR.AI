---
name: add-video-skill
description: سقالة مهارة فيديو/محتوى جديدة في نظام lib/skills بنمط BaseSkill، تسجيلها، واختبارها. استخدمها عندما يطلب المستخدم إضافة قدرة معالجة/توليد جديدة إلى الكتالوج (مثل upscale، صدى صوت، توليد عناوين...).
---

# إضافة مهارة فيديو جديدة (lib/skills)

نظام المهارات معياري: كل مهارة تمدّ `BaseSkill` وتُسجَّل في مكان واحد بلا لمس النواة.
المرجع الكامل: `lib/skills/README.md`.

## الخطوات

1. **أنشئ الملف** `lib/skills/catalog/<Name>Skill.ts`:
   - يمدّ `BaseSkill` من `../BaseSkill`.
   - حقول: `name`, `description` (عربي), `category` (من `SkillCategory` في `types.ts`: analysis/editing/audio/visual/text/generation/export), `inputSpec`, `outputSpec`, `defaultConfig`.
   - نفّذ `execute(input, ctx)` فقط. عند الحاجة لمزوّد خارجي استخدم `this.callEndpoint(path, body, ctx)` (النمط في `BaseSkill.ts:139`) مع **fallback محلي** عند رجوع `null` (مبدأ التدهور الأنيق).

2. **سجّلها** في `lib/skills/catalog/index.ts`:
   - أضِف `import { <Name>Skill } from "./<Name>Skill";`
   - أضِفها إلى مصفوفة `SKILL_CLASSES`.
   - أضِفها إلى كتلة `export { ... }`.

3. **(اختياري) أضِفها لمسار** في `lib/skills/workflows.ts` عبر خطوة `{ skill: "<Name>Skill", optional: true }`.

4. **اختبار** في `lib/skills/skills.test.ts`: تحقق أنها مسجّلة وأن `runSkill("<Name>Skill", doc)` يعطي `ok:true` مع تدهور أنيق (بلا مفتاح).

5. **تحقق**: `npx tsc --noEmit` + `npm test` — كلاهما يجب أن ينجح.

## قواعد

- عربية الوصف والرسائل. تدهور أنيق إلزامي (لا يرمي عند غياب مفتاح/حزمة).
- لا تعدّل `BaseSkill`/`SkillManager`/`Workflow` (النواة) لإضافة مهارة.
- إن كان الناتج جزءاً من عقد EDL، طبّق تغيير العقد عبر مهارة `edl-contract-change`.
