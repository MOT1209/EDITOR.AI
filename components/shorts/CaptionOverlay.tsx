"use client";

import { CSSProperties, useMemo } from "react";
import { CaptionLine, CaptionTemplate } from "@/lib/captions/types";
import { activeLineIndex, activeWordIndex } from "@/lib/captions/lines";

interface Props {
  lines: CaptionLine[];
  template: CaptionTemplate;
  time: number;
  /** عرض حاوية الفيديو بالبكسل لحساب حجم الخط من fontSizeVw. */
  containerWidth: number;
}

export default function CaptionOverlay({ lines, template, time, containerWidth }: Props) {
  const li = useMemo(() => activeLineIndex(lines, time), [lines, time]);
  if (li < 0 || !lines[li]) return null;

  const line = lines[li];
  const wi = activeWordIndex(line, time);
  const fontSize = (template.fontSizeVw / 100) * (containerWidth || 360);

  const posStyle: CSSProperties =
    template.position === "center"
      ? { top: "50%", transform: "translateY(-50%)" }
      : template.position === "top"
      ? { top: "10%" }
      : { bottom: "12%" };

  const baseWord: CSSProperties = {
    fontFamily: template.fontFamily,
    fontWeight: template.fontWeight,
    fontSize,
    lineHeight: 1.1,
    color: template.textColor,
    WebkitTextStroke: `${template.strokeWidth}px ${template.stroke}`,
    // paint-order يجعل الحد خلف التعبئة فيظهر النص واضحاً
    paintOrder: "stroke fill",
    textShadow: template.shadow,
    textTransform: template.uppercase ? "uppercase" : "none",
    transition: "color 80ms linear, transform 80ms ease",
    padding: "0 0.12em",
    display: "inline-block",
    whiteSpace: "nowrap",
  } as CSSProperties;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...posStyle,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "0.05em",
        padding: "0 6%",
        pointerEvents: "none",
        textAlign: "center",
        direction: "rtl",
      }}
    >
      {line.words.map((w, i) => {
        const isActive = i === wi;
        const style: CSSProperties = { ...baseWord };
        if (isActive) {
          style.color = template.activeColor;
          if (template.activeBg) {
            style.background = template.activeBg;
            style.borderRadius = "0.12em";
          }
          if (template.pop) style.transform = "scale(1.12)";
        }
        return (
          <span key={`${i}-${w.start}`} style={style}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
}
