// فهرس الـ Skills — لإضافة Skill جديدة: أنشئ ملفها ثم أضِفها هنا فقط.
// لا حاجة لتعديل النواة (SkillManager / Workflow).
import { ISkill } from "../types";

import { SceneDetectionSkill } from "./SceneDetectionSkill";
import { ShotDetectionSkill } from "./ShotDetectionSkill";
import { SpeechRecognitionSkill } from "./SpeechRecognitionSkill";
import { SilenceDetectionSkill } from "./SilenceDetectionSkill";
import { AutoCutSkill } from "./AutoCutSkill";
import { SmartTrimSkill } from "./SmartTrimSkill";
import { FaceDetectionSkill } from "./FaceDetectionSkill";
import { FaceTrackingSkill } from "./FaceTrackingSkill";
import { PersonTrackingSkill } from "./PersonTrackingSkill";
import { ObjectDetectionSkill } from "./ObjectDetectionSkill";
import { HighlightDetectionSkill } from "./HighlightDetectionSkill";
import { ViralMomentSkill } from "./ViralMomentSkill";
import { AutoZoomSkill } from "./AutoZoomSkill";
import { AutoReframeSkill } from "./AutoReframeSkill";
import { VideoStabilizationSkill } from "./VideoStabilizationSkill";
import { AudioEnhancementSkill } from "./AudioEnhancementSkill";
import { NoiseReductionSkill } from "./NoiseReductionSkill";
import { AutoCaptionSkill } from "./AutoCaptionSkill";
import { SubtitleTranslationSkill } from "./SubtitleTranslationSkill";
import { AutoColorGradingSkill } from "./AutoColorGradingSkill";
import { ColorCorrectionSkill } from "./ColorCorrectionSkill";
import { BackgroundRemovalSkill } from "./BackgroundRemovalSkill";
import { BRollGenerationSkill } from "./BRollGenerationSkill";
import { MusicRecommendationSkill } from "./MusicRecommendationSkill";
import { BeatDetectionSkill } from "./BeatDetectionSkill";
import { AutoMusicSyncSkill } from "./AutoMusicSyncSkill";
import { SoundEffectsSkill } from "./SoundEffectsSkill";
import { VoiceCloningSkill } from "./VoiceCloningSkill";
import { TextToSpeechSkill } from "./TextToSpeechSkill";
import { ThumbnailGenerationSkill } from "./ThumbnailGenerationSkill";
import { HookGenerationSkill } from "./HookGenerationSkill";
import { TitleGenerationSkill } from "./TitleGenerationSkill";
import { DescriptionGenerationSkill } from "./DescriptionGenerationSkill";
import { HashtagGenerationSkill } from "./HashtagGenerationSkill";
import { ShortsGenerationSkill } from "./ShortsGenerationSkill";
import { ExportOptimizationSkill } from "./ExportOptimizationSkill";

/** كل أصناف الـ Skills المتوفّرة. */
export const SKILL_CLASSES = [
  SceneDetectionSkill,
  ShotDetectionSkill,
  SpeechRecognitionSkill,
  SilenceDetectionSkill,
  AutoCutSkill,
  SmartTrimSkill,
  FaceDetectionSkill,
  FaceTrackingSkill,
  PersonTrackingSkill,
  ObjectDetectionSkill,
  HighlightDetectionSkill,
  ViralMomentSkill,
  AutoZoomSkill,
  AutoReframeSkill,
  VideoStabilizationSkill,
  AudioEnhancementSkill,
  NoiseReductionSkill,
  AutoCaptionSkill,
  SubtitleTranslationSkill,
  AutoColorGradingSkill,
  ColorCorrectionSkill,
  BackgroundRemovalSkill,
  BRollGenerationSkill,
  MusicRecommendationSkill,
  BeatDetectionSkill,
  AutoMusicSyncSkill,
  SoundEffectsSkill,
  VoiceCloningSkill,
  TextToSpeechSkill,
  ThumbnailGenerationSkill,
  HookGenerationSkill,
  TitleGenerationSkill,
  DescriptionGenerationSkill,
  HashtagGenerationSkill,
  ShortsGenerationSkill,
  ExportOptimizationSkill,
] as const;

/** إنشاء نسخة جديدة من كل Skill (حالة/سجلات مستقلة لكل مدير). */
export function createAllSkills(): ISkill[] {
  return SKILL_CLASSES.map((C) => new C());
}

export {
  SceneDetectionSkill,
  ShotDetectionSkill,
  SpeechRecognitionSkill,
  SilenceDetectionSkill,
  AutoCutSkill,
  SmartTrimSkill,
  FaceDetectionSkill,
  FaceTrackingSkill,
  PersonTrackingSkill,
  ObjectDetectionSkill,
  HighlightDetectionSkill,
  ViralMomentSkill,
  AutoZoomSkill,
  AutoReframeSkill,
  VideoStabilizationSkill,
  AudioEnhancementSkill,
  NoiseReductionSkill,
  AutoCaptionSkill,
  SubtitleTranslationSkill,
  AutoColorGradingSkill,
  ColorCorrectionSkill,
  BackgroundRemovalSkill,
  BRollGenerationSkill,
  MusicRecommendationSkill,
  BeatDetectionSkill,
  AutoMusicSyncSkill,
  SoundEffectsSkill,
  VoiceCloningSkill,
  TextToSpeechSkill,
  ThumbnailGenerationSkill,
  HookGenerationSkill,
  TitleGenerationSkill,
  DescriptionGenerationSkill,
  HashtagGenerationSkill,
  ShortsGenerationSkill,
  ExportOptimizationSkill,
};
