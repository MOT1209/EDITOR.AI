// مخططات zod لمسارات /api/ai/* — حدود صارمة تمنع DoS (حلقات بطول يحدده العميل) وانهيار الأنواع.
import { z } from "zod";

/** مدة الفيديو بالثواني: محدودة (24 ساعة) كي لا تحدّد حلقات الخادم ذاكرته. */
export const durationSchema = z.number().finite().min(0).max(86_400);

const frameStr = z.string().max(6_000_000); // صورة base64 واحدة ≤ ~4.5MB
const frames = z.array(frameStr).max(12);

export const subtitlesBody = z.object({ duration: durationSchema.default(30), lang: z.string().max(16).default("ar") });
export const metadataBody = z.object({ duration: durationSchema.default(60), transcript: z.string().max(200_000).optional() });
export const enhanceBody = z.object({ audioBase64: z.string().max(60_000_000).optional() });
export const framesBody = z.object({ duration: durationSchema.default(30), frames: frames.default([]) });
export const scenesBody = z.object({ duration: durationSchema.default(30), frames: frames.optional(), sourceRef: z.string().max(256).optional() });
export const reframeBody = z.object({
  duration: durationSchema.default(30),
  frames: frames.default([]),
  targetAspect: z.enum(["9:16", "4:5", "1:1", "16:9", "4:3"]).default("9:16"),
});
export const musicSyncBody = z.object({ bpm: z.number().finite().min(30).max(300).optional(), duration: durationSchema.default(30) });
export const analyzeBody = z.object({ duration: durationSchema.default(30), frameBase64: frameStr.optional() });
export const ttsBody = z.object({
  text: z.string().max(5_000),
  voice: z.string().max(64).default("ar-male-1"),
  speed: z.number().finite().min(0.25).max(4).default(1),
});
export const translateBody = z.object({
  texts: z.array(z.string().max(2_000)).max(500).default([]),
  targetLang: z.string().max(16).default("en"),
  sourceLang: z.string().max(16).default("ar"),
});
export const scriptBody = z.object({
  topic: z.string().min(1).max(500),
  durationSec: z.number().finite().min(5).max(3600).default(60),
  tone: z.string().max(64).default("حماسي"),
});

export const silenceBody = z.object({ duration: durationSchema.optional(), sourceRef: z.string().max(200).optional() });
export const skillsBody = z.object({
  mode: z.enum(["skill", "workflow"]).optional(),
  skill: z.string().max(120).optional(),
  workflow: z.string().max(120).optional(),
  document: z.looseObject({ duration: durationSchema.optional() }).optional(),
  config: z.record(z.string().max(80), z.unknown()).optional(),
  // مرجع فيديو مرفوع (upload:/project:) ⇒ الخادم يحلّل صمتاً/مشاهد حقيقية ويضعها في المستند (تحليل مسبق).
  sourceRef: z.string().max(256).optional(),
});
export const importImageBody = z.object({ imageUrl: z.string().max(2048) });

export const thumbnailBody = z.object({
  title: z.string().max(200).default("فيديو رائع"),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
});
export const assetsCheckBody = z.object({ refs: z.array(z.string().max(256)).max(200).default([]) });
export const agentsExportBody = z.object({
  jobId: z.string().max(64),
  format: z.string().max(32),
  plan: z.record(z.string(), z.unknown()).optional(),
});

// POST /api/export — المشروع نفسه يُتحقق منه لاحقاً بـ parseProject؛ هنا الشكل والحدود فقط.
export const EXPORT_MAX_JSON_BYTES = 5_000_000;
export const exportBody = z.object({
  project: z.unknown().optional(),
  sourceRef: z.string().max(256).optional(),
  sources: z
    .array(z.object({ assetId: z.string().max(80), ref: z.string().max(256) }))
    .max(64)
    .optional(),
  videoStabilize: z.boolean().optional(),
  colorGrading: z.number().finite().min(0).max(1).optional(),
  acknowledgeAudioLoss: z.boolean().optional(),
  preview: z.object({ start: z.number().finite(), end: z.number().finite() }).optional(),
});

// PUT /api/projects/[id] — حفظ المحرّر (المشروع يُتحقق منه بـ parseProject).
export const projectPutBody = z.object({ project: z.unknown() });

// POST /api/session — تسجيل الدخول برمز الوصول (يُحوَّل إلى كوكي HttpOnly).
export const sessionBody = z.object({ token: z.string().min(1).max(512) });
