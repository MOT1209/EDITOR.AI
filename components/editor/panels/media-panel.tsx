"use client";

import { SectionTitle, EmptyState } from "../ui";
import { MediaLibrary } from "../media-library";
import { Type, X } from "lucide-react";
import type { AppNotification, ProjectState } from "@/lib/types";
import type { State, Action } from "../state";
import { ImageLibraryPanel } from "./image-library-panel";

export function MediaPanel({ state, dispatch, notify, prepare }: { state: State; dispatch: React.Dispatch<Action>; prepare: (p: ProjectState) => ProjectState; notify: (type: AppNotification["type"], title: string, message?: string) => void }) {
  return (
    <div className="space-y-3">
      <MediaLibrary state={state} dispatch={dispatch} notify={notify} prepare={prepare} />

      <SectionTitle icon={Type} title="الترجمات" />
      {state.project.subtitles.length === 0 ? (
        <EmptyState text="لا توجد ترجمات بعد." />
      ) : (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {state.project.subtitles.map((s) => (
            <div
              key={s.id}
              className={`p-2 rounded-md text-[11px] border ${
                state.selectedSubtitleId === s.id
                  ? "bg-brand/10 border-brand/30"
                  : "bg-bg-soft border-line/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-ink-mute">
                  {s.start.toFixed(1)}s - {s.end.toFixed(1)}s
                </span>
                <button
                  onClick={() => dispatch({ type: "REMOVE_SUBTITLE", id: s.id })}
                  className="text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <textarea
                value={s.text}
                onChange={(e) =>
                  dispatch({ type: "UPDATE_SUBTITLE", id: s.id, patch: { text: e.target.value } })
                }
                className="w-full bg-transparent border-none outline-none resize-none"
                rows={2}
              />
            </div>
          ))}
        </div>
      )}

      <SectionTitle icon={Type} title="العناوين والنصوص الحرة" />
      {state.project.textOverlays.length === 0 ? (
        <EmptyState text="لا توجد عناوين بعد." />
      ) : (
        <div className="space-y-1.5">
          {state.project.textOverlays.map((t) => (
            <div key={t.id} className="p-2 rounded-md text-[11px] border bg-bg-soft border-line/50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-ink-mute">
                  {t.start.toFixed(1)}s - {t.end.toFixed(1)}s • {t.position === "top" ? "أعلى" : t.position === "center" ? "وسط" : "أسفل"}
                </span>
                <button
                  onClick={() => dispatch({ type: "REMOVE_TEXT_OVERLAY", id: t.id })}
                  className="text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="truncate">{t.text}</div>
            </div>
          ))}
        </div>
      )}

      <ImageLibraryPanel state={state} dispatch={dispatch} />
    </div>
  );
}
