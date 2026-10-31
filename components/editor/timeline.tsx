"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { needsCompositor } from "@/lib/engine/render-plan";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
  Music,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Type,
  FileVideo,
  AudioLines,
  Trash2,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Magnet,
  Plus,
  Copy,
  Merge,
  Maximize2,
  X,
} from "lucide-react";
import type { State, Action } from "./state";
import type { ProjectState, TimelineTrack } from "@/lib/types";
import {
  addTrack,
  clipDuration,
  duplicateClip,
  exportClips,
  mergeClips,
  moveClipToTrack,
  removeTrack,
  setAudioClipProps,
  setTrackFlags,
  snapTime,
  splitAudioClip,
  timelineDuration,
  trimClip,
} from "@/lib/engine/timeline";

/** طول التايملاين = مدة المخرَج كما سيصدّره المحرّك (لا مدة الفيديو المصدر). */
export function timelineTotal(state: State): number {
  if (exportClips(state.project).length > 0) {
    const audioEnd = Math.max(0, ...state.project.audioClips.map((a) => a.start + a.duration));
    return Math.max(0.1, timelineDuration(state.project), audioEnd);
  }
  return state.videoMeta?.duration || state.project.duration || 30;
}

const ZOOM_MIN = 10;
const ZOOM_MAX = 400;
const DEFAULT_HEIGHT: Record<string, number> = { video: 64, subtitle: 36, audio: 48, fx: 36 };

type Notify = (type: "info" | "success" | "warning" | "error", title: string, message?: string) => void;

interface DragState {
  kind: "move" | "trim-left" | "trim-right" | "audio-move" | "audio-trim";
  id: string;
  /** زمن بداية الجزء المسحوب كما سيُلتزم به. */
  start: number;
  duration: number;
  trackId: string;
  snappedTo?: string;
  moved: boolean;
}

interface MenuState {
  x: number;
  y: number;
  target: { type: "clip" | "audio"; id: string };
}

