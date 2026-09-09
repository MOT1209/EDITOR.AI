"use client";

import { useMemo, useState } from "react";
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
  SquareSplitHorizontal,
} from "lucide-react";
import type { State, Action } from "./state";
import type { TimelineTrack } from "@/lib/types";


export function Timeline({
  state,
  dispatch,
  videoRef,
  formatTime,
  onSelectClip,
  onSelectSub,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  videoRef: React.RefObject<HTMLVideoElement>;
  formatTime: (s: number, ms?: boolean) => string;
  onSelectClip: (id: string | null) => void;
  onSelectSub: (id: string | null) => void;
}) {
  const total = state.videoMeta?.duration || 30;
  const zoomWidth = state.zoom;

  const onTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * total;
    if (videoRef.current) videoRef.current.currentTime = t;
    dispatch({ type: "SET_PLAYHEAD", t });
  };

  const trackColors: Record<string, { bg: string; border: string; text: string; headBg: string }> = {
    video: {
      bg: "from-blue-600/30 to-blue-700/20",
      border: "border-blue-500/50",
      text: "text-blue-200",
      headBg: "bg-blue-600/20",
    },
    subtitle: {
      bg: "from-cyan-600/25 to-cyan-700/15",
      border: "border-cyan-500/40",
      text: "text-cyan-200",
      headBg: "bg-cyan-600/20",
    },
    audio: {
      bg: "from-emerald-600/25 to-emerald-700/15",
      border: "border-emerald-500/40",
      text: "text-emerald-200",
      headBg: "bg-emerald-600/20",
    },
  };

  const renderTrackContent = (track: TimelineTrack) => {
    const colors = trackColors[track.kind] || trackColors.video;

    if (track.kind === "video") {
      return (
        <div className="relative h-full">
          {state.project.clips.map((c) => {
            const left = (c.start / total) * 100;
            const width = (c.duration / total) * 100;
            const selected = state.selectedClipId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => onSelectClip(c.id)}
                className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-pointer transition-all duration-100 border-l-2 ${
                  selected
                    ? "border-white ring-1 ring-white/30 z-10"
                    : "border-blue-400/60 hover:brightness-110"
                }`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: selected
                    ? "linear-gradient(180deg, rgba(99,102,241,0.45), rgba(99,102,241,0.25))"
                    : "linear-gradient(180deg, rgba(59,130,246,0.35), rgba(37,99,235,0.15))",
                }}
              >
                <div className="flex items-center gap-1 px-1.5 h-full">
                  <FileVideo className="h-3 w-3 text-blue-200 shrink-0" />
                  <span className="text-[9px] truncate text-blue-100 leading-none">
                    مقطع {c.id.slice(0, 4)}
                  </span>
                  {c.effects.length > 0 && (
                    <span className="text-[7px] px-1 rounded bg-black/30 text-blue-300 leading-none">
                      {c.effects.length} FX
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (track.kind === "subtitle") {
      return (
        <div className="relative h-full">
          {state.project.subtitles.map((s) => {
            const left = (s.start / total) * 100;
            const width = ((s.end - s.start) / total) * 100;
            const selected = state.selectedSubtitleId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSub(s.id)}
                className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-pointer transition-all ${
                  selected ? "ring-1 ring-white/40 z-10" : ""
                }`}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.3)}%`,
                  background: selected
                    ? "linear-gradient(180deg, rgba(34,211,238,0.4), rgba(34,211,238,0.2))"
                    : "linear-gradient(180deg, rgba(34,211,238,0.2), rgba(34,211,238,0.08))",
                  borderLeft: "2px solid rgba(34,211,238,0.5)",
                }}
              >
                <div className="text-[8px] px-1 truncate text-cyan-100 leading-none h-full flex items-center">
                  {s.text}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (track.kind === "audio") {
      return (
        <div className="relative h-full">
          {state.project.musicId && (
            <div
              className="absolute top-0.5 bottom-0.5 left-0 rounded-sm"
              style={{
                right: "0",
                background:
                  "repeating-linear-gradient(90deg, rgba(52,211,153,0.15) 0px, rgba(52,211,153,0.15) 4px, transparent 4px, transparent 8px)",
              }}
            />
          )}
          {state.project.audioClips.map((a) => {
            const left = (a.start / total) * 100;
            const width = (a.duration / total) * 100;
            return (
              <div
                key={a.id}
                className="absolute top-0.5 bottom-0.5 rounded-sm"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background:
                    "linear-gradient(180deg, rgba(251,191,36,0.3), rgba(251,191,36,0.12))",
                  borderLeft: "2px solid rgba(251,191,36,0.5)",
                }}
              >
                <div className="text-[8px] px-1 truncate text-amber-200 leading-none h-full flex items-center">
                  {a.name}
                </div>
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
    const step = total > 120 ? 10 : total > 60 ? 5 : 1;
    for (let t = 0; t <= total; t += step) {
      marks.push({ t, major: t % (step * 5) === 0 || t === 0 || t === Math.ceil(total) });
    }
    return marks;
  }, [total]);

  return (
    <div className="border-t border-[#1e1e2e] bg-[#0c0c14]">
      <div className="flex items-center h-8 px-3 border-b border-[#1e1e2e] bg-[#0a0a12]">
        <span className="text-[10px] text-zinc-500 font-semibold tracking-wider uppercase">Timeline</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", z: Math.max(30, state.zoom - 15) })}
            className="text-zinc-500 hover:text-zinc-300 p-0.5"
            title="تصغير"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <span className="text-[9px] text-zinc-600 w-8 text-center font-mono">{zoomWidth}%</span>
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", z: Math.min(200, state.zoom + 15) })}
            className="text-zinc-500 hover:text-zinc-300 p-0.5"
            title="تكبير"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <div className="w-px h-4 bg-[#1e1e2e] mx-1" />
          <button className="text-zinc-500 hover:text-zinc-300 p-0.5" title="قص">
            <Scissors className="h-3 w-3" />
          </button>
          <button className="text-zinc-500 hover:text-zinc-300 p-0.5" title="تقسيم">
            <SquareSplitHorizontal className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex" style={{ minHeight: 180 }}>
        <div className="w-[140px] border-l border-[#1e1e2e] bg-[#0a0a12] shrink-0">
          {state.project.tracks.map((t) => {
            const tc = trackColors[t.kind] || trackColors.video;
            return (
              <div
                key={t.id}
                className="border-b border-[#1e1e2e] flex items-center px-2 gap-1.5 relative overflow-hidden"
                style={{ height: t.kind === "video" ? 60 : t.kind === "subtitle" ? 34 : 44 }}
              >
                <div className={`absolute inset-0 ${tc.headBg} opacity-30`} />
                <div className={`h-2 w-2 rounded-full shrink-0 ${tc.headBg} border ${tc.border}`} />
                {t.kind === "video" && <FileVideo className="h-3 w-3 text-blue-400 shrink-0 z-10" />}
                {t.kind === "subtitle" && <Type className="h-3 w-3 text-cyan-400 shrink-0 z-10" />}
                {t.kind === "audio" && <AudioLines className="h-3 w-3 text-emerald-400 shrink-0 z-10" />}
                <span className="text-[9px] text-zinc-400 truncate flex-1 z-10">{t.label}</span>
                <button
                  onClick={() =>
                    dispatch({ type: "UPDATE_TRACK", id: t.id, patch: { muted: !t.muted } })
                  }
                  className="text-zinc-600 hover:text-zinc-300 z-10"
                >
                  {t.muted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex-1 relative overflow-x-auto overflow-y-hidden">
          <div style={{ width: `${(total / 30) * zoomWidth}%`, minWidth: "100%" }}>
            <div
              className="h-6 bg-[#0e0e18] border-b border-[#1e1e2e] relative cursor-pointer select-none"
              onClick={onTimelineClick}
            >
              {rulerMarks.map((m) => (
                <div
                  key={m.t}
                  className="absolute top-0 bottom-0"
                  style={{ left: `${(m.t / total) * 100}%` }}
                >
                  <div
                    className={`border-r ${m.major ? "border-zinc-600" : "border-zinc-800"}`}
                    style={{ height: m.major ? "60%" : "35%" }}
                  />
                  {m.major && (
                    <span className="text-[8px] text-zinc-500 mr-1 font-mono leading-none">
                      {formatTime(m.t).replace(/^00:/, "")}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {state.project.tracks.map((t) => (
              <div
                key={t.id}
                className="border-b border-[#1e1e2e] relative"
                style={{ height: t.kind === "video" ? 60 : t.kind === "subtitle" ? 34 : 44 }}
              >
                {renderTrackContent(t)}
              </div>
            ))}
          </div>

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 to-blue-600 pointer-events-none z-20"
            style={{
              left: `${(state.playhead / total) * 100}%`,
              boxShadow: "0 0 6px rgba(59,130,246,0.6)",
            }}
          >
            <div className="w-2.5 h-3 bg-blue-500 -ml-[5px] -mt-0 clip-triangle" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Transport({
  state,
  dispatch,
  videoRef,
  audio,
  onPlayPause,
  onSkip,
  formatTime,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  videoRef: React.RefObject<HTMLVideoElement>;
  audio: { url: string; name: string } | null;
  onPlayPause: () => void;
  onSkip: (d: number) => void;
  formatTime: (s: number, ms?: boolean) => string;
}) {
  const total = state.videoMeta?.duration || 30;
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
            const t = (x / rect.width) * total;
            if (videoRef.current) videoRef.current.currentTime = t;
            dispatch({ type: "SET_PLAYHEAD", t });
          }}
        >
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-violet-500 rounded-full transition-all"
            style={{ width: `${(state.playhead / total) * 100}%` }}
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

      <div className="flex items-center gap-1 text-zinc-500">
        <Volume2 className="h-3 w-3" />
        <span className="text-[9px]">100</span>
      </div>

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
