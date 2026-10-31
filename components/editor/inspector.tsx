"use client";

// لوحة الخصائص (Inspector): كل حقل يستدعي عملية محرّك حقيقية (setClipProps/setAudioClipProps)
// فتدخل سجل التراجع وتُتحقَّق بحدود project-schema. لا عناصر زخرفية:
// ما لا يُدعم بعد (المفاتيح keyframes) يُذكر نصاً صريحاً بدل زر بلا وظيفة.
import { useState } from "react";
import { Info, RotateCcw, SlidersHorizontal, Upload } from "lucide-react";
import type { Action, State } from "./state";
import type { AudioClip, ProjectState, VideoClip } from "@/lib/types";
import { COLOR_FILTERS } from "./state";
import { SectionTitle, EmptyState } from "./ui";
import { EFFECTS_LIBRARY } from "@/lib/mockAi";
import { EFFECT_IDS, TRANSITION_TYPES } from "@/lib/engine/project-schema";
import { setAudioClipProps, setClipProps, type ClipPatch } from "@/lib/engine/timeline";
import { apiFetch } from "@/lib/api-config";

type Notify = (type: "info" | "success" | "warning" | "error", title: string, message?: string) => void;

const TRANSITION_LABELS: Record<string, string> = {
  dissolve: "تلاشٍ متقاطع",
  "slide-left": "انزلاق من اليمين",
  "slide-right": "انزلاق من اليسار",
  "slide-up": "انزلاق من الأسفل",
  "slide-down": "انزلاق من الأعلى",
};

