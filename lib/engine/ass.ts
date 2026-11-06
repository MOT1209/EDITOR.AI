// بناء ملف ASS للترجمات والنصوص (مفصول عن مُشغّل ffmpeg ليشاركه المركِّب).
import type { SubtitleCue, TextOverlay } from "@/lib/types";

// ffmpeg's subtitles filter chokes on a Windows drive-letter colon in an
// absolute path no matter how it's escaped/quoted (tested: backslash-escape
// and single-quote-wrap both fail with "Unable to parse original_size"). The
// reliable workaround is to run ffmpeg with cwd set to the file's directory
// and reference it by bare filename, avoiding the colon entirely.

function assTimestamp(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const csRem = cs % 100;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(csRem)}`;
}

// TextOverlay.color is a CSS "#RRGGBB" hex; ASS override tags use "&HBBGGRR&"
// (reversed byte order, no leading #).
function cssColorToAssBgr(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!m) return "FFFFFF";
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `${b}${g}${r}`.toUpperCase();
}

const ALIGN_CODE: Record<TextOverlay["position"], number> = { bottom: 2, center: 5, top: 8 };

function assAnimationTag(animation: TextOverlay["animation"]): string {
  if (animation === "fade") return "\\fad(300,300)";
  if (animation === "pop") return "\\t(0,200,\\fscx115\\fscy115)\\t(200,400,\\fscx100\\fscy100)";
  return "";
}

// Regular timed subtitles use a single plain default style (bottom-center) —
// the same look the old plain-.srt rendering produced. Text overlays get an
// inline override tag per line for position/font/size/color, so no per-item
// named ASS style is needed.
export function buildAss(
  subtitles: SubtitleCue[],
  textOverlays: TextOverlay[],
  width: number,
  height: number
): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const subtitleLines = subtitles.map(
    (c) => `Dialogue: 0,${assTimestamp(c.start)},${assTimestamp(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`
  );

  const overlayLines = textOverlays.map((t) => {
    const align = ALIGN_CODE[t.position] ?? 5;
    const bgr = cssColorToAssBgr(t.color);
    const tags = `{\\an${align}\\fs${t.fontSize}\\c&H${bgr}&${assAnimationTag(t.animation)}}`;
    return `Dialogue: 1,${assTimestamp(t.start)},${assTimestamp(t.end)},Default,,0,0,0,,${tags}${t.text.replace(/\n/g, "\\N")}`;
  });

  return [header, ...subtitleLines, ...overlayLines].join("\n") + "\n";
}

