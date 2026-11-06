"use client";

import { SectionTitle, SliderRow } from "../ui";
import { Scissors, Volume2, Wand2 } from "lucide-react";
import type { State, Action } from "../state";

export function AudioPanel({
  state,
  dispatch,
  onEnhanceAudio,
  audioDenoise,
  setAudioDenoise,
  audioEnhance,
  setAudioEnhance,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onEnhanceAudio: () => void;
  audioDenoise: number;
  setAudioDenoise: (n: number) => void;
  audioEnhance: number;
  setAudioEnhance: (n: number) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Volume2} title="تحسين الصوت" />
      <button className="btn-primary w-full" onClick={onEnhanceAudio}>
        <Wand2 className="h-4 w-4" />
        تحسين تلقائي للصوت
      </button>

      <SliderRow
        label="إزالة الضوضاء"
        value={audioDenoise}
        onChange={setAudioDenoise}
        min={0}
        max={1}
        step={0.05}
        suffix={`${Math.round(audioDenoise * 100)}%`}
      />
      <SliderRow
        label="تحسين الترددات"
        value={audioEnhance}
        onChange={setAudioEnhance}
        min={0}
        max={1}
        step={0.05}
        suffix={`${Math.round(audioEnhance * 100)}%`}
      />

      <SectionTitle icon={Scissors} title="الصمت" />
      <button
        className="btn-outline w-full"
        onClick={() => {
          const ev = new CustomEvent("ai-trigger", { detail: "silence" });
          window.dispatchEvent(ev);
        }}
      >
        <Scissors className="h-3.5 w-3.5" />
        إزالة الصمت تلقائياً
      </button>
    </div>
  );
}
