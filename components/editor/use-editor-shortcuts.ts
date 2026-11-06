// اختصارات لوحة المفاتيح — منقولة حرفياً من Editor.tsx (جسم التأثير ومصفوفة تبعياته). القوائم المرجعية (refs) والـ dispatch
// ثابتة الهوية فالمصفوفة [] كما كانت. تُستدعى في Editor.tsx في موضع التأثير القديم نفسه (ترتيب الـ hooks لم يتغيّر).
import { useEffect, type Dispatch, type MutableRefObject } from "react";
import { snapPoints, timelineDuration } from "@/lib/engine/timeline";
import type { ProjectState } from "@/lib/types";
import type { Action } from "./state";

export interface ShortcutsRefs {
  dispatch: Dispatch<Action>;
  liveRef: MutableRefObject<{ playhead: number; zoom: number; project: ProjectState; clipIds: string[] }>;
  editorActionsRef: MutableRefObject<{ splitAtPlayhead: () => void; deleteSelectedClip: () => void; duplicateSelected: () => void }>;
  seekRef: MutableRefObject<(t: number) => void>;
}

export function useEditorShortcuts({ dispatch, liveRef, editorActionsRef, seekRef }: ShortcutsRefs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const live = liveRef.current;
      const total = (() => {
        const d = timelineDuration(live.project);
        return d > 0 ? d : live.project.duration || 30;
      })();
      const fps = live.project.fps || 30;
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      } else if (mod && key === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT_CLIPS", ids: live.clipIds });
      } else if (mod && key === "d") {
        e.preventDefault();
        editorActionsRef.current.duplicateSelected();
      } else if (!mod && key === "s") {
        e.preventDefault();
        editorActionsRef.current.splitAtPlayhead();
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        editorActionsRef.current.deleteSelectedClip();
      } else if (!mod && e.key === " ") {
        e.preventDefault();
        dispatch({ type: "TOGGLE_PLAY" });
      } else if (!mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const step = e.shiftKey ? 1 : 1 / fps; // Shift = ثانية، بدونه = إطار واحد
        seekRef.current(Math.max(0, Math.min(total, Math.round((live.playhead + dir * step) * fps) / fps)));
      } else if (!mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // القفز بين نقاط القطع (حدود المقاطع) السابقة/التالية.
        e.preventDefault();
        const pts = snapPoints(live.project).map((x) => x.time).sort((a, b) => a - b);
        const eps = 1e-3;
        const target = e.key === "ArrowUp" ? pts.find((t) => t > live.playhead + eps) : [...pts].reverse().find((t) => t < live.playhead - eps);
        if (target !== undefined) seekRef.current(target);
      } else if (!mod && e.key === "Home") {
        e.preventDefault();
        seekRef.current(0);
      } else if (!mod && e.key === "End") {
        e.preventDefault();
        seekRef.current(total);
      } else if (!mod && (e.key === "+" || e.key === "=")) {
        dispatch({ type: "SET_ZOOM", z: Math.min(400, Math.round(live.zoom * 1.25)) });
      } else if (!mod && (e.key === "-" || e.key === "_")) {
        dispatch({ type: "SET_ZOOM", z: Math.max(10, Math.round(live.zoom / 1.25)) });
      } else if (!mod && key === "n") {
        dispatch({ type: "TOGGLE_SNAP" });
      } else if (!mod && e.key === "Escape") {
        dispatch({ type: "SELECT_CLIP", id: null });
        dispatch({ type: "SELECT_AUDIO", id: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, liveRef, editorActionsRef, seekRef]);
}
