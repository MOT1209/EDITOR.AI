---
name: edl-contract-change
description: تغيير مخطط EDL المشترك بأمان على الجانبين (Python Pydantic + TypeScript) مع الحفاظ على تطابق العقد. استخدمها عند إضافة/تعديل أي حقل في خطة المونتاج (segments, captions, render, ...) يمسّ src/agents/edl_schema.py أو lib/agents/types.ts.
---

# تغيير عقد EDL بأمان (Python ↔ TypeScript)

مخطط EDL هو العقد الذي يتشاركه مسار Python والواجهة. أي تعديل من جانب واحد يكسر
التطابق. `scripts/check-contract.ts` يفرض التطابق (Python يُسمح أن يكون superset).

## الخطوات

1. **حدّد الحقل** والنموذج المستهدف. الملفان:
   - Python: `src/agents/edl_schema.py` (Pydantic، camelCase عبر alias).
   - TypeScript: `lib/agents/types.ts`.

2. **عدّل الجانبين معاً** بنفس الاسم والنوع:
   - أضِف الحقل في نموذج Python المناسب (مع نوع/افتراضي).
   - أضِف نفس الحقل في الواجهة TypeScript.
   - الحقول الخاصة بـ Python فقط (داخلية للمسار مثل نتائج الرندر) مسموحة كـ superset — لا تحتاج مقابلاً في TS.

3. **شغّل فحص العقد**: `node scripts/check-contract.ts` — يجب أن يمرّ (0 أخطاء). إن ظهر خطأ، اقرأ رسالته: يحدّد الحقل الناقص/المتعارض بالضبط.

4. **حدّث المنتجين/المستهلكين** إن لزم:
   - Python: من يبني/يقرأ الحقل (`director_agent.py`, `render_agent.py`, ...).
   - TS: من يعرض/يرسل الحقل في الواجهة أو `app/api/agents/*`.

5. **تحقق شامل**: `python -m pytest` + `npx tsc --noEmit` + `node scripts/check-contract.ts` — كلها تنجح. أضِف حالة اختبار للحقل الجديد إن كان له منطق.

## قواعد

- لا تغيّر جانباً واحداً وتترك الآخر — check-contract سيفشل في CI.
- حافظ على camelCase في العقد المشترك (عرف Pydantic ↔ TS).
- لا تكسر الحقول القائمة (أضِف افتراضيات للحقول الجديدة).
