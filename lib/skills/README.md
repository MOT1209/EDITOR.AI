# نظام Skills

نظام معياري (modular) لمهام الذكاء الاصطناعي في محرر الفيديو. كل مهمة عبارة عن **Skill** مستقلة قابلة للإضافة أو الحذف **دون تعديل النواة**.

## البنية

```
lib/skills/
├── types.ts          # العقود الأساسية (ISkill, SkillContext, MediaDocument...)
├── BaseSkill.ts      # الأساس المشترك (Status, Logs, Config, التوقيت, الإلغاء, الأخطاء)
├── SkillManager.ts   # التسجيل، التشغيل، الإيقاف، المقاييس، سجل الأخطاء
├── Workflow.ts       # تعريف وتشغيل سلسلة Skills مع مشاركة البيانات
├── workflows.ts      # الـ Workflows الجاهزة (default, viral-shorts)
├── registry.ts       # بناء مدير مُسجّل بالكامل + Singleton
├── index.ts          # نقطة الدخول العامة
└── catalog/          # الـ 36 Skill، كل واحدة في ملفها + index.ts
```

## مكوّنات كل Skill

| الحقل | المصدر |
|------|--------|
| **Name** | `name` |
| **Description** | `description` |
| **Category** | `category` (`analysis`, `editing`, `audio`, `visual`, `text`, `generation`, `export`) |
| **Input** | `inputSpec` |
| **Output** | `outputSpec` + ناتج `execute()` |
| **Execution Logic** | `execute()` |
| **Configuration** | `config` / `configure()` / `defaultConfig` |
| **Status** | `status` (`idle`, `running`, `completed`, `failed`, `stopped`) |
| **Logs** | `logs[]` |

## الاستخدام

```ts
import { getSkillManager } from "@/lib/skills";

const manager = getSkillManager();

// تشغيل Workflow كامل
const result = await manager.runWorkflow("default", { duration: 60, aspect: "9:16" });
console.log(result.document.scenes, result.document.highlights);

// تشغيل Skill مفردة
const r = await manager.runSkill("SceneDetectionSkill", { duration: 60 });

// المقاييس وسجل الأخطاء
console.log(manager.allMetrics());
console.log(manager.errorLog);
```

عبر الـ API:

```bash
GET  /api/skills                                             # الفهرس + المقاييس
POST /api/skills  { "mode":"workflow", "workflow":"default", "document":{ "duration":60 } }
POST /api/skills  { "mode":"skill", "skill":"SceneDetectionSkill", "document":{ "duration":60 } }
```

## مشاركة البيانات

كل Skill تقرأ ما تحتاجه من `MediaDocument` المشترك وتكتب ناتجها فيه عبر `ctx.shared`.
بعد كل خطوة يدمج الـ Workflow الناتج في المستند، فتجده الخطوة التالية جاهزاً
(مثال: `SilenceDetectionSkill` تكتب `silences` ثم تقرأها `AutoCutSkill`).

## التكامل مع الـ API الحقيقي

الـ Skills التي لها endpoint (مشاهد، صمت، وجوه، أشياء، تأطير، إيقاع) تستدعي
`/api/ai/*` تلقائياً عند ضبط `apiBaseUrl` في الإعدادات، وإلا تستخدم منطقاً محلياً (fallback):

```ts
await manager.runWorkflow("default", doc, {
  config: { apiBaseUrl: "http://localhost:3000" },
});
```

## الـ Workflow الافتراضي

```
Import Video → Scene Detection → Speech Recognition → Silence Detection
→ Auto Cut → Highlight Detection → Face Tracking → Audio Enhancement
→ Auto Caption → Color Grading → Thumbnail Generation → Export
```

## إضافة Skill جديدة (دون لمس النواة)

```ts
// 1) lib/skills/catalog/MySkill.ts
import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class MySkill extends BaseSkill {
  readonly name = "MySkill";
  readonly description = "وصف المهمة.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { duration: "number" };
  readonly outputSpec = { myResult: "..." };
  protected readonly defaultConfig = { option: 1 };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    return { myResult: input.duration * this.cfg("option", 1) };
  }
}
```

```ts
// 2) أضِف الصنف إلى lib/skills/catalog/index.ts (SKILL_CLASSES)
// 3) (اختياري) أضِفها لأي Workflow عبر wf.addStep("MySkill")
```

## حذف Skill

احذف ملفها وأزِلها من `SKILL_CLASSES`، أو في وقت التشغيل:

```ts
manager.unregister("MySkill");
manager.getWorkflow("default")?.removeStep("MySkill");
```

## قائمة الـ 36 Skill

تحليل: Scene، Shot، Face، Person، Object، Highlight، ViralMoment ·
قص: AutoCut، SmartTrim ·
صوت: SpeechRecognition، Silence، AudioEnhancement، NoiseReduction، Beat، AutoMusicSync، MusicRecommendation، SoundEffects، VoiceCloning، TextToSpeech ·
صورة: AutoZoom، AutoReframe، VideoStabilization، AutoColorGrading، ColorCorrection، BackgroundRemoval، FaceTracking ·
نص: AutoCaption، SubtitleTranslation، Hook، Title، Description، Hashtag ·
توليد: BRoll، Thumbnail، Shorts ·
تصدير: ExportOptimization
