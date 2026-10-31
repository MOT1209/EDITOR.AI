export type ProjectAspect = "16:9" | "9:16" | "1:1" | "4:5";

export type VideoFormat = "mp4" | "mov" | "webm" | "mkv";

export interface MediaAsset {
  id: string;
  type: "video" | "audio" | "image" | "music" | "sfx";
  name: string;
  url: string;
  duration: number;
  thumbnail?: string;
  meta?: Record<string, string | number>;
}

export interface VideoClip {
  id: string;
  assetId: string;
  trackId: string;
  start: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  effects: string[];
  volume: number;
  speed: number;
  zoom: number;
  panX: number;
  panY: number;
  smartZoom: boolean;
  colorFilter?: string;
  /** "video" (default) trims/plays the uploaded source; "image" overlays a still from imageUrl. */
  kind?: "video" | "image";
  /** Server-local path (under .montage_ai/assets) — only set when kind === "image". */
  imageUrl?: string;
  // ---- خصائص المركِّب متعدد المسارات (كلها اختيارية؛ الغياب = السلوك القديم) ----
  /** تدوير الطبقة بالدرجات حول مركزها (−360..360). */
  rotation?: number;
  /** شفافية الطبقة 0..1 (1 = معتم). */
  opacity?: number;
  /** حجم الطبقة كنسبة من الإطار (1 = تغطي الإطار؛ <1 = صورة داخل صورة). */
  scale?: number;
  /** إزاحة الطبقة عن المركز كنسبة من عرض/ارتفاع الإطار (−1..1). */
  posX?: number;
  posY?: number;
  /** اقتصاص المحتوى قبل التحجيم (كسور 0..0.9 من كل حافة). */
  crop?: { left: number; top: number; right: number; bottom: number };
  /** تلاشي بصري (ثوانٍ) عند بداية/نهاية الطبقة. */
  fadeIn?: number;
  fadeOut?: number;
  /** انتقال عند دخول المقطع (انظر docs/RENDERING.md لدلالته). */
  transitionIn?: ClipTransition;
  /** تصحيح لوني أساسي (brightness −1..1، contrast 0..3، saturation 0..3). */
  color?: { brightness?: number; contrast?: number; saturation?: number };
  /** تلاشي صوت المقطع (ثوانٍ). */
  audioFadeIn?: number;
  audioFadeOut?: number;
  /** مفاتيح (keyframes): تُغني القيمة الثابتة للخاصية؛ استيفاء خطي بين المفاتيح، t بالثواني من بداية المقطع. */
  keyframes?: ClipKeyframes;
}

export type KeyframeProp = "posX" | "posY" | "rotation" | "opacity";
export interface Keyframe {
  t: number;
  v: number;
}
export type ClipKeyframes = Partial<Record<KeyframeProp, Keyframe[]>>;

export type TransitionType = "dissolve" | "slide-left" | "slide-right" | "slide-up" | "slide-down";
export interface ClipTransition {
  type: TransitionType;
  duration: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  position: "top" | "center" | "bottom";
  fontFamily: string;
  fontSize: number;
  color: string;
  animation: "none" | "fade" | "pop";
}

export interface AudioClip {
  id: string;
  name: string;
  trackId: string;
  start: number;
  duration: number;
  url: string;
  volume: number;
  kind: "music" | "voiceover" | "dub" | "sfx";
  /** مرجع وسائط معتم على الخادم (upload:<uuid>…) — شرط دخول الصوت في التصدير. */
  ref?: string;
  /** نقطة البداية داخل ملف الصوت (ثوانٍ). */
  inPoint?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  lang: string;
  style?: "default" | "bold" | "highlight" | "karaoke";
}

export interface TimelineTrack {
  id: string;
  kind: "video" | "audio" | "subtitle" | "fx";
  label: string;
  height: number;
  muted: boolean;
  locked: boolean;
  /** مسار فيديو مخفي لا يُرندر (العين). */
  hidden?: boolean;
  /** false = تموضع حر (طبقات)؛ الافتراضي مغناطيسي (ترصيف بلا فجوات). */
  magnetic?: boolean;
}

export interface Effect {
  id: string;
  name: string;
  category: "transition" | "color" | "motion" | "vfx" | "audio";
  preview: string;
  intensity: number;
  css?: string;
}

export interface MusicTrack {
  id: string;
  title: string;
  genre: string;
  mood: string;
  duration: number;
  bpm: number;
  url: string;
  cover: string;
}

export interface AudioMix {
  /** تطبيع الجهارة المتكاملة (loudnorm). الافتراضي true. */
  normalize?: boolean;
  /** الهدف بوحدة LUFS (−30..−5). الافتراضي −16. */
  targetLufs?: number;
  /** خفض (ducking) الموسيقى/المؤثرات تحت الصوت البشري (فيديو + تعليق + دبلجة). */
  ducking?: { enabled: boolean; amountDb?: number };
}

export interface ProjectState {
  id: string;
  name: string;
  aspect: ProjectAspect;
  format: VideoFormat;
  resolution: "720p" | "1080p" | "4k";
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high" | "ultra";
  duration: number;
  tracks: TimelineTrack[];
  clips: VideoClip[];
  audioClips: AudioClip[];
  subtitles: SubtitleCue[];
  textOverlays: TextOverlay[];
  effects: string[];
  musicId?: string;
  videoUrl?: string;
  thumbnail?: string;
  title?: string;
  description?: string;
  tags?: string[];
  /** إعدادات مزج الصوت: تطبيع وخفض الموسيقى تحت الكلام. */
  audioMix?: AudioMix;
  /** وسائط مُدارة على الخادم (مساحة عمل MCP) — url نسبي داخل مجلد المشروع. اختياري للواجهة. */
  assets?: MediaAsset[];
  /** نسخة مخطط المشروع (انظر lib/engine/project-schema.ts). */
  schemaVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export type AIJobStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface AIJob {
  id: string;
  kind: string;
  label: string;
  status: AIJobStatus;
  progress: number;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  result?: unknown;
}

export interface AppNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  timestamp: number;
}
