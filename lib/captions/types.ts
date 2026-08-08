export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptResult {
  text: string;
  language: string;
  duration?: number;
  words: Word[];
  segments: { id: number; start: number; end: number; text: string }[];
}

/** سطر ترجمة = مجموعة كلمات تُعرض معاً على الشاشة. */
export interface CaptionLine {
  start: number;
  end: number;
  words: Word[];
}

export interface CaptionTemplate {
  id: string;
  name: string;
  // أنماط الحاوية والكلمات
  fontFamily: string;
  fontWeight: number;
  fontSizeVw: number; // النسبة من عرض الفيديو
  textColor: string;
  activeColor: string; // لون الكلمة المنطوقة حالياً
  activeBg?: string; // خلفية الكلمة النشطة (اختياري)
  stroke: string; // لون الحد
  strokeWidth: number; // px
  uppercase: boolean;
  position: "bottom" | "center" | "top";
  maxWordsPerLine: number;
  shadow: string;
  pop: boolean; // تكبير الكلمة النشطة قليلاً
}
