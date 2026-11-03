"use client";

import { SectionTitle } from "../ui";
import { Volume2, Download, Save, Gauge, Monitor, FileText } from "lucide-react";
import { EXPORT_PRESETS, applyExportPreset } from "@/lib/engine/export-presets";
import type { ProjectAspect, ProjectState } from "@/lib/types";
import type { State, Action } from "../state";

export function ExportPanel({
  state,
  dispatch,
  onExportSRT,
  onExportVTT,
  onExportProject,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onExportSRT: () => void;
  onExportVTT: () => void;
  onExportProject: () => void;
}) {
  const mix = state.project.audioMix ?? {};
  const setMix = (patch: Partial<NonNullable<ProjectState["audioMix"]>>) =>
    dispatch({ type: "PATCH_PROJECT", patch: { audioMix: { ...mix, ...patch } } });
  return (
    <div className="space-y-3">
      <SectionTitle icon={Download} title="إعدادات جاهزة" />
      <select
        aria-label="إعداد تصدير جاهز"
        defaultValue=""
        onChange={(e) => {
          if (!e.target.value) return;
          dispatch({ type: "COMMIT_PROJECT", project: applyExportPreset(state.project, e.target.value) });
          e.target.value = "";
        }}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        <option value="">اختر إعداداً (يضبط المقاس والدقة والإطارات والجودة والصيغة)…</option>
        {EXPORT_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.description}
          </option>
        ))}
      </select>

      <SectionTitle icon={Volume2} title="مزج الصوت" />
      <div className="space-y-2 text-[11px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mix.normalize ?? true} onChange={(e) => setMix({ normalize: e.target.checked })} />
          تطبيع الجهارة (loudnorm)
        </label>
        {(mix.normalize ?? true) && (
          <label className="flex items-center gap-2">
            <span className="w-24 text-ink-soft">الهدف (LUFS)</span>
            <input type="range" min={-30} max={-5} step={1} value={mix.targetLufs ?? -16} onChange={(e) => setMix({ targetLufs: Number(e.target.value) })} className="flex-1" aria-label="هدف الجهارة" />
            <span className="w-8 text-left font-mono">{mix.targetLufs ?? -16}</span>
          </label>
        )}
        <label className="flex items-center gap-2" title="الموسيقى والمؤثرات تنخفض تلقائياً أثناء الكلام (فيديو/تعليق/دبلجة)">
          <input type="checkbox" checked={mix.ducking?.enabled ?? false} onChange={(e) => setMix({ ducking: { enabled: e.target.checked, amountDb: mix.ducking?.amountDb ?? 12 } })} />
          خفض الموسيقى تحت الكلام (Ducking)
        </label>
        {mix.ducking?.enabled && (
          <label className="flex items-center gap-2">
            <span className="w-24 text-ink-soft">قوة الخفض (dB)</span>
            <input type="range" min={3} max={30} step={1} value={mix.ducking.amountDb ?? 12} onChange={(e) => setMix({ ducking: { enabled: true, amountDb: Number(e.target.value) } })} className="flex-1" aria-label="قوة الخفض" />
            <span className="w-8 text-left font-mono">{mix.ducking.amountDb ?? 12}</span>
          </label>
        )}
      </div>

      <SectionTitle icon={Monitor} title="المقاس" />
      <div className="grid grid-cols-2 gap-1.5">
        {(["16:9", "9:16", "1:1", "4:5"] as ProjectAspect[]).map((a) => (
          <button
            key={a}
            onClick={() => dispatch({ type: "SET_ASPECT", aspect: a })}
            className={`p-2 rounded-md border text-[10px] ${
              state.project.aspect === a
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            <div className="flex items-center justify-center h-8">
              <div
                className="border-2 border-current rounded-sm"
                style={{
                  width: a === "9:16" ? 14 : a === "1:1" ? 22 : a === "4:5" ? 18 : 32,
                  height: a === "9:16" ? 26 : a === "1:1" ? 22 : a === "4:5" ? 22 : 18,
                }}
              />
            </div>
            <div className="mt-1">{a}</div>
          </button>
        ))}
      </div>

      <SectionTitle icon={Gauge} title="الجودة" />
      <div className="grid grid-cols-2 gap-1.5">
        {(["720p", "1080p", "4k"] as const).map((r) => (
          <button
            key={r}
            onClick={() =>
              dispatch({ type: "PATCH_PROJECT", patch: { resolution: r } })
            }
            className={`p-2 rounded-md border text-[10px] ${
              state.project.resolution === r
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            {r.toUpperCase()}
          </button>
        ))}
        {([24, 30, 60] as const).map((f) => (
          <button
            key={f}
            onClick={() => dispatch({ type: "PATCH_PROJECT", patch: { fps: f } })}
            className={`p-2 rounded-md border text-[10px] ${
              state.project.fps === f
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            {f} FPS
          </button>
        ))}
      </div>

      <SectionTitle icon={FileText} title="الصيغة" />
      <div className="grid grid-cols-3 gap-1.5">
        {(["mp4", "mov", "webm"] as const).map((f) => (
          <button
            key={f}
            onClick={() => dispatch({ type: "PATCH_PROJECT", patch: { format: f } })}
            className={`p-2 rounded-md border text-[10px] uppercase ${
              state.project.format === f
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <SectionTitle icon={Download} title="الملفات" />
      <div className="space-y-1.5">
        <button className="btn-outline w-full" onClick={onExportSRT}>
          <FileText className="h-3.5 w-3.5" />
          تصدير SRT (ترجمة)
        </button>
        <button className="btn-outline w-full" onClick={onExportVTT}>
          <FileText className="h-3.5 w-3.5" />
          تصدير VTT (ترجمة ويب)
        </button>
        <button className="btn-outline w-full" onClick={onExportProject}>
          <Save className="h-3.5 w-3.5" />
          تصدير ملف المشروع JSON
        </button>
      </div>
    </div>
  );
}
