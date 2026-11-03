"use client";

import { useState } from "react";
import { Play, Pause, Loader2 } from "lucide-react";
import { MUSIC_LIBRARY, generateToneTrack } from "@/lib/mockAi";
import type { MusicTrack } from "@/lib/types";
import type { State, Action } from "../state";

export function MusicPanel({
  state,
  dispatch,
  onPlay,
  onStop,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onPlay: (m: MusicTrack) => void;
  onStop: () => void;
}) {
  const moods = Array.from(new Set(MUSIC_LIBRARY.map((m) => m.mood)));
  const [filter, setFilter] = useState<string | null>(null);
  const filtered = filter ? MUSIC_LIBRARY.filter((m) => m.mood === filter) : MUSIC_LIBRARY;

  const [playingId, setPlayingId] = useState<string | null>(null);

  const play = async (m: MusicTrack) => {
    if (!m.url) {
      // لا يوجد ملف — ولّد نغمة حقيقية عبر Web Audio API ثم شغّلها.
      setPlayingId(m.id);
      try {
        const url = await generateToneTrack(m);
        onPlay({ ...m, url: url || "" });
      } catch {
        onPlay(m);
      } finally {
        setPlayingId(null);
      }
      return;
    }
    onPlay(m);
  };
  const stop = () => {
    onStop();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setFilter(null)}
          className={`text-[10px] px-2 py-1 rounded-md border ${
            !filter ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"
          }`}
        >
          الكل
        </button>
        {moods.map((m) => (
          <button
            key={m}
            onClick={() => setFilter(m)}
            className={`text-[10px] px-2 py-1 rounded-md border ${
              filter === m ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {filtered.map((m) => {
          const active = state.project.musicId === m.id;
          return (
            <div
              key={m.id}
              className={`p-2 rounded-md border flex items-center gap-2 ${
                active ? "bg-brand/10 border-brand/40" : "bg-bg-soft border-line/50"
              }`}
            >
              <div
                className="h-10 w-10 rounded-md shrink-0"
                style={{ background: m.cover }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{m.title}</div>
                <div className="text-[10px] text-ink-mute">
                  {m.genre} • {m.bpm} BPM • {Math.round(m.duration / 60)} دقيقة
                </div>
              </div>
              <button
                onClick={() => (active ? stop() : play(m))}
                className={`h-7 w-7 rounded-full grid place-items-center ${
                  active ? "bg-brand text-white" : "bg-bg-elev text-ink-soft"
                }`}
                title={!m.url ? "توليد نغمة ثم التشغيل" : undefined}
              >
                {playingId === m.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : active ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
