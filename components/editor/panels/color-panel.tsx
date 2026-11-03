"use client";

import { SectionTitle, SliderRow, ToggleRow } from "../ui";
import { Palette, Sliders, Aperture } from "lucide-react";
import { COLOR_FILTERS } from "../state";
import type { State, Action } from "../state";

export function ColorPanel({
  state,
  dispatch,
  colorGrading,
  setColorGrading,
  videoStabilize,
  setVideoStabilize,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  colorGrading: number;
  setColorGrading: (n: number) => void;
  videoStabilize: boolean;
  setVideoStabilize: (b: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Palette} title="فلاتر الألوان" />
      <div className="grid grid-cols-2 gap-1.5">
        {COLOR_FILTERS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              if (state.project.clips[0]) {
                dispatch({
                  type: "UPDATE_CLIP",
                  id: state.project.clips[0].id,
                  patch: { colorFilter: c.id },
                });
              }
            }}
            className="rounded-md overflow-hidden border border-line/50 hover:border-brand/40"
          >
            <div
              className="h-12"
              style={{
                background: "linear-gradient(135deg, #7c3aed, #06b6d4, #f59e0b)",
                filter: c.css,
              }}
            />
            <div className="text-[10px] py-1 bg-bg-soft">{c.name}</div>
          </button>
        ))}
      </div>

      <SectionTitle icon={Sliders} title="مستوى التصحيح" />
      <SliderRow
        label="قوة التصحيح اللوني"
        value={colorGrading}
        onChange={setColorGrading}
        min={0}
        max={1}
        step={0.05}
        suffix={`${Math.round(colorGrading * 100)}%`}
      />

      <SectionTitle icon={Aperture} title="التثبيت" />
      <ToggleRow
        label="تثبيت الفيديو تلقائياً"
        value={videoStabilize}
        onChange={setVideoStabilize}
      />
    </div>
  );
}
