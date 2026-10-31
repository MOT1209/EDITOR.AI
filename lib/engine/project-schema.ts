// ====================================================================
// مخطط المشروع (ProjectState) — تحقق + ترقية نسخة.
// يُستخدم في: /api/export (رفض المدخلات الخطرة)، مخزن مساحة العمل (MCP)،
// واستيراد/تحميل المشاريع في الواجهة. مصدر واحد لحدود القيم المقبولة.
// ====================================================================
import { z } from "zod";
import type { ProjectState } from "@/lib/types";

/** النسخة الحالية لمخطط المشروع. 1 = مشاريع localStorage القديمة بلا حقل نسخة. */
export const PROJECT_SCHEMA_VERSION = 2;

export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export const FORMATS = ["mp4", "mov", "webm", "mkv"] as const;
export const RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export const FPS_VALUES = [24, 30, 60] as const;
export const QUALITIES = ["draft", "standard", "high", "ultra"] as const;
export const TRANSITION_TYPES = ["dissolve", "slide-left", "slide-right", "slide-up", "slide-down"] as const;
export const COLOR_FILTER_IDS = ["none", "cinematic", "warm", "cool", "vhs", "bw", "vivid", "dreamy"] as const;
/** معرّفات EFFECTS_LIBRARY التي لها ترجمة FFmpeg فعلية في ffmpeg-export.ts. */
export const EFFECT_IDS = [
  "fx_fade", "fx_zoom_punch", "fx_glitch", "fx_warm", "fx_cinematic", "fx_vhs",
  "fx_light_leak", "fx_shake", "fx_slide_l", "fx_zoom_blur", "fx_cool", "fx_kenburns",
] as const;

/** حدود الموارد — تمنع مشاريع ضخمة تُغرق filter_complex أو الذاكرة. */
export const LIMITS = {
  maxSeconds: 6 * 3600,
  maxClips: 500,
  maxSubtitles: 5000,
  maxOverlays: 500,
  maxTracks: 32,
  maxAssets: 200,
  maxText: 500,
  maxName: 120,
} as const;

/** مفاتيح خاصية: ≤32، t تصاعدي صارم (بلا تكرار)، v ضمن حدود الخاصية. */
function keyframes(min: number, max: number) {
  return z
    .array(z.object({ t: z.number().min(0).max(LIMITS.maxSeconds), v: z.number().min(min).max(max) }))
    .max(32)
    .refine((a) => a.every((k, i) => i === 0 || k.t > a[i - 1].t), "t يجب أن يكون تصاعدياً بلا تكرار")
    .optional();
}

const seconds = z.number().min(0).max(LIMITS.maxSeconds);
const id = z.string().min(1).max(128);

export const clipSchema = z.looseObject({
  id,
  assetId: z.string().max(128),
  trackId: id,
  start: seconds,
  duration: z.number().min(0).max(LIMITS.maxSeconds),
  inPoint: seconds,
  outPoint: seconds,
  effects: z.array(z.string().max(64)).max(32),
  volume: z.number().min(0).max(4),
  speed: z.number().min(0.1).max(8),
  zoom: z.number().min(0.1).max(10),
  panX: z.number().min(-10).max(10),
  panY: z.number().min(-10).max(10),
  smartZoom: z.boolean(),
  colorFilter: z.string().max(32).optional(),
  kind: z.enum(["video", "image"]).optional(),
  imageUrl: z.string().max(4096).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  scale: z.number().min(0.05).max(5).optional(),
  posX: z.number().min(-2).max(2).optional(),
  posY: z.number().min(-2).max(2).optional(),
  crop: z.object({
    left: z.number().min(0).max(0.9), top: z.number().min(0).max(0.9),
    right: z.number().min(0).max(0.9), bottom: z.number().min(0).max(0.9),
  }).optional(),
  fadeIn: z.number().min(0).max(30).optional(),
  fadeOut: z.number().min(0).max(30).optional(),
  transitionIn: z.object({ type: z.enum(TRANSITION_TYPES), duration: z.number().min(0.1).max(5) }).optional(),
  color: z.object({
    brightness: z.number().min(-1).max(1).optional(),
    contrast: z.number().min(0).max(3).optional(),
    saturation: z.number().min(0).max(3).optional(),
  }).optional(),
  audioFadeIn: z.number().min(0).max(30).optional(),
  audioFadeOut: z.number().min(0).max(30).optional(),
  keyframes: z
    .object({
      posX: keyframes(-2, 2),
      posY: keyframes(-2, 2),
      rotation: keyframes(-360, 360),
      opacity: keyframes(0, 1),
    })
    .optional(),
});

const subtitleSchema = z.looseObject({
  id,
  start: seconds,
  end: seconds,
  text: z.string().max(LIMITS.maxText),
  lang: z.string().max(16),
  style: z.enum(["default", "bold", "highlight", "karaoke"]).optional(),
});

