import { CaptionLine } from "./types";

function fmtSrt(t: number): string {
  const ms = Math.floor((t % 1) * 1000);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function fmtAss(t: number): string {
  const cs = Math.floor((t % 1) * 100);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

/** SRT على مستوى السطر. */
export function linesToSrt(lines: CaptionLine[]): string {
  return lines
    .map((l, i) => {
      const text = l.words.map((w) => w.text).join(" ");
      return `${i + 1}\n${fmtSrt(l.start)} --> ${fmtSrt(l.end)}\n${text}\n`;
    })
    .join("\n");
}

/**
 * ASS مع تأثير كاريوكي حقيقي (\k) — كل كلمة تُضاء في وقتها.
 * قابل للحرق (burn-in) في أي محرّر يدعم ASS أو عبر ffmpeg.
 */
export function linesToAss(lines: CaptionLine[], title = "Captions"): string {
  const header = `[Script Info]
Title: ${title}
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,90,&H00FFFFFF,&H0000E6FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = lines
    .map((l) => {
      const kara = l.words
        .map((w) => {
          const durCs = Math.max(1, Math.round((w.end - w.start) * 100));
          return `{\\k${durCs}}${w.text} `;
        })
        .join("");
      return `Dialogue: 0,${fmtAss(l.start)},${fmtAss(l.end)},Default,,0,0,0,,${kara.trim()}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
