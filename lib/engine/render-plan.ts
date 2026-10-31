// ====================================================================
// خطة الرندر المتحقَّقة (RenderPlan) — الطبقة الفاصلة بين التحرير والرندر.
//
//   ProjectState (تحرير) ──buildRenderPlan──▶ RenderPlan (بيانات متحقَّقة، بلا ffmpeg)
//   RenderPlan ──compileRenderPlan (render-compile.ts)──▶ وسائط ffmpeg
//
// دوال نقية بلا I/O: المصادر تأتي جاهزة في SourceMap (حلّها الخادم من مراجع معتمة).
// كل مشكلة تُرجَع كـ RenderIssue — لا إسقاط صامت: مصدر مفقود/تداخل/صوت بلا ملف = خطأ صريح.
// ====================================================================
import type { AudioClip, ClipKeyframes, ClipTransition, ProjectState, SubtitleCue, TextOverlay, VideoClip } from "@/lib/types";
import { resolveOutputSize } from "./render-presets";

export interface SourceInfo {
  /** مسار ملف على الخادم (حُلّ ووُثّق من مرجع معتم). */
  path: string;
  kind: "video" | "image" | "audio";
  hasAudio: boolean;
  /** مدة المصدر بالثواني (0 = غير معروفة؛ صور ثابتة = 0). */
  duration: number;
}
/** المفتاح: assetId للمرئيات، و`audio:<clipId>` لمقاطع الصوت المضافة. */
export type SourceMap = Record<string, SourceInfo>;

export interface RenderIssue {
  severity: "error" | "warning";
  code:
    | "SOURCE_MISSING"
    | "AUDIO_SOURCE_MISSING"
    | "TRACK_OVERLAP"
    | "BEYOND_SOURCE"
    | "EMPTY_TIMELINE"
    | "RANGE_EMPTY"
    | "NO_AUDIO_TRACK";
  message: string;
  ref?: string;
}

export interface VideoLayer {
  clipId: string;
  trackId: string;
  /** ترتيب التراكب: الأكبر فوق. */
  order: number;
  sourceKey: string;
  kind: "video" | "image";
  /** بداية/مدة على التايملاين مُقرَّبتان لشبكة الإطارات. */
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  scale: number;
  posX: number;
  posY: number;
  rotation: number;
  opacity: number;
  zoom: number;
  panX: number;
  panY: number;
  crop?: { left: number; top: number; right: number; bottom: number };
  fadeIn: number;
  fadeOut: number;
  transitionIn?: ClipTransition;
  keyframes?: ClipKeyframes;
  /** يُحمَل آخر إطار هذه المدة بعد النهاية ليبقى تحت انتقال المقطع التالي. */
  holdTail: number;
  /** مدة الانتقال الخارج (يُخفِت صوت هذا المقطع). */
  transitionOut: number;
  colorFilter?: string;
  color?: VideoClip["color"];
  effects: string[];
  /** صوت المقطع. */
  audio: { enabled: boolean; volume: number; fadeIn: number; fadeOut: number };
}

export interface AudioLayer {
  id: string;
  /** مفتاح مصدر الصوت في SourceMap. */
  sourceKey: string;
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** ناقل الصوت: "voice" = فيديو/تعليق/دبلجة، "music" = موسيقى/مؤثرات. */
  bus: "voice" | "music";
  origin: "video-clip" | "audio-clip";
}

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  duration: number;
  layers: VideoLayer[];
  audio: AudioLayer[];
  subtitles: SubtitleCue[];
  overlays: TextOverlay[];
  mix: { normalize: boolean; targetLufs: number; ducking: { enabled: boolean; amountDb: number } };
  issues: RenderIssue[];
  /** لا أخطاء (التحذيرات لا تمنع). */
  ok: boolean;
}

