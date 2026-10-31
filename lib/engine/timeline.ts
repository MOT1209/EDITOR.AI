// ====================================================================
// عمليات التايملاين — دوال نقية على ProjectState (لا I/O).
// المصدر الوحيد لمنطق التعديل: يستخدمها خادم MCP (عبر المخزن) ومختزل الواجهة.
//
// نموذج التايملاين المعتمد (مطابق لخطة التصدير في ffmpeg-export.ts):
// - مقاطع مسارات الفيديو «مغناطيسية»: التصدير يلصقها بترتيب start دون فجوات،
//   لذا كل عملية تعيد ترصيف (ripple) المسار: start = مجموع مدد ما قبله.
// - مدة المقطع على التايملاين = (outPoint - inPoint) / speed.
// - الترجمات والنصوص بتوقيت التايملاين (مخرَج التصدير)، لا بتوقيت المصدر.
// ====================================================================
import type { AudioClip, ProjectState, SubtitleCue, TextOverlay, VideoClip } from "@/lib/types";
import { EngineError } from "./errors";
import { COLOR_FILTER_IDS, EFFECT_IDS, LIMITS, TRANSITION_TYPES, audioClipSchema, clipSchema } from "./project-schema";
import { needsCompositor, snapToFrame } from "./render-plan";

/** أقصر مقطع مسموح بعد التقسيم/القص (ثوانٍ). */
export const MIN_CLIP_SECONDS = 0.05;

