"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { SectionTitle, SliderRow, ColorRow } from "../ui";
import { Captions, Mic, Languages, Type, Plus } from "lucide-react";
import type { TextOverlay } from "@/lib/types";
import { FONT_OPTIONS } from "../state";
import type { State, Action } from "../state";

interface TextPanelProps {
  state: State;
  dispatch: React.Dispatch<Action>;
  onSubtitles: () => void;
  subLang: string;
  setSubLang: (s: string) => void;
  subtitleText: string;
  setSubtitleText: (s: string) => void;
  onAddSubtitle: () => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontColor: string;
  setFontColor: (s: string) => void;
  fontBg: string;
  setFontBg: (s: string) => void;
  fontFamily: string;
  setFontFamily: (s: string) => void;
  translateTarget: string;
  setTranslateTarget: (s: string) => void;
  onTranslate: () => void;
  voiceoverText: string;
  setVoiceoverText: (s: string) => void;
  ttsVoice: string;
  setTtsVoice: (s: string) => void;
  onDub: () => void;
}

export function TextPanel({ props }: { props: TextPanelProps }) {
  const [overlayText, setOverlayText] = useState("");
  const [overlayPosition, setOverlayPosition] = useState<TextOverlay["position"]>("center");
  const [overlayFont, setOverlayFont] = useState(FONT_OPTIONS[0].css);
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlaySize, setOverlaySize] = useState(56);
  const [overlayDuration, setOverlayDuration] = useState(3);
  const [overlayAnimation, setOverlayAnimation] = useState<TextOverlay["animation"]>("fade");

  const addTextOverlay = () => {
    if (!overlayText.trim()) return;
    const start = props.state.playhead || 0;
    props.dispatch({
      type: "ADD_TEXT_OVERLAY",
      overlay: {
        id: uuid(),
        text: overlayText,
        start,
        end: start + overlayDuration,
        position: overlayPosition,
        fontFamily: overlayFont,
        fontSize: overlaySize,
        color: overlayColor,
        animation: overlayAnimation,
      },
    });
    setOverlayText("");
  };

  return (
    <div className="space-y-3">
      <SectionTitle icon={Type} title="عنوان / نص حر" />
      <textarea
        value={overlayText}
        onChange={(e) => setOverlayText(e.target.value)}
        rows={2}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        placeholder="اكتب العنوان أو النص..."
      />
      <div className="grid grid-cols-2 gap-1.5">
        {(["top", "center", "bottom"] as TextOverlay["position"][]).map((p) => (
          <button
            key={p}
            onClick={() => setOverlayPosition(p)}
            className={`p-1.5 rounded-md border text-[10px] ${
              overlayPosition === p ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"
            }`}
          >
            {p === "top" ? "أعلى" : p === "center" ? "وسط" : "أسفل"}
          </button>
        ))}
        <select
          value={overlayAnimation}
          onChange={(e) => setOverlayAnimation(e.target.value as TextOverlay["animation"])}
          className="bg-bg-soft border border-line rounded-md px-2 py-1 text-[10px]"
        >
          <option value="none">بدون حركة</option>
          <option value="fade">تلاشي</option>
          <option value="pop">قفزة</option>
        </select>
      </div>
      <select
        value={overlayFont}
        onChange={(e) => setOverlayFont(e.target.value)}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.id} value={f.css}>{f.name}</option>
        ))}
      </select>
      <SliderRow label="حجم الخط" value={overlaySize} onChange={setOverlaySize} min={20} max={120} suffix={`${overlaySize}px`} />
      <SliderRow label="مدة الظهور" value={overlayDuration} onChange={setOverlayDuration} min={1} max={10} step={0.5} suffix={`${overlayDuration}s`} />
      <ColorRow label="لون النص" value={overlayColor} onChange={setOverlayColor} />
      <button className="btn-primary w-full" onClick={addTextOverlay}>
        <Plus className="h-3.5 w-3.5" />
        أضف للتايملاين (من موضع المؤشر)
      </button>

      <SectionTitle icon={Captions} title="ترجمة تلقائية" />
      <button className="btn-primary w-full" onClick={props.onSubtitles}>
        <Captions className="h-4 w-4" />
        توليد الترجمة
      </button>
      <div>
        <div className="text-[11px] text-ink-soft mb-1">لغة الترجمة</div>
        <select
          value={props.subLang}
          onChange={(e) => props.setSubLang(e.target.value)}
          className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
          <option value="tr">Türkçe</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      <SectionTitle icon={Plus} title="إضافة ترجمة يدوية" />
      <textarea
        value={props.subtitleText}
        onChange={(e) => props.setSubtitleText(e.target.value)}
        rows={3}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        placeholder="اكتب نص الترجمة هنا..."
      />
      <button className="btn-outline w-full" onClick={props.onAddSubtitle}>
        <Plus className="h-3.5 w-3.5" />
        إضافة للتايملاين
      </button>

      <SectionTitle icon={Type} title="نمط الترجمة" />
      <div className="space-y-2">
        <SliderRow
          label="حجم الخط"
          value={props.fontSize}
          onChange={props.setFontSize}
          min={14}
          max={48}
          suffix="px"
        />
        <ColorRow label="لون النص" value={props.fontColor} onChange={props.setFontColor} />
        <ColorRow label="لون الخلفية" value={props.fontBg} onChange={props.setFontBg} />
        <div>
          <div className="text-[11px] text-ink-soft mb-1">نوع الخط</div>
          <select
            value={props.fontFamily}
            onChange={(e) => props.setFontFamily(e.target.value)}
            className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SectionTitle icon={Languages} title="ترجمة ودبلجة" />
      <select
        value={props.translateTarget}
        onChange={(e) => props.setTranslateTarget(e.target.value)}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="es">Español</option>
        <option value="tr">Türkçe</option>
        <option value="de">Deutsch</option>
      </select>
      <button className="btn-outline w-full" onClick={props.onTranslate}>
        <Languages className="h-3.5 w-3.5" />
        ترجمة الترجمات
      </button>

      <SectionTitle icon={Mic} title="تعليق صوتي / TTS" />
      <textarea
        value={props.voiceoverText}
        onChange={(e) => props.setVoiceoverText(e.target.value)}
        rows={3}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        placeholder="اكتب النص المراد تحويله لصوت..."
      />
      <select
        value={props.ttsVoice}
        onChange={(e) => props.setTtsVoice(e.target.value)}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        <option value="ar-male-1">صوت عربي - ذكر</option>
        <option value="ar-female-1">صوت عربي - أنثى</option>
        <option value="en-male-1">English - Male</option>
        <option value="en-female-1">English - Female</option>
        <option value="clone">استنساخ صوتي (محلياً)</option>
      </select>
      <button className="btn-primary w-full" onClick={props.onDub}>
        <Mic className="h-3.5 w-3.5" />
        توليد الصوت وإضافته
      </button>
    </div>
  );
}