export interface BuildOptions {
  /** نافذة معاينة من التايملاين. */
  range?: { start: number; end: number };
  size?: [number, number];
  /** تحويل خطأ «صوت بلا ملف» إلى تحذير (إقرار المستخدم بفقدانه). */
  allowMissingAudio?: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
type Flagged = VideoClip & { _removed?: boolean };

/** يقرّب زمناً إلى أقرب حدّ إطار (دقة الإطار على التايملاين). */
export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

function clipSpan(c: VideoClip): number {
  const src = c.outPoint > c.inPoint ? c.outPoint - c.inPoint : c.duration * (c.speed || 1);
  return src / (c.speed || 1);
}

const NEW_CLIP_PROPS = ["rotation", "opacity", "scale", "posX", "posY", "crop", "fadeIn", "fadeOut", "transitionIn", "color", "audioFadeIn", "audioFadeOut", "keyframes"] as const;

/**
 * هل يحتاج المشروع المركِّب متعدد المسارات؟ (غير ذلك يبقى المسار القديم بلصق التتابع.)
 * الاختبار الفاصل: لا فرق بصري بين المسارين لمشروع مسار واحد متتابع من مصدر واحد.
 */
export function needsCompositor(p: ProjectState, sources?: SourceMap): boolean {
  const vids = p.tracks.filter((t) => t.kind === "video");
  const live = (p.clips as Flagged[]).filter((c) => !c._removed);
  const usedTracks = new Set(live.filter((c) => c.kind !== "image").map((c) => c.trackId));
  if (vids.filter((t) => usedTracks.has(t.id)).length > 1) return true;
  if (vids.some((t) => t.magnetic === false && live.some((c) => c.trackId === t.id))) return true;
  if (vids.some((t) => t.hidden)) return true;
  if (live.some((c) => NEW_CLIP_PROPS.some((k) => c[k] !== undefined && !(k === "opacity" && c[k] === 1) && !(k === "scale" && c[k] === 1)))) return true;
  // زوم/تحريك/تأثيرات لكل مقطع كانت للعرض فقط في المسار القديم (F-14/F-15) — المركِّب ينفّذها.
  if (live.some((c) => (c.zoom ?? 1) > 1.0001 || Math.abs(c.panX ?? 0) > 1e-4 || Math.abs(c.panY ?? 0) > 1e-4 || (c.effects ?? []).some((e) => e !== "fx_slide_l"))) return true;
  const assetIds = new Set(live.filter((c) => c.kind !== "image").map((c) => c.assetId));
  if (assetIds.size > 1 && (p.assets || (sources && [...assetIds].every((a) => sources[a])))) return true;
  // صوت مرفوع بسيط (ref فقط) يمزجه المسار القديم؛ المركِّب لما يتجاوزه (تلاشي/نقطة دخول/إعدادات مزج).
  if (p.audioClips.some((a) => a.fadeIn || a.fadeOut || a.inPoint)) return true;
  if (p.audioMix) return true;
  return false;
}

function isMagnetic(p: ProjectState, trackId: string): boolean {
  return p.tracks.find((t) => t.id === trackId)?.magnetic !== false;
}

export function buildRenderPlan(project: ProjectState, sources: SourceMap, opts: BuildOptions = {}): RenderPlan {
  const issues: RenderIssue[] = [];
  const fps = project.fps;
  const [width, height] = opts.size ?? resolveOutputSize(project.resolution, project.aspect);
  const frame = 1 / fps;
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const videoTracks = project.tracks.filter((t) => t.kind === "video");
  const videoTrackIds = new Set(videoTracks.map((t) => t.id));
  const hidden = new Set(videoTracks.filter((t) => t.hidden).map((t) => t.id));
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));

  // ---- المقاطع المرئية: ترتيب المسارات ثم الزمن؛ ترصيف المسارات المغناطيسية ----
  const live = (project.clips as Flagged[])
    .filter((c) => !c._removed)
    .filter((c) => videoTrackIds.size === 0 || videoTrackIds.has(c.trackId));
  const byTrack = new Map<string, Flagged[]>();
  for (const c of live) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c]);

  const layers: VideoLayer[] = [];
  let order = 0;
  const trackOrder = [...byTrack.keys()].sort((a, b) => (trackIndex.get(a) ?? 0) - (trackIndex.get(b) ?? 0));
  for (const trackId of trackOrder) {
    if (hidden.has(trackId)) continue;
    const clips = byTrack.get(trackId)!.slice().sort((a, b) => a.start - b.start);
    const magnetic = isMagnetic(project, trackId);
    let cursor = 0;
    let prev: VideoLayer | null = null;
    for (const c of clips) {
      const key = c.kind === "image" && sources[`img:${c.id}`] ? `img:${c.id}` : c.assetId;
      const src = sources[key];
      if (!src) {
        issues.push({ severity: "error", code: "SOURCE_MISSING", message: `مصدر المقطع «${c.id}» (أصل ${c.assetId}) غير متوفر — لن يُرندَر بصمت`, ref: c.id });
        continue;
      }
      const speed = c.speed || 1;
      const isImage = c.kind === "image" || src.kind === "image";
      const durRaw = clipSpan(c);
      const start = snapToFrame(magnetic ? cursor : c.start, fps);
      const duration = Math.max(frame, snapToFrame(durRaw, fps));
      cursor = start + duration;
      const inPoint = Math.max(0, c.inPoint);
      if (!isImage && src.duration > 0 && inPoint + duration * speed > src.duration + 0.1) {
        issues.push({ severity: "warning", code: "BEYOND_SOURCE", message: `المقطع «${c.id}» يتجاوز نهاية مصدره (${r3(src.duration)}s) — سيُقتطع`, ref: c.id });
      }
      const layer: VideoLayer = {
        clipId: c.id,
        trackId,
        order: order++,
        sourceKey: key,
        kind: isImage ? "image" : "video",
        start: r3(start),
        duration: r3(duration),
        inPoint: r3(inPoint),
        speed,
        scale: c.scale ?? 1,
        posX: c.posX ?? 0,
        posY: c.posY ?? 0,
        rotation: c.rotation ?? 0,
        opacity: c.opacity ?? 1,
        zoom: Math.max(1, c.zoom ?? 1),
        panX: c.panX ?? 0,
        panY: c.panY ?? 0,
        crop: c.crop,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
        transitionIn: c.transitionIn,
        keyframes: c.keyframes,
        holdTail: 0,
        transitionOut: 0,
        colorFilter: c.colorFilter,
        color: c.color,
        effects: [...new Set([...(c.effects ?? []), ...project.effects])].filter((e) => e !== "fx_slide_l"),
        audio: {
          enabled: !isImage && src.hasAudio && !muted.has(trackId) && (c.volume ?? 1) > 0,
          volume: c.volume ?? 1,
          fadeIn: c.audioFadeIn ?? 0,
          fadeOut: c.audioFadeOut ?? 0,
        },
      };
      // fx_slide_l على مستوى المشروع = انتقال انزلاق افتراضي (توافق مع المسار القديم).
      if (!layer.transitionIn && project.effects.includes("fx_slide_l") && prev) {
        layer.transitionIn = { type: "slide-left", duration: 0.5 };
      }
      // تداخل على مسار حرّ = خطأ (المسارات المغناطيسية مرصَّفة فلا تتداخل).
      if (prev && layer.start < prev.start + prev.duration - frame / 2) {
        issues.push({
          severity: "error",
          code: "TRACK_OVERLAP",
          message: `المقطعان «${prev.clipId}» و«${c.id}» يتداخلان على المسار نفسه — انقل أحدهما إلى مسار آخر`,
          ref: c.id,
        });
      }
      // الانتقال يتطلب سابقاً متلاصقاً على المسار نفسه ليبقى تحته.
      if (layer.transitionIn && prev && Math.abs(layer.start - (prev.start + prev.duration)) <= frame + 1e-3) {
        const d = Math.min(layer.transitionIn.duration, layer.duration, prev.duration);
        layer.transitionIn = { ...layer.transitionIn, duration: r3(d) };
        prev.holdTail = r3(d);
        prev.transitionOut = r3(d);
      }
      layers.push(layer);
      prev = layer;
    }
  }

  // ---- الصوت ----
  const audio: AudioLayer[] = [];
  for (const l of layers) {
    if (!l.audio.enabled) continue;
    audio.push({
      id: `clip:${l.clipId}`,
      sourceKey: l.sourceKey,
      start: l.start,
      duration: l.duration,
      inPoint: l.inPoint,
      speed: l.speed,
      volume: l.audio.volume,
      fadeIn: Math.max(l.audio.fadeIn, l.transitionIn?.duration ?? 0),
      fadeOut: Math.max(l.audio.fadeOut, l.transitionOut),
      bus: "voice",
      origin: "video-clip",
    });
  }
  for (const a of project.audioClips) {
    if (muted.has(a.trackId)) continue;
    const key = `audio:${a.id}`;
    const src = sources[key];
    if (!src) {
      issues.push({
        severity: opts.allowMissingAudio ? "warning" : "error",
        code: "AUDIO_SOURCE_MISSING",
        message: `المقطع الصوتي «${a.name || a.id}» لا يشير إلى ملف على الخادم (blob/رابط متصفح) — ارفعه عبر /api/assets/upload${opts.allowMissingAudio ? " (سيُحذف من المخرَج)" : ""}`,
        ref: a.id,
      });
      continue;
    }
    if (!src.hasAudio) {
      issues.push({ severity: "warning", code: "NO_AUDIO_TRACK", message: `الملف «${a.name || a.id}» بلا مسار صوت`, ref: a.id });
      continue;
    }
    const inPoint = Math.max(0, a.inPoint ?? 0);
    const avail = src.duration > 0 ? Math.max(0, src.duration - inPoint) : a.duration;
    const duration = Math.max(0.01, Math.min(a.duration > 0 ? a.duration : avail, avail > 0 ? avail : a.duration));
    audio.push({
      id: `audio:${a.id}`,
      sourceKey: key,
      start: r3(Math.max(0, a.start)),
      duration: r3(duration),
      inPoint: r3(inPoint),
      speed: 1,
      volume: a.volume,
      fadeIn: a.fadeIn ?? 0,
      fadeOut: a.fadeOut ?? 0,
      bus: a.kind === "music" || a.kind === "sfx" ? "music" : "voice",
      origin: "audio-clip",
    });
  }

  // طول المخرَج = نهاية آخر طبقة مرئية؛ الصوت الأطول يُقتطع عندها (دلالة موثّقة).
  // لا طبقات مرئية (مشروع صوتي) ⇒ نهاية آخر مقطع صوت.
  let duration = layers.length > 0 ? Math.max(...layers.map((l) => l.start + l.duration)) : Math.max(0, ...audio.map((a) => a.start + a.duration));
  duration = snapToFrame(duration, fps);
  if (layers.length === 0 && audio.length === 0) {
    issues.push({ severity: "error", code: "EMPTY_TIMELINE", message: "لا محتوى قابل للرندر على التايملاين" });
  }

  let subtitles = project.subtitles;
  let overlays = project.textOverlays;
  let outLayers = layers;
  let outAudio = audio;
  let outDuration = duration;
  if (opts.range) {
    const { start: a, end: b } = opts.range;
    outDuration = Math.max(0, Math.min(b, duration) - a);
    outLayers = layers.flatMap((l) => clampLayer(l, a, b));
    outAudio = audio.flatMap((x) => clampAudio(x, a, b));
    const shift = <T extends { start: number; end: number }>(items: T[]): T[] =>
      items
        .filter((x) => x.end > a && x.start < b)
        .map((x) => ({ ...x, start: r3(Math.max(0, x.start - a)), end: r3(Math.min(b, x.end) - a) }));
    subtitles = shift(subtitles);
    overlays = shift(overlays);
    if (outDuration <= 0.01 || (outLayers.length === 0 && outAudio.length === 0)) {
      issues.push({ severity: "error", code: "RANGE_EMPTY", message: "نافذة المعاينة لا تتقاطع مع أي محتوى" });
    }
  }

  const mix = {
    normalize: project.audioMix?.normalize ?? true,
    targetLufs: project.audioMix?.targetLufs ?? -16,
    ducking: { enabled: project.audioMix?.ducking?.enabled ?? false, amountDb: project.audioMix?.ducking?.amountDb ?? 12 },
  };

  return {
    width,
    height,
    fps,
    duration: r3(Math.max(outDuration, 0.1)),
    layers: outLayers,
    audio: outAudio,
    subtitles,
    overlays,
    mix,
    issues,
    ok: !issues.some((i) => i.severity === "error"),
  };
}

