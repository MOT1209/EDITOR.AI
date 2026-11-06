"use client";

import { Wand2 } from "lucide-react";
import { EFFECTS_LIBRARY } from "@/lib/mockAi";
import type { Effect } from "@/lib/types";
import type { State, Action } from "../state";

export function EffectsPanel({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const categories: { id: Effect["category"]; label: string }[] = [
    { id: "transition", label: "انتقالات" },
    { id: "motion", label: "حركة" },
    { id: "color", label: "لون" },
    { id: "vfx", label: "VFX" },
  ];
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-ink-soft">
        اضغط لتفعيل/إلغاء التأثير على كامل الفيديو
      </div>
      {categories.map((cat) => (
        <div key={cat.id}>
          <div className="text-[11px] font-semibold text-ink-soft mb-1.5">{cat.label}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {EFFECTS_LIBRARY.filter((e) => e.category === cat.id).map((e) => {
              const active = state.project.effects.includes(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() => dispatch({ type: "TOGGLE_EFFECT", effectId: e.id })}
                  className={`p-2 rounded-md text-[10px] border text-right ${
                    active
                      ? "bg-brand/15 border-brand/40 text-brand-glow"
                      : "bg-bg-soft border-line/50 text-ink-soft hover:bg-bg-elev"
                  }`}
                >
                  <EffectPreview name={e.preview} active={active} />
                  <div className="mt-1 truncate">{e.name}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EffectPreview({ name, active }: { name: string; active: boolean }) {
  return (
    <div
      className={`h-10 w-full rounded-md overflow-hidden border ${
        active ? "border-brand/50" : "border-line"
      }`}
      style={{
        background:
          "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.3))",
        filter:
          name === "warm"
            ? "sepia(0.4) hue-rotate(-15deg)"
            : name === "cool"
            ? "hue-rotate(20deg) saturate(0.9)"
            : name === "cinematic"
            ? "contrast(1.2) saturate(1.2)"
            : name === "vhs"
            ? "contrast(1.3) hue-rotate(8deg)"
            : name === "fade"
            ? "brightness(0.7)"
            : name === "zoom"
            ? "brightness(1.2)"
            : name === "shake"
            ? "hue-rotate(5deg)"
            : name === "zoom-blur"
            ? "blur(1px)"
            : "none",
      }}
    >
      <div className="h-full w-full grid place-items-center">
        <Wand2 className="h-3 w-3 text-white/80" />
      </div>
    </div>
  );
}