function Field({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  mixed,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  mixed?: boolean;
}) {
  const id = `insp-${label}`;
  return (
    <div className="grid grid-cols-[84px_1fr_62px] items-center gap-2 text-[11px]">
      <label htmlFor={id} className="text-ink-soft truncate" title={label}>
        {label}
      </label>
      <input
        type="range"
        aria-label={`${label} (منزلق)`}
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--brand,#6366f1)]"
      />
      <div className="flex items-center gap-0.5">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={mixed ? "" : Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
          placeholder={mixed ? "—" : undefined}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-full bg-bg-soft border border-line rounded px-1 py-0.5 text-[10px] text-left"
        />
        {unit && <span className="text-[9px] text-ink-mute">{unit}</span>}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1.5 border border-line/50 rounded-md p-2">
      <legend className="px-1 text-[10px] text-ink-mute">{title}</legend>
      {children}
    </fieldset>
  );
}

export function Inspector({ state, dispatch, notify }: { state: State; dispatch: React.Dispatch<Action>; notify: Notify }) {
  const project = state.project;
  const clips = state.selectedClipIds.map((id) => project.clips.find((c) => c.id === id)).filter((c): c is VideoClip => !!c);
  const audio = state.selectedAudioId ? project.audioClips.find((a) => a.id === state.selectedAudioId) : undefined;

  if (audio) return <AudioInspector clip={audio} project={project} dispatch={dispatch} notify={notify} />;
  if (clips.length === 0) {
    return (
      <div className="space-y-3">
        <SectionTitle icon={SlidersHorizontal} title="الخصائص" />
        <EmptyState text="حدّد مقطعاً على التايملاين (أو عدة مقاطع بـ Shift/Ctrl) لتعديل موضعه وحجمه وتدويره وشفافيته وصوته وسرعته واقتصاصه وتأثيراته." />
      </div>
    );
  }

  const first = clips[0];
  const multi = clips.length > 1;
  const same = <K extends keyof VideoClip>(k: K) => clips.every((c) => c[k] === first[k]);
  const apply = (patch: ClipPatch) => {
    try {
      let p = project;
      for (const c of clips) p = setClipProps(p, c.id, patch);
      dispatch({ type: "COMMIT_PROJECT", project: p });
    } catch (e) {
      notify("error", "تعذّر التعديل", e instanceof Error ? e.message : undefined);
    }
  };
  const isImage = first.kind === "image";
  const crop = first.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const color = first.color ?? {};
  const speedLocked = isImage;

  return (
    <div className="space-y-2.5">
      <SectionTitle icon={SlidersHorizontal} title={multi ? `الخصائص — ${clips.length} مقاطع` : "الخصائص"} />
      {multi && <div className="text-[10px] text-ink-mute">القيم تُطبَّق على كل المقاطع المحدّدة. الحقول المختلفة بينها تظهر فارغة.</div>}

      <Group title="التحويل (Transform)">
        <Field label="الموضع X" value={(first.posX ?? 0) * 100} min={-100} max={100} unit="%" mixed={multi && !same("posX")} onChange={(v) => apply({ posX: v / 100 })} />
        <Field label="الموضع Y" value={(first.posY ?? 0) * 100} min={-100} max={100} unit="%" mixed={multi && !same("posY")} onChange={(v) => apply({ posY: v / 100 })} />
        <Field label="الحجم" value={(first.scale ?? 1) * 100} min={5} max={500} unit="%" mixed={multi && !same("scale")} onChange={(v) => apply({ scale: v / 100 })} />
        <Field label="التدوير" value={first.rotation ?? 0} min={-360} max={360} unit="°" mixed={multi && !same("rotation")} onChange={(v) => apply({ rotation: v })} />
        <Field label="الشفافية" value={(first.opacity ?? 1) * 100} min={0} max={100} unit="%" mixed={multi && !same("opacity")} onChange={(v) => apply({ opacity: v / 100 })} />
        <Field label="تكبير المحتوى" value={first.zoom ?? 1} min={1} max={10} step={0.05} unit="×" mixed={multi && !same("zoom")} onChange={(v) => apply({ zoom: v })} />
        <Field label="إزاحة المحتوى X" value={(first.panX ?? 0) * 100} min={-50} max={50} unit="%" mixed={multi && !same("panX")} onChange={(v) => apply({ panX: v / 100 })} />
        <Field label="إزاحة المحتوى Y" value={(first.panY ?? 0) * 100} min={-50} max={50} unit="%" mixed={multi && !same("panY")} onChange={(v) => apply({ panY: v / 100 })} />
        <button
          className="btn-outline w-full text-[10px]"
          onClick={() => apply({ posX: 0, posY: 0, scale: 1, rotation: 0, opacity: 1, zoom: 1, panX: 0, panY: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 } })}
        >
          <RotateCcw className="h-3 w-3" />
          إعادة ضبط التحويل
        </button>
      </Group>

      <Group title="الاقتصاص (Crop)">
        {(["left", "top", "right", "bottom"] as const).map((side) => (
          <Field
            key={side}
            label={{ left: "يسار", top: "أعلى", right: "يمين", bottom: "أسفل" }[side]}
            value={crop[side] * 100}
            min={0}
            max={90}
            unit="%"
            onChange={(v) => {
              const next = { ...crop, [side]: v / 100 };
              if (next.left + next.right > 0.95 || next.top + next.bottom > 0.95) return notify("warning", "اقتصاص مفرط", "لا يمكن اقتصاص أكثر من 95% من أي بُعد");
              apply({ crop: next });
            }}
          />
        ))}
      </Group>

      {!isImage && (
        <Group title="الصوت والسرعة">
          <Field label="مستوى الصوت" value={(first.volume ?? 1) * 100} min={0} max={400} unit="%" mixed={multi && !same("volume")} onChange={(v) => apply({ volume: v / 100 })} />
          <Field label="تلاشي صوت دخول" value={first.audioFadeIn ?? 0} min={0} max={10} step={0.1} unit="s" onChange={(v) => apply({ audioFadeIn: v })} />
          <Field label="تلاشي صوت خروج" value={first.audioFadeOut ?? 0} min={0} max={10} step={0.1} unit="s" onChange={(v) => apply({ audioFadeOut: v })} />
          <Field label="السرعة" value={first.speed ?? 1} min={0.1} max={8} step={0.05} unit="×" mixed={multi && !same("speed")} onChange={(v) => !speedLocked && apply({ speed: v })} />
        </Group>
      )}

      <Group title="التلاشي البصري والانتقال">
        <Field label="تلاشي دخول" value={first.fadeIn ?? 0} min={0} max={10} step={0.1} unit="s" onChange={(v) => apply({ fadeIn: v })} />
        <Field label="تلاشي خروج" value={first.fadeOut ?? 0} min={0} max={10} step={0.1} unit="s" onChange={(v) => apply({ fadeOut: v })} />
        <div className="grid grid-cols-[84px_1fr] items-center gap-2 text-[11px]">
          <label htmlFor="insp-trans" className="text-ink-soft">انتقال الدخول</label>
          <select
            id="insp-trans"
            value={first.transitionIn?.type ?? ""}
            onChange={(e) => (e.target.value ? apply({ transitionIn: { type: e.target.value as (typeof TRANSITION_TYPES)[number], duration: first.transitionIn?.duration ?? 0.5 } }) : apply({ transitionIn: null }))}
            className="bg-bg-soft border border-line rounded px-1 py-1 text-[10px]"
          >
            <option value="">بدون</option>
            {TRANSITION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        {first.transitionIn && (
          <>
            <Field label="مدة الانتقال" value={first.transitionIn.duration} min={0.1} max={5} step={0.1} unit="s" onChange={(v) => apply({ transitionIn: { ...first.transitionIn!, duration: v } })} />
            <div className="text-[10px] text-ink-mute flex gap-1">
              <Info className="h-3 w-3 shrink-0 mt-0.5" />
              يظهر الانتقال أسفل المقطع السابق المتلاصق على المسار نفسه (آخر إطار له يُثبَّت أثناء الانتقال).
            </div>
          </>
        )}
      </Group>

      <Group title="الألوان">
        <div className="grid grid-cols-[84px_1fr] items-center gap-2 text-[11px]">
          <label htmlFor="insp-cf" className="text-ink-soft">مرشح</label>
          <select id="insp-cf" value={first.colorFilter ?? "none"} onChange={(e) => apply({ colorFilter: e.target.value })} className="bg-bg-soft border border-line rounded px-1 py-1 text-[10px]">
            {COLOR_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <Field label="السطوع" value={(color.brightness ?? 0) * 100} min={-100} max={100} unit="%" onChange={(v) => apply({ color: { ...color, brightness: v / 100 } })} />
        <Field label="التباين" value={(color.contrast ?? 1) * 100} min={0} max={300} unit="%" onChange={(v) => apply({ color: { ...color, contrast: v / 100 } })} />
        <Field label="التشبّع" value={(color.saturation ?? 1) * 100} min={0} max={300} unit="%" onChange={(v) => apply({ color: { ...color, saturation: v / 100 } })} />
      </Group>

      <Group title="التأثيرات">
        <div className="grid grid-cols-2 gap-1">
          {EFFECTS_LIBRARY.filter((e) => (EFFECT_IDS as readonly string[]).includes(e.id) && e.id !== "fx_slide_l").map((e) => {
            const on = clips.every((c) => c.effects.includes(e.id));
            return (
              <label key={e.id} className={`flex items-center gap-1.5 text-[10px] px-1.5 py-1 rounded border cursor-pointer ${on ? "border-brand/50 bg-brand/10 text-brand-glow" : "border-line text-ink-soft"}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    try {
                      let p = project;
                      for (const c of clips) {
                        const has = c.effects.includes(e.id);
                        if (on === has) p = setClipProps(p, c.id, { effects: has ? c.effects.filter((x) => x !== e.id) : [...c.effects, e.id] });
                      }
                      dispatch({ type: "COMMIT_PROJECT", project: p });
                    } catch (err) {
                      notify("error", "تعذّر التعديل", err instanceof Error ? err.message : undefined);
                    }
                  }}
                />
                {e.name}
              </label>
            );
          })}
        </div>
      </Group>

      <div className="text-[10px] text-ink-mute flex gap-1 border border-line/40 rounded-md p-2">
        <Info className="h-3 w-3 shrink-0 mt-0.5" />
        <span>
          المفاتيح (Keyframes): <b>غير مدعومة بعد</b> — كل خاصية بقيمة ثابتة طوال المقطع. للتغيير عبر الزمن قسّم المقطع وغيّر القيم لكل جزء. التفاصيل في docs/RENDERING.md.
        </span>
      </div>
    </div>
  );
}

function AudioInspector({ clip, project, dispatch, notify }: { clip: AudioClip; project: ProjectState; dispatch: React.Dispatch<Action>; notify: Notify }) {
  const [uploading, setUploading] = useState(false);
  const apply = (patch: Partial<AudioClip>) => {
    try {
      dispatch({ type: "COMMIT_PROJECT", project: setAudioClipProps(project, clip.id, patch) });
    } catch (e) {
      notify("error", "تعذّر التعديل", e instanceof Error ? e.message : undefined);
    }
  };
  const upload = async () => {
    setUploading(true);
    try {
      const blob = await fetch(clip.url).then((r) => r.blob());
      const ext = blob.type.includes("wav") ? ".wav" : blob.type.includes("ogg") ? ".ogg" : blob.type.includes("mp4") || blob.type.includes("m4a") ? ".m4a" : ".mp3";
      const form = new FormData();
      form.append("file", new File([blob], `${clip.name || "audio"}${ext}`, { type: blob.type }));
      const res = await apiFetch("/api/assets/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ref) throw new Error(data.error || "فشل الرفع");
      apply({ ref: data.ref });
      notify("success", "رُفع الصوت للخادم", "سيدخل الآن ملف التصدير");
    } catch (e) {
      notify("error", "تعذّر رفع الصوت", e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="space-y-2.5">
      <SectionTitle icon={SlidersHorizontal} title={`صوت: ${clip.name}`} />
      <div className={`text-[10px] rounded-md p-2 border ${clip.ref ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/5" : "border-amber-500/30 text-amber-300 bg-amber-500/5"}`}>
        {clip.ref ? "الملف على الخادم — يدخل التصدير." : "الملف في المتصفح فقط (blob) — لن يدخل التصدير حتى تضغط «رفع للخادم»."}
      </div>
      {!clip.ref && (
        <button className="btn-primary w-full text-[11px]" disabled={uploading} onClick={upload}>
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "جارٍ الرفع…" : "رفع للخادم ليدخل التصدير"}
        </button>
      )}
      <Group title="الصوت">
        <Field label="مستوى الصوت" value={clip.volume * 100} min={0} max={400} unit="%" onChange={(v) => apply({ volume: v / 100 })} />
        <Field label="تلاشي دخول" value={clip.fadeIn ?? 0} min={0} max={30} step={0.1} unit="s" onChange={(v) => apply({ fadeIn: v })} />
        <Field label="تلاشي خروج" value={clip.fadeOut ?? 0} min={0} max={30} step={0.1} unit="s" onChange={(v) => apply({ fadeOut: v })} />
      </Group>
      <Group title="التوقيت (مزامنة)">
        <Field label="البداية" value={clip.start} min={0} max={Math.max(600, clip.start + 60)} step={1 / (project.fps || 30)} unit="s" onChange={(v) => apply({ start: v })} />
        <Field label="المدة" value={clip.duration} min={0.05} max={Math.max(600, clip.duration)} step={0.05} unit="s" onChange={(v) => apply({ duration: v })} />
        <Field label="نقطة الدخول" value={clip.inPoint ?? 0} min={0} max={Math.max(600, (clip.inPoint ?? 0) + 60)} step={0.05} unit="s" onChange={(v) => apply({ inPoint: v })} />
      </Group>
      <Group title="النوع (يحدد ناقل المزج والـ ducking)">
        <select
          aria-label="نوع الصوت"
          value={clip.kind}
          onChange={(e) => apply({ kind: e.target.value as AudioClip["kind"] })}
          className="w-full bg-bg-soft border border-line rounded px-1 py-1 text-[11px]"
        >
          <option value="music">موسيقى (تُخفَض تحت الكلام)</option>
          <option value="sfx">مؤثرات (تُخفَض تحت الكلام)</option>
          <option value="voiceover">تعليق صوتي (يخفض الموسيقى)</option>
          <option value="dub">دبلجة (يخفض الموسيقى)</option>
        </select>
      </Group>
    </div>
  );
}
