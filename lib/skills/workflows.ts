import { Workflow } from "./Workflow";

/**
 * الـ Workflow الافتراضي:
 * Import Video → Scene Detection → Speech Recognition → Silence Detection
 * → Auto Cut → Highlight Detection → Face Tracking → Audio Enhancement
 * → Auto Caption → Color Grading → Thumbnail Generation → Export
 *
 * الخطوات المساعدة (FaceDetection / ObjectDetection) مُدرجة كاعتمادات
 * لازمة لِما بعدها، ومعلّمة optional حتى لا توقف المسار عند تعذّرها.
 */
export function createDefaultWorkflow(): Workflow {
  return new Workflow(
    "default",
    "المسار الافتراضي لتحرير فيديو كامل آلياً",
    [
      { skill: "SceneDetectionSkill" },
      { skill: "SpeechRecognitionSkill", optional: true },
      { skill: "SilenceDetectionSkill" },
      { skill: "AutoCutSkill" },
      { skill: "TransitionEffectSkill", optional: true }, // انتقالات بين المقاطع
      { skill: "HighlightDetectionSkill" },
      { skill: "FaceDetectionSkill", optional: true }, // مطلوبة لـ FaceTracking
      { skill: "FaceTrackingSkill", optional: true },
      { skill: "AudioEnhancementSkill", optional: true },
      { skill: "MusicDuckingSkill", optional: true }, // خفض الموسيقى تحت الكلام
      { skill: "AutoCaptionSkill", optional: true },
      { skill: "TextOverlaySkill", optional: true }, // نصوص Hook عند اللحظات المميزة
      { skill: "AutoColorGradingSkill", optional: true },
      { skill: "ThumbnailGenerationSkill", optional: true },
      { skill: "ExportOptimizationSkill" },
    ]
  );
}

/**
 * مسار "Viral Shorts" — مثال على مسار إضافي يُسجَّل بجانب الافتراضي.
 */
export function createShortsWorkflow(): Workflow {
  return new Workflow(
    "viral-shorts",
    "استخراج مقاطع قابلة للانتشار وتجهيزها للنشر",
    [
      { skill: "SceneDetectionSkill" },
      { skill: "HighlightDetectionSkill" },
      { skill: "FaceDetectionSkill", optional: true },
      { skill: "ViralMomentSkill" },
      { skill: "SpeedRampSkill", optional: true }, // تباطؤ قبل الـ Hook وتسريع بعده
      { skill: "TransitionEffectSkill", optional: true },
      { skill: "AutoReframeSkill", optional: true },
      { skill: "ShortsGenerationSkill" },
      { skill: "TitleGenerationSkill", optional: true },
      { skill: "TextOverlaySkill", optional: true },
      { skill: "HashtagGenerationSkill", optional: true },
      { skill: "ThumbnailGenerationSkill", optional: true },
      { skill: "ExportOptimizationSkill" },
    ]
  );
}