/** يقصّ طبقة إلى نافذة [a,b) ويزيحها بـ −a (يتقدّم inPoint بقدر الجزء المقطوع من البداية). */
function clampLayer(l: VideoLayer, a: number, b: number): VideoLayer[] {
  const end = l.start + l.duration + l.holdTail;
  if (end <= a || l.start >= b) return [];
  const cutHead = Math.max(0, a - l.start);
  const newStart = Math.max(0, l.start - a);
  const newDur = Math.min(l.start + l.duration, b) - Math.max(l.start, a);
  if (newDur <= 0.001) return [];
  return [
    {
      ...l,
      start: r3(newStart),
      duration: r3(newDur),
      inPoint: r3(l.inPoint + cutHead * l.speed),
      // البداية المقطوعة تُسقط الانتقال/التلاشي الداخل.
      fadeIn: cutHead > 0 ? 0 : l.fadeIn,
      transitionIn: cutHead > 0 ? undefined : l.transitionIn,
      // المفاتيح بزمن المقطع: قصّ البداية يزيحها لتبقى متطابقة مع نفس لحظات المحتوى.
      keyframes: cutHead > 0 && l.keyframes ? shiftKeyframes(l.keyframes, cutHead) : l.keyframes,
      holdTail: l.start + l.duration > b ? 0 : l.holdTail,
    },
  ];
}

function shiftKeyframes(k: ClipKeyframes, by: number): ClipKeyframes {
  const out: ClipKeyframes = {};
  for (const [prop, arr] of Object.entries(k)) if (arr) out[prop as keyof ClipKeyframes] = arr.map((x) => ({ t: r3(x.t - by), v: x.v }));
  return out;
}

function clampAudio(x: AudioLayer, a: number, b: number): AudioLayer[] {
  if (x.start + x.duration <= a || x.start >= b) return [];
  const cutHead = Math.max(0, a - x.start);
  const newDur = Math.min(x.start + x.duration, b) - Math.max(x.start, a);
  if (newDur <= 0.001) return [];
  return [{ ...x, start: r3(Math.max(0, x.start - a)), duration: r3(newDur), inPoint: r3(x.inPoint + cutHead * x.speed), fadeIn: cutHead > 0 ? 0 : x.fadeIn }];
}

export type { AudioClip };