const overlaySchema = z.looseObject({
  id,
  text: z.string().max(LIMITS.maxText),
  start: seconds,
  end: seconds,
  position: z.enum(["top", "center", "bottom"]),
  fontFamily: z.string().max(128),
  fontSize: z.number().min(6).max(400),
  color: z.string().max(32),
  animation: z.enum(["none", "fade", "pop"]),
});

export const audioClipSchema = z.looseObject({
  id,
  name: z.string().max(LIMITS.maxName * 2),
  trackId: id,
  start: seconds,
  duration: z.number().min(0).max(LIMITS.maxSeconds),
  url: z.string().max(8192),
  volume: z.number().min(0).max(4),
  kind: z.enum(["music", "voiceover", "dub", "sfx"]),
  ref: z.string().max(256).optional(),
  inPoint: seconds.optional(),
  fadeIn: z.number().min(0).max(30).optional(),
  fadeOut: z.number().min(0).max(30).optional(),
});

export const trackSchema = z.looseObject({
  id,
  kind: z.enum(["video", "audio", "subtitle", "fx"]),
  label: z.string().max(LIMITS.maxName),
  height: z.number().min(0).max(1000),
  muted: z.boolean(),
  locked: z.boolean(),
  hidden: z.boolean().optional(),
  magnetic: z.boolean().optional(),
});

const assetSchema = z.looseObject({
  id,
  type: z.enum(["video", "audio", "image", "music", "sfx"]),
  name: z.string().max(LIMITS.maxName * 2),
  url: z.string().max(4096),
  duration: z.number().min(0).max(LIMITS.maxSeconds),
  thumbnail: z.string().optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const projectSchema = z.looseObject({
  id,
  name: z.string().max(LIMITS.maxName),
  aspect: z.enum(ASPECTS),
  format: z.enum(FORMATS),
  resolution: z.enum(RESOLUTIONS),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  quality: z.enum(QUALITIES),
  duration: z.number().min(0).max(LIMITS.maxSeconds),
  tracks: z.array(trackSchema).max(LIMITS.maxTracks),
  clips: z.array(clipSchema).max(LIMITS.maxClips),
  audioClips: z.array(audioClipSchema).max(LIMITS.maxClips),
  subtitles: z.array(subtitleSchema).max(LIMITS.maxSubtitles),
  textOverlays: z.array(overlaySchema).max(LIMITS.maxOverlays),
  effects: z.array(z.string().max(64)).max(64),
  musicId: z.string().max(128).optional(),
  videoUrl: z.string().optional(),
  thumbnail: z.string().optional(),
  title: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(100)).max(100).optional(),
  audioMix: z.object({
    normalize: z.boolean().optional(),
    targetLufs: z.number().min(-30).max(-5).optional(),
    ducking: z.object({ enabled: z.boolean(), amountDb: z.number().min(1).max(30).optional() }).optional(),
  }).optional(),
  assets: z.array(assetSchema).max(LIMITS.maxAssets).optional(),
  schemaVersion: z.number().int().min(1).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ParseResult =
  | { ok: true; project: ProjectState; migrated: boolean }
  | { ok: false; errors: string[] };

/** يرقّي مشروعاً قديماً (بلا schemaVersion) إلى النسخة الحالية — حقول مفقودة تأخذ افتراضيات آمنة. */
export function migrateProject(raw: unknown): { value: unknown; migrated: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, migrated: false };
  const p = { ...(raw as Record<string, unknown>) };
  const version = typeof p.schemaVersion === "number" ? p.schemaVersion : 1;
  if (version >= PROJECT_SCHEMA_VERSION) return { value: p, migrated: false };
  // v1 → v2: مصفوفات اختيارية قد تغيب في ملفات قديمة/مستوردة يدوياً.
  for (const key of ["tracks", "clips", "audioClips", "subtitles", "textOverlays", "effects"]) {
    if (!Array.isArray(p[key])) p[key] = [];
  }
  p.createdAt = typeof p.createdAt === "number" ? p.createdAt : Date.now();
  p.updatedAt = typeof p.updatedAt === "number" ? p.updatedAt : Date.now();
  p.schemaVersion = PROJECT_SCHEMA_VERSION;
  return { value: p, migrated: true };
}

/** يتحقق من مشروع (بعد الترقية) ويرجع رسائل خطأ قابلة للعرض. */
export function parseProject(raw: unknown): ParseResult {
  const { value, migrated } = migrateProject(raw);
  const r = projectSchema.safeParse(value);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(الجذر)"}: ${i.message}`),
    };
  }
  const project = r.data as unknown as ProjectState;
  // تحقق علائقي لا يعبّر عنه المخطط: النهاية بعد البداية.
  const errors: string[] = [];
  project.subtitles.forEach((s, i) => s.end < s.start && errors.push(`subtitles.${i}: end < start`));
  project.textOverlays.forEach((t, i) => t.end < t.start && errors.push(`textOverlays.${i}: end < start`));
  if (errors.length) return { ok: false, errors: errors.slice(0, 10) };
  return { ok: true, project, migrated };
}
