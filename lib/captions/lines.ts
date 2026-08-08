import { CaptionLine, Word } from "./types";

/**
 * تجميع الكلمات في أسطر قابلة للعرض حسب الحد الأقصى للكلمات/السطر،
 * مع كسر السطر عند الفجوات الصوتية الكبيرة (صمت > gapThreshold).
 */
export function groupWordsIntoLines(
  words: Word[],
  maxWordsPerLine: number,
  gapThreshold = 0.6
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = current[current.length - 1];
    const bigGap = prev ? w.start - prev.end > gapThreshold : false;
    if (current.length >= maxWordsPerLine || bigGap) flush();
    current.push(w);
  }
  flush();
  return lines;
}

/** السطر النشط عند زمن معيّن (أو الأقرب القادم لتفادي الوميض). */
export function activeLineIndex(lines: CaptionLine[], t: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (t >= lines[i].start && t <= lines[i].end + 0.15) return i;
  }
  // بين سطرين: أظهر السطر التالي إن كان قريباً.
  for (let i = 0; i < lines.length; i++) {
    if (t < lines[i].start && lines[i].start - t < 0.4) return i;
  }
  return -1;
}

/** فهرس الكلمة المنطوقة حالياً داخل السطر. */
export function activeWordIndex(line: CaptionLine, t: number): number {
  for (let i = 0; i < line.words.length; i++) {
    if (t >= line.words[i].start && t <= line.words[i].end) return i;
  }
  // قبل أول كلمة في السطر → لا تمييز؛ بعد آخر كلمة → آخر كلمة.
  if (t > line.words[line.words.length - 1].end) return line.words.length - 1;
  return -1;
}
