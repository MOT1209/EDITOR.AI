// تأطير المقطع (zoom/pan عند smartZoom) — منطق نقي مشترك بين التصدير (ffmpeg crop) والمعاينة (CSS transform).
import type { VideoClip } from "@/lib/types";

export interface Framing {
  zoom: number;
  panX: number;
  panY: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

/** تأطير المقطع عند smartZoom فقط؛ undefined إن لا أثر (zoom≈1 وبلا إزاحة). */
export function clipFraming(c: Pick<VideoClip, "smartZoom" | "zoom" | "panX" | "panY">): Framing | undefined {
  if (!c.smartZoom) return undefined;
  const zoom = clamp(c.zoom, 1, 4);
  const panX = clamp(c.panX, -0.5, 0.5);
  const panY = clamp(c.panY, -0.5, 0.5);
  if (zoom < 1.001 && Math.abs(panX) < 0.001 && Math.abs(panY) < 0.001) return undefined;
  return { zoom: r3(zoom), panX: r3(panX), panY: r3(panY) };
}

/**
 * CSS transform للمعاينة بنفس هندسة قصّ التصدير: نافذة بحجم 1/zoom مقيّدة داخل الإطار
 * (أقصى إزاحة للمركز = 0.5 - 0.5/zoom). تقريبي حين تختلف نسبة العرض عن نسبة المصدر (المعاينة letterbox).
 */
export function framingCss(f: Framing | undefined): string | undefined {
  if (!f) return undefined;
  const lim = 0.5 - 0.5 / f.zoom;
  const px = clamp(f.panX, -lim, lim);
  const py = clamp(f.panY, -lim, lim);
  return `scale(${f.zoom}) translate(${r3(-px * 100)}%, ${r3(-py * 100)}%)`;
}

/** المقطع الفيديوي النشط عند زمن التايملاين t (آخر ما يبدأ قبل t ويغطيه). */
export function activeVideoClip(clips: VideoClip[], t: number): VideoClip | undefined {
  let best: VideoClip | undefined;
  for (const c of clips) {
    if (c.kind === "image") continue;
    if (t >= c.start && t < c.start + c.duration && (!best || c.start >= best.start)) best = c;
  }
  return best;
}
