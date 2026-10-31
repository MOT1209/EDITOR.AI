// المجالات الثمانية المعتمدة للمهارات المدمجة (مرجع واحد للواجهة والتوثيق والاختبار).
// يختلف عن SkillCategory (تصنيف تنفيذي داخلي): هنا تصنيف المنتج كما يراه المستخدم.
export const SKILL_DOMAINS = {
  "video-analysis": { label: "تحليل الفيديو", skills: ["SceneDetectionSkill", "ShotDetectionSkill", "FaceDetectionSkill", "ObjectDetectionSkill", "HighlightDetectionSkill", "ViralMomentSkill", "PersonTrackingSkill", "FaceTrackingSkill"] },
  "video-editing": { label: "مونتاج الفيديو", skills: ["AutoCutSkill", "SmartTrimSkill", "AutoReframeSkill", "AutoZoomSkill", "SpeedRampSkill", "ShortsGenerationSkill", "BRollGenerationSkill"] },
  "audio-processing": { label: "معالجة الصوت", skills: ["AudioEnhancementSkill", "NoiseReductionSkill", "SilenceDetectionSkill", "MusicDuckingSkill", "BeatDetectionSkill", "AutoMusicSyncSkill", "SoundEffectsSkill", "TextToSpeechSkill", "VoiceCloningSkill"] },
  subtitles: { label: "الترجمات", skills: ["AutoCaptionSkill", "SubtitleTranslationSkill", "SpeechRecognitionSkill", "TextOverlaySkill"] },
  "visual-effects": { label: "المؤثرات البصرية", skills: ["TransitionEffectSkill", "BackgroundRemovalSkill", "VideoStabilizationSkill", "UpscaleSkill"] },
  "color-correction": { label: "تصحيح الألوان", skills: ["AutoColorGradingSkill", "ColorCorrectionSkill"] },
  "export-optimization": { label: "تحسين التصدير", skills: ["ExportOptimizationSkill"] },
  "quality-control": { label: "ضبط الجودة", skills: ["QualityControlSkill"] },
  // خارج المجالات الثمانية المطلوبة: توليد محتوى نصي/وسائط مساندة.
  "content-generation": { label: "توليد المحتوى", skills: ["TitleGenerationSkill", "DescriptionGenerationSkill", "HashtagGenerationSkill", "HookGenerationSkill", "ScriptWriterSkill", "StoryboardGeneratorSkill", "ThumbnailGenerationSkill", "MusicRecommendationSkill"] },
} as const;

export type SkillDomainId = keyof typeof SKILL_DOMAINS;

export function domainOf(skillName: string): SkillDomainId | null {
  for (const [id, d] of Object.entries(SKILL_DOMAINS)) if ((d.skills as readonly string[]).includes(skillName)) return id as SkillDomainId;
  return null;
}
