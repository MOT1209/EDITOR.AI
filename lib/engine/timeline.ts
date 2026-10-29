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
import { COLOR_FILTER_IDS, EFFECT_IDS, LIMITS } from "./project-schema";

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
  return round(clips.reduce((s, c) => s + clipDuration(c), 0));
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
  return { project: touch(p, { clips: rippleTrack(clips, c.trackId) }), newClipId: second.id };
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
  return touch(p, { clips: rippleTrack(clips, c.trackId) });
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
  return touch(p, { clips: rippleTrack(clips, c.trackId) });
}

export function deleteClip(p: ProjectState, clipId: string): ProjectState {
  const c = findClip(p, clipId);
  const track = p.tracks.find((t) => t.id === c.trackId);
  if (track?.locked) throw new EngineError("CONFLICT", `المسار «${track.label}» مقفل`);
  const clips = p.clips.filter((x) => x.id !== clipId);
  return touch(p, { clips: rippleTrack(clips, c.trackId) });
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