export function Timeline({
  state,
  dispatch,
  onSeek,
  onSplit,
  onDeleteClip,
  formatTime,
  onSelectClip,
  onSelectSub,
  notify,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  videoRef: React.RefObject<HTMLVideoElement>;
  /** تحريك المؤشر بزمن التايملاين (المحرّر يحوّله لزمن المصدر). */
  onSeek: (t: number) => void;
  onSplit: () => void;
  onDeleteClip: () => void;
  formatTime: (s: number, ms?: boolean) => string;
  onSelectClip: (id: string | null) => void;
  onSelectSub: (id: string | null) => void;
  notify: Notify;
}) {
  const total = timelineTotal(state);
  const zoomWidth = state.zoom;
  const project = state.project;
  const fps = project.fps || 30;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const trackHeight = (t: TimelineTrack) => heights[t.id] ?? DEFAULT_HEIGHT[t.kind] ?? 48;

  const commit = useCallback(
    (fn: (p: ProjectState) => ProjectState, errTitle: string) => {
      try {
        dispatch({ type: "COMMIT_PROJECT", project: fn(project) });
        return true;
      } catch (e) {
        notify("error", errTitle, e instanceof Error ? e.message : undefined);
        return false;
      }
    },
    [dispatch, project, notify]
  );

  /** يحوّل x (بكسل شاشة) إلى زمن تايملاين. */
  const timeAt = useCallback(
    (clientX: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return Math.max(0, Math.min(total, ((clientX - rect.left) / rect.width) * total));
    },
    [total]
  );

  const trackAtY = useCallback((clientY: number): string | null => {
    const rows = surfaceRef.current?.querySelectorAll<HTMLElement>("[data-track-id]");
    if (!rows) return null;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (clientY >= b.top && clientY <= b.bottom) return r.dataset.trackId ?? null;
    }
    return null;
  }, []);

  const snap = useCallback(
    (t: number, exclude?: { clipId?: string; audioId?: string }): { time: number; to?: string } => {
      if (!state.snapEnabled) return { time: Math.round(Math.max(0, t) * fps) / fps };
      const p: ProjectState = {
        ...project,
        clips: project.clips.filter((c) => c.id !== exclude?.clipId),
        audioClips: project.audioClips.filter((a) => a.id !== exclude?.audioId),
      };
      // العتبة ثابتة بالبكسل تقريباً (8px) ⇒ تتغيّر بالثواني مع التكبير.
      const w = surfaceRef.current?.getBoundingClientRect().width || 1000;
      const threshold = Math.max(1 / fps, (8 / w) * total);
      const r = snapTime(p, t, { threshold, playhead: state.playhead });
      return { time: r.time, to: r.snapped ? r.to : undefined };
    },
    [state.snapEnabled, state.playhead, project, fps, total]
  );

  // ---------------------------------------------------------------- سحب المقاطع/الحواف
  const beginDrag = (e: React.PointerEvent, init: Omit<DragState, "moved">, origin: { start: number; duration: number; inPoint?: number; outPoint?: number; speed?: number; trackId: string }) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const t0 = timeAt(e.clientX);
    setDrag({ ...init, moved: false });
    setMenu(null);

    const onMove = (ev: PointerEvent) => {
      const moved = Math.abs(ev.clientX - startX) > 3 || init.kind === "move";
      const dt = timeAt(ev.clientX) - t0;
      if (init.kind === "move" || init.kind === "audio-move") {
        const raw = Math.max(0, origin.start + dt);
        const a = snap(raw, { clipId: init.kind === "move" ? init.id : undefined, audioId: init.kind === "audio-move" ? init.id : undefined });
        // التقاط الحافة اليمنى أيضاً
        const b = snap(raw + origin.duration, { clipId: init.kind === "move" ? init.id : undefined, audioId: init.kind === "audio-move" ? init.id : undefined });
        let start = a.time;
        let to = a.to;
        if (!a.to && b.to) {
          start = Math.max(0, b.time - origin.duration);
          to = b.to;
        }
        const overTrack = init.kind === "move" ? trackAtY(ev.clientY) : null;
        const trk = overTrack && project.tracks.find((t) => t.id === overTrack)?.kind === "video" ? overTrack : origin.trackId;
        setDrag({ ...init, start, duration: origin.duration, trackId: trk, snappedTo: to, moved: moved && Math.abs(ev.clientX - startX) > 2 });
      } else if (init.kind === "trim-left") {
        const raw = Math.max(0, Math.min(origin.start + origin.duration - 0.05, origin.start + dt));
        const a = snap(raw, { clipId: init.id });
        const start = Math.min(a.time, origin.start + origin.duration - 0.05);
        setDrag({ ...init, start, duration: origin.start + origin.duration - start, trackId: origin.trackId, snappedTo: a.to, moved: true });
      } else {
        const raw = Math.max(origin.start + 0.05, origin.start + origin.duration + dt);
        const a = snap(raw, { clipId: init.kind === "trim-right" ? init.id : undefined, audioId: init.kind === "audio-trim" ? init.id : undefined });
        const end = Math.max(origin.start + 0.05, a.time);
        setDrag({ ...init, start: origin.start, duration: end - origin.start, trackId: origin.trackId, snappedTo: a.to, moved: true });
      }
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onCancel);
      const d = dragRef.current;
      setDrag(null);
      if (d && d.moved) finishDrag(d, origin);
    };
    const onCancel = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onCancel);
      setDrag(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onCancel);
  };

  const finishDrag = (d: DragState, origin: { start: number; duration: number; inPoint?: number; outPoint?: number; speed?: number; trackId: string }) => {
    if (d.kind === "move") {
      const selected = state.selectedClipIds.includes(d.id) && state.selectedClipIds.length > 1 ? state.selectedClipIds : [d.id];
      const dtAll = d.start - origin.start;
      const freeAll = selected.every((id) => {
        const c = project.clips.find((x) => x.id === id);
        return c && project.tracks.find((t) => t.id === c.trackId)?.magnetic === false;
      });
      if (selected.length > 1 && freeAll && d.trackId === origin.trackId) {
        // حركة جماعية على مسارات حرّة: الأبعد أولاً لتفادي تداخل مؤقت.
        commit((p) => {
          let q = p;
          const ordered = [...selected].sort((a, b) => {
            const ca = p.clips.find((c) => c.id === a)!;
            const cb = p.clips.find((c) => c.id === b)!;
            return dtAll > 0 ? cb.start - ca.start : ca.start - cb.start;
          });
          for (const id of ordered) {
            const c = q.clips.find((x) => x.id === id)!;
            q = moveClipToTrack(q, id, c.trackId, Math.max(0, c.start + dtAll));
          }
          return q;
        }, "تعذّر نقل المقاطع");
      } else {
        commit((p) => moveClipToTrack(p, d.id, d.trackId, d.start), "تعذّر نقل المقطع");
      }
    } else if (d.kind === "trim-left" || d.kind === "trim-right") {
      commit((p) => {
        const c = p.clips.find((x) => x.id === d.id)!;
        const speed = c.speed || 1;
        const srcEnd = c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration * speed;
        if (d.kind === "trim-left") {
          const delta = d.start - c.start; // ثواني تايملاين مقصوصة من البداية
          let q = trimClip(p, d.id, { inPoint: Math.max(0, c.inPoint + delta * speed) });
          if (p.tracks.find((t) => t.id === c.trackId)?.magnetic === false) q = moveClipToTrack(q, d.id, c.trackId, d.start);
          return q;
        }
        const newOut = c.inPoint + d.duration * speed;
        return trimClip(p, d.id, { outPoint: Math.min(newOut, Math.max(srcEnd, newOut)) });
      }, "تعذّر القص");
    } else if (d.kind === "audio-move") {
      commit((p) => setAudioClipProps(p, d.id, { start: d.start }), "تعذّر نقل الصوت");
    } else if (d.kind === "audio-trim") {
      commit((p) => setAudioClipProps(p, d.id, { duration: Math.max(0.05, d.duration) }), "تعذّر قص الصوت");
    }
  };

  // ---------------------------------------------------------------- تحديد
  const clickClip = (e: React.MouseEvent | React.PointerEvent, id: string) => {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      const has = state.selectedClipIds.includes(id);
      dispatch({ type: "SELECT_CLIPS", ids: has ? state.selectedClipIds.filter((x) => x !== id) : [...state.selectedClipIds, id] });
    } else if (!state.selectedClipIds.includes(id) || state.selectedClipIds.length === 1) {
      onSelectClip(id);
    }
  };

  // ---------------------------------------------------------------- مؤشر التشغيل (سحب على المسطرة)
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    onSeek(snap(timeAt(e.clientX)).time);
    const move = (ev: PointerEvent) => onSeek(snap(timeAt(ev.clientX)).time);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // ---------------------------------------------------------------- تغيير ارتفاع المسار
  const beginResize = (e: React.PointerEvent, t: TimelineTrack) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const h0 = trackHeight(t);
    const move = (ev: PointerEvent) => setHeights((h) => ({ ...h, [t.id]: Math.min(240, Math.max(24, h0 + ev.clientY - y0)) }));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // إغلاق قائمة السياق بأي نقرة/Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const trackColors: Record<string, { headBg: string; border: string }> = {
    video: { headBg: "bg-blue-600/20", border: "border-blue-500/50" },
    subtitle: { headBg: "bg-cyan-600/20", border: "border-cyan-500/40" },
    audio: { headBg: "bg-emerald-600/20", border: "border-emerald-500/40" },
    fx: { headBg: "bg-violet-600/20", border: "border-violet-500/40" },
  };

  const renderTrackContent = (track: TimelineTrack) => {
    if (track.kind === "video" || track.kind === "fx") {
      const isMarker = track.kind === "fx";
      const clips = project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
      return (
        <div className={`relative h-full ${track.hidden ? "opacity-40" : ""}`}>
          {clips.map((c, clipIndex) => {
            const dragging = drag && drag.id === c.id && (drag.kind === "move" || drag.kind === "trim-left" || drag.kind === "trim-right") ? drag : null;
            const start = dragging ? dragging.start : c.start;
            const dur = dragging ? dragging.duration : c.duration;
            const left = (start / total) * 100;
            const width = (dur / total) * 100;
            const selected = state.selectedClipIds.includes(c.id) || state.selectedClipId === c.id;
            const editable = !isMarker && !track.locked && c.kind !== "image";
            return (
              <div
                key={c.id}
                data-clip-id={c.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`مقطع ${clipIndex + 1}، ${c.duration.toFixed(1)} ثانية`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isMarker) clickClip(e, c.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!isMarker) onSelectClip(c.id);
                  }
                }}
                onContextMenu={(e) => {
                  if (isMarker) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (!state.selectedClipIds.includes(c.id)) onSelectClip(c.id);
                  setMenu({ x: e.clientX, y: e.clientY, target: { type: "clip", id: c.id } });
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || isMarker || track.locked || e.shiftKey || e.ctrlKey || e.metaKey) return;
                  if (!state.selectedClipIds.includes(c.id)) onSelectClip(c.id);
                  beginDrag(e, { kind: "move", id: c.id, start: c.start, duration: c.duration, trackId: c.trackId }, { start: c.start, duration: c.duration, trackId: c.trackId });
                }}
                title={isMarker ? "علامة تحليل — لا تدخل التصدير" : `مقطع: مصدر ${c.inPoint.toFixed(2)}→${(c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration).toFixed(2)}s — اسحب للنقل، الحواف للقص، كليك يمين للقائمة`}
                className={`absolute top-0.5 bottom-0.5 rounded-sm select-none border-l-2 touch-none ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                  selected ? "border-white ring-1 ring-white/40 z-10" : "border-blue-400/60 hover:brightness-110"
                } ${dragging ? "opacity-80 z-20" : ""}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: isMarker
                    ? "linear-gradient(180deg, rgba(168,85,247,0.25), rgba(168,85,247,0.1))"
                    : c.kind === "image"
                    ? "linear-gradient(180deg, rgba(236,72,153,0.35), rgba(190,24,93,0.15))"
                    : selected
                    ? "linear-gradient(180deg, rgba(99,102,241,0.45), rgba(99,102,241,0.25))"
                    : "linear-gradient(180deg, rgba(59,130,246,0.35), rgba(37,99,235,0.15))",
                }}
              >
                {editable && (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10"
                      aria-label="قص من البداية"
                      onPointerDown={(e) => beginDrag(e, { kind: "trim-left", id: c.id, start: c.start, duration: c.duration, trackId: c.trackId }, { start: c.start, duration: c.duration, trackId: c.trackId })}
                    />
                    <div
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10"
                      aria-label="قص من النهاية"
                      onPointerDown={(e) => beginDrag(e, { kind: "trim-right", id: c.id, start: c.start, duration: c.duration, trackId: c.trackId }, { start: c.start, duration: c.duration, trackId: c.trackId })}
                    />
                  </>
                )}
                <div className="flex items-center gap-1 px-1.5 h-full pointer-events-none">
                  <FileVideo className="h-3 w-3 text-blue-200 shrink-0" />
                  <span className="text-[9px] truncate text-blue-100 leading-none">
                    {isMarker ? `${c.inPoint.toFixed(1)}s` : c.kind === "image" ? "صورة" : `مقطع ${clipIndex + 1}`}
                  </span>
                  {c.effects.length > 0 && <span className="text-[7px] px-1 rounded bg-black/30 text-blue-300 leading-none">{c.effects.length} FX</span>}
                  {c.transitionIn && <span className="text-[7px] px-1 rounded bg-black/30 text-amber-300 leading-none">⇄</span>}
                </div>
              </div>
            );
          })}
          {/* مقطع يُسحب إلى هذا المسار من مسار آخر */}
          {drag && drag.kind === "move" && drag.trackId === track.id && !clips.some((c) => c.id === drag.id) && (
            <div className="absolute top-0.5 bottom-0.5 rounded-sm ring-1 ring-white/60 bg-indigo-500/40 z-20 pointer-events-none" style={{ left: `${(drag.start / total) * 100}%`, width: `${(drag.duration / total) * 100}%` }} />
          )}
        </div>
      );
    }

    if (track.kind === "subtitle") {
      return (
        <div className="relative h-full">
          {project.subtitles.map((s) => {
            const left = (s.start / total) * 100;
            const width = ((s.end - s.start) / total) * 100;
            const selected = state.selectedSubtitleId === s.id;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSub(s.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectSub(s.id)}
                className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-pointer transition-all ${selected ? "ring-1 ring-white/40 z-10" : ""}`}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.3)}%`,
                  background: selected ? "linear-gradient(180deg, rgba(34,211,238,0.4), rgba(34,211,238,0.2))" : "linear-gradient(180deg, rgba(34,211,238,0.2), rgba(34,211,238,0.08))",
                  borderLeft: "2px solid rgba(34,211,238,0.5)",
                }}
              >
                <div className="text-[8px] px-1 truncate text-cyan-100 leading-none h-full flex items-center">{s.text}</div>
              </div>
            );
          })}
        </div>
      );
    }

    if (track.kind === "audio") {
      const clips = project.audioClips.filter((a) => a.trackId === track.id || (!project.tracks.some((t) => t.id === a.trackId) && track.id === project.tracks.find((t) => t.kind === "audio")?.id));
      return (
        <div className={`relative h-full ${track.muted ? "opacity-40" : ""}`}>
          {project.musicId && clips.length === 0 && track.id === project.tracks.find((t) => t.kind === "audio")?.id && (
            <div className="absolute top-0.5 bottom-0.5 left-0 right-0 rounded-sm" style={{ background: "repeating-linear-gradient(90deg, rgba(52,211,153,0.15) 0px, rgba(52,211,153,0.15) 4px, transparent 4px, transparent 8px)" }} title="موسيقى المعاينة — لا تدخل التصدير ما لم تُرفع كمقطع صوتي" />
          )}
          {clips.map((a) => {
            const dragging = drag && drag.id === a.id && (drag.kind === "audio-move" || drag.kind === "audio-trim") ? drag : null;
            const start = dragging ? dragging.start : a.start;
            const dur = dragging ? dragging.duration : a.duration;
            const selected = state.selectedAudioId === a.id;
            return (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`صوت ${a.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "SELECT_AUDIO", id: a.id });
                }}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && dispatch({ type: "SELECT_AUDIO", id: a.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dispatch({ type: "SELECT_AUDIO", id: a.id });
                  setMenu({ x: e.clientX, y: e.clientY, target: { type: "audio", id: a.id } });
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || track.locked) return;
                  dispatch({ type: "SELECT_AUDIO", id: a.id });
                  beginDrag(e, { kind: "audio-move", id: a.id, start: a.start, duration: a.duration, trackId: track.id }, { start: a.start, duration: a.duration, trackId: track.id });
                }}
                title={`${a.name} — ${a.ref ? "على الخادم (يدخل التصدير)" : "ملف متصفح فقط: لن يدخل التصدير حتى يُرفع"}`}
                className={`absolute top-0.5 bottom-0.5 rounded-sm touch-none select-none cursor-grab ${selected ? "ring-1 ring-white/50 z-10" : ""}`}
                style={{
                  left: `${(start / total) * 100}%`,
                  width: `${(dur / total) * 100}%`,
                  background: a.ref ? "linear-gradient(180deg, rgba(52,211,153,0.35), rgba(52,211,153,0.12))" : "linear-gradient(180deg, rgba(251,191,36,0.3), rgba(251,191,36,0.12))",
                  borderLeft: `2px solid ${a.ref ? "rgba(52,211,153,0.6)" : "rgba(251,191,36,0.5)"}`,
                }}
              >
                <div
                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/40 z-10"
                  aria-label="قص الصوت من النهاية"
                  onPointerDown={(e) => {
                    dispatch({ type: "SELECT_AUDIO", id: a.id });
                    beginDrag(e, { kind: "audio-trim", id: a.id, start: a.start, duration: a.duration, trackId: track.id }, { start: a.start, duration: a.duration, trackId: track.id });
                  }}
                />
                <div className="text-[8px] px-1 truncate text-amber-100 leading-none h-full flex items-center pointer-events-none">{a.name}{!a.ref && " ⚠"}</div>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const rulerMarks = useMemo(() => {
    const marks: { t: number; major: boolean }[] = [];
    const step = total > 600 ? 60 : total > 240 ? 30 : total > 120 ? 10 : total > 60 ? 5 : 1;
    for (let t = 0; t <= total; t += step) {
      marks.push({ t, major: t % (step * 5) === 0 || t === 0 || t === Math.ceil(total) });
    }
    return marks;
  }, [total]);

  const selectedCount = state.selectedClipIds.length;
  const menuClip = menu?.target.type === "clip" ? project.clips.find((c) => c.id === menu.target.id) : null;
  const menuAudio = menu?.target.type === "audio" ? project.audioClips.find((a) => a.id === menu.target.id) : null;
  const nextClip = menuClip
    ? project.clips.filter((c) => c.trackId === menuClip.trackId && c.kind !== "image").sort((a, b) => a.start - b.start).find((c) => c.start >= menuClip.start + clipDuration(menuClip) - 0.05 && c.id !== menuClip.id)
    : undefined;

  const IconBtn = ({ onClick, title, disabled, active, children }: { onClick: () => void; title: string; disabled?: boolean; active?: boolean; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`p-1 rounded ${active ? "bg-brand/20 text-brand-glow" : "text-zinc-500 hover:text-zinc-300"} disabled:opacity-30 disabled:hover:text-zinc-500`}
    >
      {children}
    </button>
  );

  return (
    <div className="border-t border-[#1e1e2e] bg-[#0c0c14]">
      <div className="flex items-center h-8 px-3 border-b border-[#1e1e2e] bg-[#0a0a12]">
        <span className="text-[10px] text-zinc-500 font-semibold tracking-wider uppercase">Timeline</span>
        {selectedCount > 1 && <span className="ml-2 text-[10px] text-brand-glow">{selectedCount} محدّدة</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <IconBtn onClick={() => dispatch({ type: "SET_ZOOM", z: Math.max(ZOOM_MIN, Math.round(state.zoom / 1.25)) })} title="تصغير (-)">
            <ZoomOut className="h-3 w-3" />
          </IconBtn>
          <span className="text-[9px] text-zinc-600 w-9 text-center font-mono">{zoomWidth}%</span>
          <IconBtn onClick={() => dispatch({ type: "SET_ZOOM", z: Math.min(ZOOM_MAX, Math.round(state.zoom * 1.25)) })} title="تكبير (+)">
            <ZoomIn className="h-3 w-3" />
          </IconBtn>
          <IconBtn onClick={() => dispatch({ type: "SET_ZOOM", z: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(3000 / total))) })} title="ملاءمة التايملاين للعرض">
            <Maximize2 className="h-3 w-3" />
          </IconBtn>
          <div className="w-px h-4 bg-[#1e1e2e] mx-1" />
          <IconBtn onClick={() => dispatch({ type: "TOGGLE_SNAP" })} active={state.snapEnabled} title={`الالتصاق ${state.snapEnabled ? "مفعّل" : "معطّل"} (N)`}>
            <Magnet className="h-3 w-3" />
          </IconBtn>
          <div className="w-px h-4 bg-[#1e1e2e] mx-1" />
          <IconBtn onClick={onSplit} title="تقسيم عند المؤشر (S)">
            <Scissors className="h-3 w-3" />
          </IconBtn>
          <IconBtn onClick={onDeleteClip} disabled={selectedCount === 0 && !state.selectedAudioId} title="حذف المحدّد (Delete)">
            <Trash2 className="h-3 w-3" />
          </IconBtn>
          <div className="w-px h-4 bg-[#1e1e2e] mx-1" />
          <IconBtn onClick={() => commit((p) => addTrack(p, "video", { magnetic: false }).project, "تعذّرت إضافة المسار")} title="إضافة مسار فيديو (طبقة)">
            <span className="flex items-center text-[9px] gap-0.5"><Plus className="h-3 w-3" />فيديو</span>
          </IconBtn>
          <IconBtn onClick={() => commit((p) => addTrack(p, "audio").project, "تعذّرت إضافة المسار")} title="إضافة مسار صوت">
            <span className="flex items-center text-[9px] gap-0.5"><Plus className="h-3 w-3" />صوت</span>
          </IconBtn>
          <div className="w-px h-4 bg-[#1e1e2e] mx-1" />
          <IconBtn onClick={() => dispatch({ type: "UNDO" })} disabled={state.past.length === 0} title="تراجع (Ctrl+Z)">
            <Undo2 className="h-3 w-3" />
          </IconBtn>
          <IconBtn onClick={() => dispatch({ type: "REDO" })} disabled={state.future.length === 0} title="إعادة (Ctrl+Shift+Z)">
            <Redo2 className="h-3 w-3" />
          </IconBtn>
        </div>
      </div>

      <div className="flex overflow-y-auto" style={{ minHeight: 180, maxHeight: 360 }}>
        <div className="w-[150px] border-l border-[#1e1e2e] bg-[#0a0a12] shrink-0">
          <div className="h-6 border-b border-[#1e1e2e]" />
          {project.tracks.map((t) => {
            const tc = trackColors[t.kind] || trackColors.video;
            const used = project.clips.some((c) => c.trackId === t.id) || project.audioClips.some((a) => a.trackId === t.id);
            return (
              <div key={t.id} className="border-b border-[#1e1e2e] flex items-center px-1.5 gap-1 relative" style={{ height: trackHeight(t) }}>
                <div className={`absolute inset-0 ${tc.headBg} opacity-30 pointer-events-none`} />
                {t.kind === "video" && <FileVideo className="h-3 w-3 text-blue-400 shrink-0 z-10" />}
                {t.kind === "subtitle" && <Type className="h-3 w-3 text-cyan-400 shrink-0 z-10" />}
                {t.kind === "audio" && <AudioLines className="h-3 w-3 text-emerald-400 shrink-0 z-10" />}
                <span className="text-[9px] text-zinc-400 truncate flex-1 z-10" title={t.kind === "video" ? (t.magnetic === false ? "طبقة حرّة" : "مسار مغناطيسي") : undefined}>
                  {t.label}
                  {t.kind === "video" && t.magnetic === false && <span className="text-zinc-600"> ·حر</span>}
                </span>
                {(t.kind === "audio" || t.kind === "video") && (
                  <button
                    onClick={() => commit((p) => setTrackFlags(p, t.id, { muted: !t.muted }), "تعذّر")}
                    className="text-zinc-500 hover:text-zinc-200 z-10"
                    title={t.muted ? "إلغاء الكتم" : "كتم صوت المسار"}
                    aria-label={t.muted ? "إلغاء كتم المسار" : "كتم المسار"}
                    aria-pressed={t.muted}
                  >
                    {t.muted ? <VolumeX className="h-3 w-3 text-rose-400" /> : <Volume2 className="h-3 w-3" />}
                  </button>
                )}
                {t.kind === "video" && (
                  <button
                    onClick={() => commit((p) => setTrackFlags(p, t.id, { hidden: !t.hidden }), "تعذّر")}
                    className="text-zinc-500 hover:text-zinc-200 z-10"
                    title={t.hidden ? "إظهار المسار" : "إخفاء المسار من الرندر"}
                    aria-label={t.hidden ? "إظهار المسار" : "إخفاء المسار"}
                    aria-pressed={t.hidden}
                  >
                    {t.hidden ? <EyeOff className="h-3 w-3 text-amber-400" /> : <Eye className="h-3 w-3" />}
                  </button>
                )}
                {(t.kind === "audio" || t.kind === "video") && (
                  <button
                    onClick={() => commit((p) => setTrackFlags(p, t.id, { locked: !t.locked }), "تعذّر")}
                    className="text-zinc-500 hover:text-zinc-200 z-10"
                    title={t.locked ? "فتح القفل" : "قفل المسار"}
                    aria-label={t.locked ? "فتح قفل المسار" : "قفل المسار"}
                    aria-pressed={t.locked}
                  >
                    {t.locked ? <Lock className="h-3 w-3 text-amber-400" /> : <Unlock className="h-3 w-3" />}
                  </button>
                )}
                {(t.kind === "audio" || t.kind === "video") && !used && project.tracks.filter((x) => x.kind === t.kind).length > 1 && (
                  <button onClick={() => commit((p) => removeTrack(p, t.id), "تعذّر حذف المسار")} className="text-zinc-600 hover:text-rose-400 z-10" title="حذف المسار الفارغ" aria-label="حذف المسار">
                    <X className="h-3 w-3" />
                  </button>
                )}
                <div className="absolute bottom-0 inset-x-0 h-1 cursor-row-resize hover:bg-brand/40 z-20" onPointerDown={(e) => beginResize(e, t)} title="اسحب لتغيير ارتفاع المسار" role="separator" aria-orientation="horizontal" />
              </div>
            );
          })}
        </div>

        <div className="flex-1 relative overflow-x-auto overflow-y-hidden" onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            dispatch({ type: "SET_ZOOM", z: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))) });
          }
        }}>
          <div ref={surfaceRef} className="relative" style={{ width: `${(total / 30) * zoomWidth}%`, minWidth: "100%" }} onClick={() => { onSelectClip(null); dispatch({ type: "SELECT_AUDIO", id: null }); }}>
            <div className="h-6 bg-[#0e0e18] border-b border-[#1e1e2e] relative cursor-col-resize select-none touch-none" onPointerDown={scrub} role="slider" aria-label="مؤشر التشغيل" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(state.playhead * 10) / 10}>
              {rulerMarks.map((m) => (
                <div key={m.t} className="absolute top-0 bottom-0" style={{ left: `${(m.t / total) * 100}%` }}>
                  <div className={`border-r ${m.major ? "border-zinc-600" : "border-zinc-800"}`} style={{ height: m.major ? "60%" : "35%" }} />
                  {m.major && <span className="text-[8px] text-zinc-500 ml-1 font-mono leading-none">{formatTime(m.t).replace(/^00:/, "")}</span>}
                </div>
              ))}
            </div>
            {project.tracks.map((t) => (
              <div key={t.id} data-track-id={t.id} className={`border-b border-[#1e1e2e] relative ${drag && drag.kind === "move" && drag.trackId === t.id ? "bg-brand/5" : ""} ${t.locked ? "bg-black/30" : ""}`} style={{ height: trackHeight(t) }}>
                {renderTrackContent(t)}
              </div>
            ))}
            {drag?.snappedTo && (
              <div className="absolute top-0 bottom-0 w-px bg-amber-400 z-30 pointer-events-none" style={{ left: `${((drag.kind === "trim-right" || drag.kind === "audio-trim" ? drag.start + drag.duration : drag.start) / total) * 100}%` }}>
                <span className="absolute top-6 left-1 text-[8px] bg-amber-400 text-black px-1 rounded whitespace-nowrap">{drag.snappedTo}</span>
              </div>
            )}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 to-blue-600 pointer-events-none z-20"
              style={{ left: `${(state.playhead / total) * 100}%`, boxShadow: "0 0 6px rgba(59,130,246,0.6)" }}
            >
              <div className="w-2.5 h-3 bg-blue-500 -ml-[5px] -mt-0 clip-triangle" />
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[170px] rounded-md border border-line bg-bg-panel shadow-xl py-1 text-[11px]"
          style={{ left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 190), top: Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 220) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {menuClip && (
            <>
              <MenuItem icon={Scissors} label="تقسيم عند المؤشر" hint="S" onClick={() => { setMenu(null); onSplit(); }} />
              <MenuItem
                icon={Merge}
                label="دمج مع التالي"
                disabled={!nextClip}
                onClick={() => { setMenu(null); commit((p) => mergeClips(p, menuClip.id, nextClip!.id), "تعذّر الدمج"); }}
              />
              <MenuItem
                icon={Copy}
                label="نسخ المقطع"
                hint="Ctrl+D"
                onClick={() => {
                  setMenu(null);
                  try {
                    const r = duplicateClip(project, menuClip.id);
                    dispatch({ type: "COMMIT_PROJECT", project: r.project });
                    dispatch({ type: "SELECT_CLIP", id: r.newClipId });
                  } catch (e) {
                    notify("error", "تعذّر النسخ", e instanceof Error ? e.message : undefined);
                  }
                }}
              />
              <MenuItem icon={Trash2} label={selectedCount > 1 ? `حذف ${selectedCount} مقاطع` : "حذف"} hint="Del" danger onClick={() => { setMenu(null); onDeleteClip(); }} />
            </>
          )}
          {menuAudio && (
            <>
              <MenuItem
                icon={Scissors}
                label="تقسيم الصوت عند المؤشر"
                disabled={!(state.playhead > menuAudio.start && state.playhead < menuAudio.start + menuAudio.duration)}
                onClick={() => { setMenu(null); const r = (() => { try { return splitAudioClip(project, menuAudio.id, state.playhead); } catch (e) { notify("error", "تعذّر التقسيم", e instanceof Error ? e.message : undefined); return null; } })(); if (r) dispatch({ type: "COMMIT_PROJECT", project: r.project }); }}
              />
              <MenuItem icon={Trash2} label="حذف المقطع الصوتي" danger onClick={() => { setMenu(null); dispatch({ type: "REMOVE_AUDIO", id: menuAudio.id }); dispatch({ type: "SELECT_AUDIO", id: null }); }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, hint, onClick, disabled, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-right hover:bg-bg-soft disabled:opacity-30 disabled:hover:bg-transparent ${danger ? "text-rose-300" : "text-ink-soft"}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[9px] text-ink-mute font-mono">{hint}</span>}
    </button>
  );
}

export function Transport({
  state,
  audio,
  onPlayPause,
  onSkip,
  onSeek,
  formatTime,
  onRenderedPreview,
  renderBusy,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  videoRef: React.RefObject<HTMLVideoElement>;
  /** يبدأ معاينة مرندرة (نفس خطة التصدير) من موضع المؤشر. */
  onRenderedPreview: () => void;
  renderBusy: boolean;
  audio: { url: string; name: string } | null;
  onPlayPause: () => void;
  onSkip: (d: number) => void;
  onSeek: (t: number) => void;
  formatTime: (s: number, ms?: boolean) => string;
}) {
  const total = timelineTotal(state);
  return (
    <div className="h-11 bg-[#0c0c14] border-t border-[#1e1e2e] flex items-center px-2 gap-1.5">
      <button onClick={() => onSkip(-5)} className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors" title="رجوع 5 ثوان">
        <SkipBack className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onPlayPause}
        className="h-7 w-7 rounded-md bg-blue-600 hover:bg-blue-500 grid place-items-center transition-colors"
        title={state.isPlaying ? "إيقاف" : "تشغيل"}
      >
        {state.isPlaying ? (
          <Pause className="h-3.5 w-3.5 text-white" />
        ) : (
          <Play className="h-3.5 w-3.5 text-white" />
        )}
      </button>
      <button onClick={() => onSkip(5)} className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors" title="تقديم 5 ثوان">
        <SkipForward className="h-3.5 w-3.5" />
      </button>

      <div className="w-px h-5 bg-[#1e1e2e] mx-1" />

      <div className="text-[11px] font-mono leading-none">
        <span className="text-blue-400">{formatTime(state.playhead, true)}</span>
        <span className="text-zinc-600 mx-0.5">/</span>
        <span className="text-zinc-500">{formatTime(total)}</span>
      </div>

      <div className="flex-1 mx-2">
        <div className="h-1.5 bg-[#1a1a28] rounded-full overflow-hidden cursor-pointer group relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            onSeek(Math.max(0, Math.min(total, (x / rect.width) * total)));
          }}
        >
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-violet-500 rounded-full transition-all"
            style={{ width: `${Math.min(100, (state.playhead / total) * 100)}%` }}
          />
          <div className="absolute top-1/2 -translate-y-1/2 right-0 h-3 w-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity -mr-1.5" />
        </div>
      </div>

      {audio && (
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Music className="h-3 w-3 text-emerald-500" />
          <span className="truncate max-w-[80px]">{audio.name}</span>
        </div>
      )}

      {needsCompositor(state.project) && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 whitespace-nowrap" title="المشغّل الحي يعرض الطبقة الأساسية من المصدر الأساسي فقط؛ التركيب الكامل (طبقات، انتقالات، ducking، تطبيع) يظهر في المعاينة المرندرة">
          معاينة حية تقريبية
        </span>
      )}
      <button
        onClick={onRenderedPreview}
        disabled={renderBusy}
        className="text-[10px] px-2 py-1 rounded-md border border-line text-ink-soft hover:text-ink hover:bg-bg-soft disabled:opacity-40 whitespace-nowrap"
        title="يرندر 10 ثوانٍ من موضع المؤشر بنفس خطة التصدير ويعرضها — المرجع الحاكم لما سيصدَّر"
      >
        معاينة مرندرة
      </button>

      <div className="w-px h-4 bg-[#1e1e2e] mx-0.5" />
      <div className="flex items-center gap-1 text-[9px] text-zinc-600 font-mono">
        <span>{state.project.aspect}</span>
        <span className="text-zinc-700">|</span>
        <span>{state.project.resolution}</span>
        <span className="text-zinc-700">|</span>
        <span>{state.project.fps}fps</span>
      </div>
    </div>
  );
}