let idCounter = 0;
/** مولّد معرّفات حتمي الشكل (لا يعتمد على crypto ليعمل في المتصفح وNode). */
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${idCounter.toString(36)}`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function clipDuration(c: Pick<VideoClip, "inPoint" | "outPoint" | "speed" | "duration">): number {
  const span = c.outPoint > c.inPoint ? c.outPoint - c.inPoint : c.duration;
  return round(span / (c.speed || 1));
}

function videoTrackIds(p: ProjectState): Set<string> {
  return new Set(p.tracks.filter((t) => t.kind === "video").map((t) => t.id));
}

/** مقاطع الفيديو المصدّرة (غير الصور وغير المحذوفة) بترتيب التايملاين. */
export function exportClips(p: ProjectState): VideoClip[] {
  const vids = videoTrackIds(p);
  return p.clips
    .filter((c) => c.kind !== "image" && !(c as VideoClip & { _removed?: boolean })._removed)
    .filter((c) => vids.size === 0 || vids.has(c.trackId))
    .slice()
    .sort((a, b) => a.start - b.start);
}

/** مدة المخرَج المتوقعة كما سيبنيها التصدير. */
export function timelineDuration(p: ProjectState): number {
  const clips = exportClips(p);
  if (clips.length === 0) return round(Math.max(p.duration, 0));
  if (needsCompositor(p)) return compositeDuration(p);
  return round(clips.reduce((s, c) => s + clipDuration(c), 0));
}

/** مدة المركِّب: نهاية أبعد طبقة (مسار مغناطيسي = مجموع مدده؛ حرّ = start+مدة). */
export function compositeDuration(p: ProjectState): number {
  const hidden = new Set(p.tracks.filter((t) => t.hidden).map((t) => t.id));
  const perTrack = new Map<string, VideoClip[]>();
  for (const c of exportClips(p)) {
    if (hidden.has(c.trackId)) continue;
    perTrack.set(c.trackId, [...(perTrack.get(c.trackId) ?? []), c]);
  }
  let end = 0;
  for (const [trackId, clips] of perTrack) {
    if (isMagnetic(p, trackId)) end = Math.max(end, clips.reduce((s, c) => s + clipDuration(c), 0));
    else for (const c of clips) end = Math.max(end, snapToFrame(c.start, p.fps) + clipDuration(c));
  }
  return round(end);
}

/** المسار مغناطيسي (ترصيف بلا فجوات) ما لم يُعلَّم magnetic:false. */
export function isMagnetic(p: ProjectState, trackId: string): boolean {
  return p.tracks.find((t) => t.id === trackId)?.magnetic !== false;
}

/** يرصّف المسار إن كان مغناطيسياً؛ المسارات الحرّة تحتفظ بمواضعها المطلقة. */
function layoutTrack(p: ProjectState, clips: VideoClip[], trackId: string): VideoClip[] {
  if (!isMagnetic(p, trackId)) {
    return clips.map((c) => (c.trackId === trackId && c.kind !== "image" ? { ...c, duration: clipDuration(c) } : c));
  }
  return rippleTrack(clips, trackId);
}

/** يعيد ترصيف مقاطع مسار: تتابع بلا فجوات بالترتيب الحالي، ومدة متسقة مع in/out/speed. */
export function rippleTrack(clips: VideoClip[], trackId: string): VideoClip[] {
  // مقاطع الصور (B-roll) تراكب بزمن مطلق — لا تدخل في الترصيف.
  const onTrack = clips
    .filter((c) => c.trackId === trackId && c.kind !== "image")
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  const placed = new Map<string, VideoClip>();
  for (const c of onTrack) {
    const duration = clipDuration(c);
    placed.set(c.id, { ...c, start: round(cursor), duration });
    cursor += duration;
  }
  return clips.map((c) => placed.get(c.id) ?? c);
}

function findClip(p: ProjectState, clipId: string): VideoClip {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) {
    throw new EngineError("NOT_FOUND", `المقطع غير موجود: ${clipId}`, "استخدم list_clips لمعرفة المعرّفات الصالحة.");
  }
  return c;
}

function assertEditable(p: ProjectState, clip: VideoClip): void {
  const track = p.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) {
    throw new EngineError("CONFLICT", `المسار «${track.label}» مقفل`, "ألغِ قفل المسار أولاً.");
  }
  if (clip.kind === "image") {
    throw new EngineError("UNSUPPORTED", "عمليات القص لا تنطبق على مقاطع الصور الثابتة");
  }
}

function assetDuration(p: ProjectState, assetId: string): number | null {
  const a = p.assets?.find((x) => x.id === assetId);
  return a && a.duration > 0 ? a.duration : null;
}

function touch(p: ProjectState, patch: Partial<ProjectState>): ProjectState {
  return { ...p, ...patch, updatedAt: Date.now() };
}

/** يقسم مقطعاً عند زمن على التايملاين إلى مقطعين متتاليين. */
export function splitClip(p: ProjectState, clipId: string, atTime: number): { project: ProjectState; newClipId: string } {
  const c = findClip(p, clipId);
  assertEditable(p, c);
  const dur = clipDuration(c);
  const rel = atTime - c.start;
  if (!Number.isFinite(atTime) || rel < MIN_CLIP_SECONDS || rel > dur - MIN_CLIP_SECONDS) {
    throw new EngineError(
      "OUT_OF_RANGE",
      `زمن التقسيم ${atTime}s خارج المقطع [${c.start}, ${round(c.start + dur)}]`,
      `اختر زمناً بين ${round(c.start + MIN_CLIP_SECONDS)} و${round(c.start + dur - MIN_CLIP_SECONDS)}.`
    );
  }
  const inPoint = c.inPoint;
  const outPoint = c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration * (c.speed || 1);
  const cutSource = round(inPoint + rel * (c.speed || 1));
  const first: VideoClip = { ...c, outPoint: cutSource, duration: round(rel) };
  const second: VideoClip = {
    ...c,
    id: newId("clip"),
    start: round(atTime),
    inPoint: cutSource,
    outPoint: round(outPoint),
    duration: round(dur - rel),
  };
  if (p.clips.length + 1 > LIMITS.maxClips) throw new EngineError("LIMIT_EXCEEDED", "تجاوز الحد الأقصى لعدد المقاطع");
  const clips: VideoClip[] = [];
  for (const x of p.clips) {
    if (x.id === c.id) clips.push(first, second);
    else clips.push(x);
  }
  return { project: touch(p, { clips: layoutTrack(p, clips, c.trackId) }), newClipId: second.id };
}

/** يقصّ نقطتي الدخول/الخروج في زمن المصدر. */
export function trimClip(
  p: ProjectState,
  clipId: string,
  opts: { inPoint?: number; outPoint?: number }
): ProjectState {
  const c = findClip(p, clipId);
  assertEditable(p, c);
  const currentOut = c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration * (c.speed || 1);
  const inPoint = opts.inPoint ?? c.inPoint;
  const outPoint = opts.outPoint ?? currentOut;
  const max = assetDuration(p, c.assetId) ?? (c.assetId === "main" || !p.assets ? p.duration : null);
  if (inPoint < 0 || !Number.isFinite(inPoint) || !Number.isFinite(outPoint)) {
    throw new EngineError("INVALID_INPUT", "نقاط القص يجب أن تكون أرقاماً موجبة");
  }
  if (outPoint - inPoint < MIN_CLIP_SECONDS) {
    throw new EngineError("OUT_OF_RANGE", `outPoint (${outPoint}) يجب أن يتجاوز inPoint (${inPoint}) بـ ${MIN_CLIP_SECONDS}s على الأقل`);
  }
  if (max !== null && max > 0 && outPoint > max + 1e-3) {
    throw new EngineError("OUT_OF_RANGE", `outPoint ${outPoint}s يتجاوز مدة المصدر ${max}s`);
  }
  const clips = p.clips.map((x) =>
    x.id === c.id ? { ...x, inPoint: round(inPoint), outPoint: round(outPoint), duration: round((outPoint - inPoint) / (x.speed || 1)) } : x
  );
  return touch(p, { clips: layoutTrack(p, clips, c.trackId) });
}

/** ينقل مقطعاً إلى ترتيب جديد داخل مساره (نموذج مغناطيسي: الترتيب هو الموضع). */
export function moveClip(p: ProjectState, clipId: string, toIndex: number): ProjectState {
  const c = findClip(p, clipId);
  assertEditable(p, c);
  const onTrack = p.clips
    .filter((x) => x.trackId === c.trackId && x.kind !== "image")
    .sort((a, b) => a.start - b.start);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= onTrack.length) {
    throw new EngineError("OUT_OF_RANGE", `الفهرس ${toIndex} خارج [0, ${onTrack.length - 1}]`);
  }
  const without = onTrack.filter((x) => x.id !== c.id);
  without.splice(toIndex, 0, c);
  // إعادة ترقيم start مؤقتاً بالترتيب الجديد ثم الترصيف يحسب القيم النهائية.
  const order = new Map(without.map((x, i) => [x.id, i]));
  const clips = p.clips.map((x) => (order.has(x.id) ? { ...x, start: order.get(x.id)! } : x));
  return touch(p, { clips: layoutTrack(p, clips, c.trackId) });
}

export function deleteClip(p: ProjectState, clipId: string): ProjectState {
  const c = findClip(p, clipId);
  const track = p.tracks.find((t) => t.id === c.trackId);
  if (track?.locked) throw new EngineError("CONFLICT", `المسار «${track.label}» مقفل`);
  const clips = p.clips.filter((x) => x.id !== clipId);
  return touch(p, { clips: layoutTrack(p, clips, c.trackId) });
}

export function setClipVolume(p: ProjectState, clipId: string, volume: number): ProjectState {
  const c = findClip(p, clipId);
  assertEditable(p, c);
  if (!Number.isFinite(volume) || volume < 0 || volume > 2) {
    throw new EngineError("OUT_OF_RANGE", "مستوى الصوت يجب أن يكون بين 0 و2 (1 = الأصلي)");
  }
  return touch(p, { clips: p.clips.map((x) => (x.id === clipId ? { ...x, volume } : x)) });
}

function assertTimeRange(p: ProjectState, start: number, end: number, what: string): void {
  const total = timelineDuration(p);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new EngineError("INVALID_INPUT", `${what}: يجب أن يكون 0 ≤ start < end`);
  }
  if (total > 0 && start >= total) {
    throw new EngineError("OUT_OF_RANGE", `${what}: البداية ${start}s بعد نهاية التايملاين (${total}s)`);
  }
}

export interface OverlayInput {
  text: string;
  start: number;
  end: number;
  position?: TextOverlay["position"];
  color?: string;
  fontSize?: number;
  animation?: TextOverlay["animation"];
}

export function addTextOverlay(p: ProjectState, o: OverlayInput): { project: ProjectState; overlayId: string } {
  const text = o.text.trim();
  if (!text) throw new EngineError("INVALID_INPUT", "النص مطلوب");
  if (text.length > LIMITS.maxText) throw new EngineError("LIMIT_EXCEEDED", `النص أطول من ${LIMITS.maxText} حرفاً`);
  assertTimeRange(p, o.start, o.end, "النص");
  if (o.color && !/^#[0-9a-fA-F]{6}$/.test(o.color)) throw new EngineError("INVALID_INPUT", "اللون بصيغة #RRGGBB");
  if (p.textOverlays.length >= LIMITS.maxOverlays) throw new EngineError("LIMIT_EXCEEDED", "تجاوز حد النصوص");
  const overlay: TextOverlay = {
    id: newId("txt"),
    text,
    start: round(o.start),
    end: round(timelineDuration(p) > 0 ? Math.min(o.end, timelineDuration(p)) : o.end),
    position: o.position ?? "center",
    fontFamily: "Tajawal, system-ui, sans-serif",
    fontSize: o.fontSize ?? 48,
    color: o.color ?? "#FFFFFF",
    animation: o.animation ?? "fade",
  };
  return { project: touch(p, { textOverlays: [...p.textOverlays, overlay] }), overlayId: overlay.id };
}

export interface CaptionInput {
  start: number;
  end: number;
  text: string;
}

export function addCaptions(
  p: ProjectState,
  cues: CaptionInput[],
  opts: { lang?: string; replace?: boolean } = {}
): { project: ProjectState; added: number } {
  if (cues.length === 0) throw new EngineError("INVALID_INPUT", "لا توجد أسطر ترجمة");
  const lang = opts.lang ?? "ar";
  const sorted = cues.slice().sort((a, b) => a.start - b.start);
  sorted.forEach((c, i) => {
    assertTimeRange(p, c.start, c.end, `سطر الترجمة ${i}`);
    if (!c.text.trim()) throw new EngineError("INVALID_INPUT", `سطر الترجمة ${i} فارغ`);
    if (c.text.length > LIMITS.maxText) throw new EngineError("LIMIT_EXCEEDED", `سطر الترجمة ${i} طويل جداً`);
    if (i > 0 && c.start < sorted[i - 1].end - 1e-3) {
      throw new EngineError("CONFLICT", `أسطر الترجمة متداخلة عند ${c.start}s`, "رتّب الأسطر بلا تداخل زمني.");
    }
  });
  const base = opts.replace ? [] : p.subtitles;
  if (base.length + sorted.length > LIMITS.maxSubtitles) throw new EngineError("LIMIT_EXCEEDED", "تجاوز حد الترجمات");
  const added: SubtitleCue[] = sorted.map((c) => ({
    id: newId("sub"),
    start: round(c.start),
    end: round(c.end),
    text: c.text.trim(),
    lang,
  }));
  const subtitles = [...base, ...added].sort((a, b) => a.start - b.start);
  return { project: touch(p, { subtitles }), added: added.length };
}

export type EffectInput =
  | { kind: "project_effect"; effectId: string; enabled: boolean }
  | { kind: "color_filter"; clipId: string; filter: string };

/**
 * تأثيرات المشروع (project.effects) تُطبَّق في التصدير على كل المقاطع؛ فلتر اللون
 * لكل مقطع (clip.colorFilter). حقل clip.effects للعرض فقط ولا يقرؤه التصدير.
 */
export function applyEffect(p: ProjectState, e: EffectInput): ProjectState {
  if (e.kind === "project_effect") {
    if (!(EFFECT_IDS as readonly string[]).includes(e.effectId)) {
      throw new EngineError("INVALID_INPUT", `تأثير غير معروف: ${e.effectId}`, `المتاح: ${EFFECT_IDS.join(", ")}`);
    }
    const has = p.effects.includes(e.effectId);
    const effects = e.enabled ? (has ? p.effects : [...p.effects, e.effectId]) : p.effects.filter((x) => x !== e.effectId);
    return touch(p, { effects });
  }
  if (!(COLOR_FILTER_IDS as readonly string[]).includes(e.filter)) {
    throw new EngineError("INVALID_INPUT", `فلتر لون غير معروف: ${e.filter}`, `المتاح: ${COLOR_FILTER_IDS.join(", ")}`);
  }
  const c = findClip(p, e.clipId);
  assertEditable(p, c);
  return touch(p, { clips: p.clips.map((x) => (x.id === c.id ? { ...x, colorFilter: e.filter } : x)) });
}

export function addAudioClip(
  p: ProjectState,
  a: { name: string; url: string; start: number; duration: number; volume: number; kind: AudioClip["kind"] }
): { project: ProjectState; audioClipId: string } {
  if (a.volume < 0 || a.volume > 2) throw new EngineError("OUT_OF_RANGE", "مستوى الصوت بين 0 و2");
  if (a.start < 0 || a.duration <= 0) throw new EngineError("INVALID_INPUT", "start ≥ 0 وduration > 0");
  let tracks = p.tracks;
  let track = tracks.find((t) => t.kind === "audio");
  if (!track) {
    track = { id: "t_audio", kind: "audio", label: "صوت وموسيقى", height: 48, muted: false, locked: false };
    tracks = [...tracks, track];
  }
  const clip: AudioClip = { id: newId("aud"), trackId: track.id, ...a };
  return { project: touch(p, { tracks, audioClips: [...p.audioClips, clip] }), audioClipId: clip.id };
}

/** ملخص قصير للتايملاين (للوكلاء والواجهة). */
export function summarizeTimeline(p: ProjectState) {
  return {
    durationSeconds: timelineDuration(p),
    sourceDurationSeconds: p.duration,
    tracks: p.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      label: t.label,
      muted: t.muted,
      locked: t.locked,
      clipCount:
        t.kind === "subtitle"
          ? p.subtitles.length
          : t.kind === "audio"
            ? p.audioClips.filter((a) => a.trackId === t.id).length
            : p.clips.filter((c) => c.trackId === t.id).length,
    })),
    clips: exportClips(p).map((c, index) => ({
      id: c.id,
      index,
      trackId: c.trackId,
      assetId: c.assetId,
      start: c.start,
      end: round(c.start + clipDuration(c)),
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      speed: c.speed,
      volume: c.volume,
      colorFilter: c.colorFilter ?? "none",
    })),
    subtitles: p.subtitles.length,
    textOverlays: p.textOverlays.length,
    audioClips: p.audioClips.length,
    effects: p.effects,
  };
}

// ---------------------------------------------------------------- تشغيل المعاينة
// المعاينة في المتصفح تشغّل الفيديو المصدر؛ هاتان الدالتان تربطان زمن التايملاين
// (ما سيُصدَّر) بزمن المصدر حتى يتبع المشغّل خطة التصدير نفسها (يقفز فوق المقطوع).

export interface PlaybackPosition {
  clip: VideoClip | null;
  index: number;
  sourceTime: number;
}

/** زمن تايملاين → المقطع وزمن المصدر. بلا مقاطع: تطابق مباشر مع المصدر. */
export function timelineToSource(p: ProjectState, t: number): PlaybackPosition | null {
  const clips = exportClips(p);
  if (clips.length === 0) return { clip: null, index: -1, sourceTime: Math.max(0, t) };
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const d = clipDuration(c);
    if (t < acc + d || i === clips.length - 1) {
      const rel = Math.min(Math.max(0, t - acc), d);
      return { clip: c, index: i, sourceTime: round(c.inPoint + rel * (c.speed || 1)) };
    }
    acc += d;
  }
  return null;
}

/** أثناء التشغيل: زمن المصدر الحالي ضمن المقطع رقم index → زمن التايملاين. */
export function sourceToTimelineAt(p: ProjectState, index: number, sourceTime: number): number {
  const clips = exportClips(p);
  if (index < 0 || clips.length === 0) return sourceTime;
  let acc = 0;
  for (let i = 0; i < index; i++) acc += clipDuration(clips[i]);
  const c = clips[index];
  return round(acc + Math.max(0, sourceTime - c.inPoint) / (c.speed || 1));
}

/** نهاية مقطع بزمن المصدر (مع مراعاة مقاطع المشاهد بلا outPoint). */
export function clipSourceEnd(c: VideoClip): number {
  return c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration * (c.speed || 1);
}

// ---------------------------------------------------------------- مسارات متعددة ورؤوس الخصائص
// كل ما يلي دوال نقية يستخدمها المحرّر وMCP معاً؛ التحقق من القيم عبر مخطط project-schema
// (مصدر واحد للحدود) فلا تُقبل قيمة تعجز خطة الرندر عن تنفيذها.

export { snapToFrame };

function findTrack(p: ProjectState, trackId: string) {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t) throw new EngineError("NOT_FOUND", `المسار غير موجود: ${trackId}`);
  return t;
}

export type ClipPatch = Partial<
  Pick<VideoClip, "volume" | "speed" | "zoom" | "panX" | "panY" | "rotation" | "opacity" | "scale" | "posX" | "posY" | "crop" | "fadeIn" | "fadeOut" | "audioFadeIn" | "audioFadeOut" | "color" | "colorFilter" | "effects">
> & { transitionIn?: VideoClip["transitionIn"] | null };

const CLIP_PATCH_KEYS = new Set(["volume", "speed", "zoom", "panX", "panY", "rotation", "opacity", "scale", "posX", "posY", "crop", "fadeIn", "fadeOut", "audioFadeIn", "audioFadeOut", "color", "colorFilter", "effects", "transitionIn"]);

/** يعدّل خصائص مقطع (موضع/تحجيم/تدوير/شفافية/اقتصاص/صوت/سرعة/ألوان/انتقال) بتحقق صارم. */
export function setClipProps(p: ProjectState, clipId: string, patch: ClipPatch): ProjectState {
  const c = findClip(p, clipId);
  const track = p.tracks.find((t) => t.id === c.trackId);
  if (track?.locked) throw new EngineError("CONFLICT", `المسار «${track.label}» مقفل`, "ألغِ قفل المسار أولاً.");
  for (const k of Object.keys(patch)) {
    if (!CLIP_PATCH_KEYS.has(k)) throw new EngineError("INVALID_INPUT", `خاصية غير قابلة للتعديل: ${k}`);
  }
  const { transitionIn, ...rest } = patch;
  const merged: VideoClip = { ...c, ...rest };
  if (transitionIn === null) delete merged.transitionIn;
  else if (transitionIn) {
    if (!(TRANSITION_TYPES as readonly string[]).includes(transitionIn.type)) throw new EngineError("INVALID_INPUT", `نوع انتقال غير مدعوم: ${transitionIn.type}`);
    merged.transitionIn = transitionIn;
  }
  if (merged.colorFilter && !(COLOR_FILTER_IDS as readonly string[]).includes(merged.colorFilter)) {
    throw new EngineError("INVALID_INPUT", `مرشح لوني غير معروف: ${merged.colorFilter}`);
  }
  for (const e of merged.effects) {
    if (!(EFFECT_IDS as readonly string[]).includes(e)) throw new EngineError("INVALID_INPUT", `تأثير غير مدعوم: ${e}`);
  }
  const r = clipSchema.safeParse(merged);
  if (!r.success) {
    throw new EngineError("OUT_OF_RANGE", r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("؛ "));
  }
  const next: VideoClip = { ...merged, duration: clipDuration(merged) };
  const clips = p.clips.map((x) => (x.id === clipId ? next : x));
  return touch(p, { clips: layoutTrack(p, clips, c.trackId) });
}

/** يدمج مقطعين متتاليين من الأصل نفسه بمصدر متصل (عكس التقسيم). */
export function mergeClips(p: ProjectState, firstId: string, secondId: string): ProjectState {
  const a = findClip(p, firstId);
  const b = findClip(p, secondId);
  assertEditable(p, a);
  assertEditable(p, b);
  if (a.trackId !== b.trackId) throw new EngineError("CONFLICT", "المقطعان على مسارين مختلفين");
  if (a.assetId !== b.assetId) throw new EngineError("CONFLICT", "المقطعان من أصلين مختلفين");
  if ((a.speed || 1) !== (b.speed || 1)) throw new EngineError("CONFLICT", "سرعتا المقطعين مختلفتان");
  const aEnd = a.start + clipDuration(a);
  const frame = 1 / (p.fps || 30);
  if (Math.abs(b.start - aEnd) > frame) throw new EngineError("CONFLICT", "المقطعان غير متلاصقين على التايملاين");
  if (Math.abs(clipSourceEnd(a) - b.inPoint) > frame) {
    throw new EngineError("CONFLICT", "المصدر غير متصل بين المقطعين — الدمج سيغيّر المحتوى", "الدمج مسموح فقط لمقطعين نتجا عن تقسيم دون قص بينهما.");
  }
  const merged: VideoClip = { ...a, outPoint: round(clipSourceEnd(b)), duration: round((clipSourceEnd(b) - a.inPoint) / (a.speed || 1)) };
  const clips = p.clips.filter((x) => x.id !== b.id).map((x) => (x.id === a.id ? merged : x));
  return touch(p, { clips: layoutTrack(p, clips, a.trackId) });
}

/** ينقل مقطعاً إلى مسار فيديو آخر (أو يعيد تموضعه) — start للمسارات الحرّة، وللمغناطيسية يحدد الترتيب. */
export function moveClipToTrack(p: ProjectState, clipId: string, trackId: string, start?: number): ProjectState {
  const c = findClip(p, clipId);
  assertEditable(p, c);
  const target = findTrack(p, trackId);
  if (target.kind !== "video") throw new EngineError("INVALID_INPUT", `المسار «${target.label}» ليس مسار فيديو`);
  if (target.locked) throw new EngineError("CONFLICT", `المسار «${target.label}» مقفل`);
  const at = start === undefined ? c.start : start;
  if (!Number.isFinite(at) || at < 0) throw new EngineError("INVALID_INPUT", "start يجب أن يكون ≥ 0");
  const snapped = snapToFrame(at, p.fps || 30);
  const dur = clipDuration(c);
  if (!isMagnetic(p, trackId)) {
    const clash = p.clips.find(
      (x) => x.id !== c.id && x.trackId === trackId && x.kind !== "image" && snapped < x.start + clipDuration(x) - 1e-6 && snapped + dur > x.start + 1e-6
    );
    if (clash) throw new EngineError("CONFLICT", `يتداخل مع المقطع «${clash.id}» على المسار نفسه`, "اختر موضعاً خالياً أو مساراً آخر.");
  }
  const moved: VideoClip = { ...c, trackId, start: round(snapped) };
  let clips = p.clips.map((x) => (x.id === c.id ? moved : x));
  clips = layoutTrack(p, clips, trackId);
  if (c.trackId !== trackId) clips = layoutTrack(p, clips, c.trackId);
  return touch(p, { clips });
}

export function addTrack(p: ProjectState, kind: "video" | "audio", opts: { label?: string; magnetic?: boolean } = {}): { project: ProjectState; trackId: string } {
  if (p.tracks.length >= LIMITS.maxTracks) throw new EngineError("LIMIT_EXCEEDED", "تجاوز الحد الأقصى لعدد المسارات");
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const id = newId(kind === "video" ? "tv" : "ta");
  const track = {
    id,
    kind,
    label: (opts.label ?? (kind === "video" ? `فيديو ${n}` : `صوت ${n}`)).slice(0, LIMITS.maxName),
    height: kind === "video" ? 64 : 48,
    muted: false,
    locked: false,
    ...(kind === "video" ? { magnetic: opts.magnetic ?? (n === 1) } : {}),
  };
  return { project: touch(p, { tracks: [...p.tracks, track] }), trackId: id };
}

export function removeTrack(p: ProjectState, trackId: string): ProjectState {
  const t = findTrack(p, trackId);
  const used = p.clips.some((c) => c.trackId === trackId) || p.audioClips.some((a) => a.trackId === trackId);
  if (used) throw new EngineError("CONFLICT", `المسار «${t.label}» يحتوي مقاطع`, "انقل المقاطع أو احذفها أولاً.");
  if (p.tracks.filter((x) => x.kind === t.kind).length <= 1) throw new EngineError("CONFLICT", "لا يمكن حذف آخر مسار من هذا النوع");
  return touch(p, { tracks: p.tracks.filter((x) => x.id !== trackId) });
}

export function setTrackFlags(
  p: ProjectState,
  trackId: string,
  flags: { muted?: boolean; hidden?: boolean; locked?: boolean; magnetic?: boolean; label?: string; height?: number }
): ProjectState {
  const t = findTrack(p, trackId);
  if (flags.hidden !== undefined && t.kind !== "video") throw new EngineError("INVALID_INPUT", "الإخفاء لمسارات الفيديو فقط");
  if (flags.height !== undefined && !(flags.height >= 24 && flags.height <= 240)) throw new EngineError("OUT_OF_RANGE", "ارتفاع المسار بين 24 و240");
  const next = { ...t, ...Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined)) };
  let out = touch(p, { tracks: p.tracks.map((x) => (x.id === trackId ? next : x)) });
  if (flags.magnetic === true && t.kind === "video") out = touch(out, { clips: rippleTrack(out.clips, trackId) });
  return out;
}

export function setAudioClipProps(
  p: ProjectState,
  id: string,
  patch: Partial<Pick<AudioClip, "volume" | "start" | "duration" | "inPoint" | "fadeIn" | "fadeOut" | "trackId" | "ref">>
): ProjectState {
  const a = p.audioClips.find((x) => x.id === id);
  if (!a) throw new EngineError("NOT_FOUND", `المقطع الصوتي غير موجود: ${id}`);
  const merged = { ...a, ...patch };
  if (patch.trackId) {
    const t = findTrack(p, patch.trackId);
    if (t.kind !== "audio") throw new EngineError("INVALID_INPUT", `المسار «${t.label}» ليس مسار صوت`);
  }
  const r = audioClipSchema.safeParse(merged);
  if (!r.success) throw new EngineError("OUT_OF_RANGE", r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("؛ "));
  if (merged.duration <= 0) throw new EngineError("OUT_OF_RANGE", "مدة المقطع الصوتي يجب أن تكون موجبة");
  return touch(p, { audioClips: p.audioClips.map((x) => (x.id === id ? { ...merged, start: round(snapToFrame(merged.start, p.fps || 30)) } : x)) });
}

export function splitAudioClip(p: ProjectState, id: string, atTime: number): { project: ProjectState; newClipId: string } {
  const a = p.audioClips.find((x) => x.id === id);
  if (!a) throw new EngineError("NOT_FOUND", `المقطع الصوتي غير موجود: ${id}`);
  const rel = atTime - a.start;
  if (!(rel > MIN_CLIP_SECONDS && rel < a.duration - MIN_CLIP_SECONDS)) throw new EngineError("OUT_OF_RANGE", `زمن التقسيم خارج المقطع الصوتي [${a.start}, ${round(a.start + a.duration)}]`);
  const first: AudioClip = { ...a, duration: round(rel), fadeOut: undefined };
  const second: AudioClip = { ...a, id: newId("aclip"), start: round(atTime), inPoint: round((a.inPoint ?? 0) + rel), duration: round(a.duration - rel), fadeIn: undefined };
  const audioClips = p.audioClips.flatMap((x) => (x.id === a.id ? [first, second] : [x]));
  return { project: touch(p, { audioClips }), newClipId: second.id };
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  to?: string;
}

/** نقاط الالتصاق: الصفر، رأس التشغيل، حدود كل المقاطع/الترجمات/النصوص. */
export function snapPoints(p: ProjectState, extra: { playhead?: number } = {}): { time: number; label: string }[] {
  const pts: { time: number; label: string }[] = [{ time: 0, label: "البداية" }];
  if (extra.playhead !== undefined) pts.push({ time: extra.playhead, label: "رأس التشغيل" });
  for (const c of exportClips(p)) {
    pts.push({ time: c.start, label: `بداية ${c.id}` }, { time: round(c.start + clipDuration(c)), label: `نهاية ${c.id}` });
  }
  for (const a of p.audioClips) pts.push({ time: a.start, label: `بداية ${a.name || a.id}` }, { time: round(a.start + a.duration), label: `نهاية ${a.name || a.id}` });
  for (const s of p.subtitles) pts.push({ time: s.start, label: "ترجمة" }, { time: s.end, label: "ترجمة" });
  for (const t of p.textOverlays) pts.push({ time: t.start, label: "نص" }, { time: t.end, label: "نص" });
  return pts;
}

/** يلصق زمناً بأقرب نقطة ضمن العتبة (بالثواني)، وإلا يقرّبه لشبكة الإطارات. */
export function snapTime(p: ProjectState, t: number, opts: { threshold?: number; playhead?: number; exclude?: Set<number> } = {}): SnapResult {
  const threshold = opts.threshold ?? 0.15;
  let best: { time: number; label: string } | null = null;
  for (const pt of snapPoints(p, { playhead: opts.playhead })) {
    if (Math.abs(pt.time - t) <= threshold && (!best || Math.abs(pt.time - t) < Math.abs(best.time - t))) best = pt;
  }
  if (best) return { time: round(best.time), snapped: true, to: best.label };
  return { time: round(snapToFrame(Math.max(0, t), p.fps || 30)), snapped: false };
}
