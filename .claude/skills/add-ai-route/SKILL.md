---
name: add-ai-route
description: سقالة مسار API جديد تحت app/api/ai موصول بقراءة المفتاح، ضابط التكلفة، تحقق المدخلات، والتدهور الأنيق. استخدمها عند إضافة أي endpoint يستدعي مزوّد LLM/ذكاء توليدي مدفوع (تفريغ، ترجمة، توليد نص/صوت/صورة...).
---

# إضافة مسار API ذكاء اصطناعي (app/api/ai)

أي مسار يستدعي مزوّداً مدفوعاً يجب أن يتبع نفس نمط المسارات الحالية
(`app/api/ai/tts/route.ts`, `metadata/route.ts`, `script/route.ts`).

## الخطوات

1. **أنشئ** `app/api/ai/<name>/route.ts` مع:
   ```ts
   export const runtime = "nodejs";
   export const maxDuration = 120;
   ```

2. **اقرأ المفتاح** عبر `lib/server/api-keys.ts` (`getOpencodeKey(req)`, `getOpencodeBaseUrl()`, `getChatModel()`/`getWhisperModel()` حسب الحاجة). لا تقرأ `process.env` مباشرة للمفاتيح.

3. **تحقق المدخلات** عبر `lib/server/validate.ts`:
   - ملف مرفوع → `validateVideoUpload`/`validateAudioUpload`.
   - حقول نصية → `clampString`/`pickEnum`/`requireText`.

4. **تدهور أنيق** عند غياب المفتاح: أعِد نتيجة بديلة محلية أو `{ error, mock: true }` بحالة 503 — لا ترمِ.

5. **ضابط التكلفة** (`lib/server/cost-guard.ts`) حول الاستدعاء المدفوع:
   ```ts
   const guard = guardCost("chat", { chars: promptLen });   // أو "whisper"/"tts"/"vision"
   if (!guard.allowed) return NextResponse.json({ error: guard.reason, budget: guard }, { status: 402 });
   // ... fetch المزوّد ...
   recordSpend(guard.estimateUsd);   // بعد النجاح فقط (whisper: سجّل من المدة الفعلية إن توفّرت)
   ```

6. **تحقق**: `npx tsc --noEmit` + `npm test`. أضِف اختبار Vitest للمنطق النقي إن أمكن.

## قواعد

- رسائل الأخطاء بالعربية.
- لا تسجّل الإنفاق قبل نجاح الاستدعاء الفعلي.
- إن أنتج المسار حقلاً في عقد EDL، استخدم مهارة `edl-contract-change`.
- لا تذكر أي معرّف نموذج في الكود أو الالتزام.
