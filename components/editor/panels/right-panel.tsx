"use client";

import { useState } from "react";
import { SectionTitle, EmptyState, InfoRow, StatBox } from "../ui";
import { Inspector } from "../inspector";
import { Scissors, Image as ImageIcon, Wand2, Type, AudioLines, Info, Bot, Activity } from "lucide-react";
import { formatTime, formatBytes } from "@/lib/project";
import type { AppNotification } from "@/lib/types";
import type { State, Action } from "../state";

export function RightPanel({
  state,
  dispatch,
  audio,
  setAudio,
  notify,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  notify: (type: AppNotification["type"], title: string, message?: string) => void;
  audio: { url: string; name: string } | null;
  setAudio: (a: { url: string; name: string } | null) => void;
}) {
  const [tab, setTab] = useState<"inspect" | "thumb" | "ai" | "info">("inspect");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-line p-2 grid grid-cols-4 gap-1" role="tablist" aria-label="لوحات الجانب">
        {[
          { id: "inspect", label: "الخصائص" },
          { id: "info", label: "المشروع" },
          { id: "thumb", label: "Thumbnail" },
          { id: "ai", label: "المساعد" },
        ].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`text-[10px] py-1.5 rounded-md ${
              tab === t.id
                ? "bg-brand/15 text-brand-glow"
                : "text-ink-soft hover:bg-bg-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "inspect" && <Inspector state={state} dispatch={dispatch} notify={notify} />}

        {tab === "info" && (
          <>
            <SectionTitle icon={Info} title="معلومات المشروع" />
            {state.videoMeta ? (
              <div className="space-y-1.5 text-[11px]">
                <InfoRow label="الاسم" value={state.videoMeta.name} />
                <InfoRow label="المدة" value={formatTime(state.videoMeta.duration)} />
                <InfoRow
                  label="الأبعاد"
                  value={`${state.videoMeta.width} × ${state.videoMeta.height}`}
                />
                <InfoRow label="الحجم" value={formatBytes(state.videoMeta.size)} />
                <InfoRow label="الصيغة" value={state.project.format.toUpperCase()} />
                <InfoRow label="الدقة" value={state.project.resolution} />
                <InfoRow label="FPS" value={String(state.project.fps)} />
              </div>
            ) : (
              <EmptyState text="ارفع فيديو لعرض المعلومات" />
            )}

            <SectionTitle icon={Type} title="العنوان والوصف" />
            <input
              type="text"
              value={state.project.title || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_TITLE_META",
                  title: e.target.value,
                  description: state.project.description || "",
                  tags: state.project.tags || [],
                })
              }
              placeholder="عنوان الفيديو"
              className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
            />
            <textarea
              value={state.project.description || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_TITLE_META",
                  title: state.project.title || "",
                  description: e.target.value,
                  tags: state.project.tags || [],
                })
              }
              rows={4}
              placeholder="وصف الفيديو..."
              className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs resize-none"
            />
            <div className="flex flex-wrap gap-1">
              {(state.project.tags || []).map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-bg-soft border border-line"
                >
                  #{t}
                </span>
              ))}
            </div>
          </>
        )}

        {tab === "thumb" && (
          <>
            <SectionTitle icon={ImageIcon} title="Thumbnail" />
            {state.project.thumbnail ? (
              <img
                src={state.project.thumbnail}
                alt="thumb"
                className="w-full rounded-lg border border-line"
              />
            ) : (
              <EmptyState text="لم يتم توليد Thumbnail بعد" />
            )}
            <button
              className="btn-primary w-full"
              onClick={() => {
                const ev = new CustomEvent("ai-trigger", { detail: "thumb" });
                window.dispatchEvent(ev);
              }}
            >
              <Wand2 className="h-4 w-4" />
              توليد / إعادة توليد
            </button>
          </>
        )}

        {tab === "ai" && (
          <>
            <SectionTitle icon={Bot} title="العمليات الجارية" />
            {state.jobs.length === 0 ? (
              <EmptyState text="لا توجد عمليات جارية." />
            ) : (
              <div className="space-y-1.5">
                {state.jobs.map((j) => (
                  <div
                    key={j.id}
                    className="p-2 rounded-md bg-bg-soft border border-line/50 text-[11px]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold truncate">{j.label}</span>
                      <span className="text-ink-mute">{Math.round(j.progress)}%</span>
                    </div>
                    <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          j.status === "completed"
                            ? "bg-emerald-500"
                            : j.status === "failed"
                            ? "bg-rose-500"
                            : "bg-gradient-to-r from-brand to-brand-accent"
                        }`}
                        style={{ width: `${j.progress}%` }}
                      />
                    </div>
                    {j.message && (
                      <div className="text-[10px] text-ink-mute mt-1">{j.message}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <SectionTitle icon={Activity} title="إحصائيات" />
            <div className="grid grid-cols-2 gap-2">
              <StatBox icon={Scissors} label="مقاطع" value={state.project.clips.length} />
              <StatBox icon={Type} label="ترجمات" value={state.project.subtitles.length} />
              <StatBox icon={AudioLines} label="صوت" value={state.project.audioClips.length} />
              <StatBox icon={Wand2} label="تأثيرات" value={state.project.effects.length} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
