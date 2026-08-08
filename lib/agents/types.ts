/**
 * أنواع خطة المونتاج الذكية (EDL) — تُنتجها وكيلة "المديرة التنفيذية"
 * وتستهلكها واجهة المحرر لتطبيق الخطة على التايملاين.
 */

export type ColorFilterId =
  | "none"
  | "cinematic"
  | "warm"
  | "cool"
  | "vhs"
  | "bw"
  | "vivid"
  | "dreamy";

export type MusicMood =
  | "ملهم"
  | "مريح"
  | "سعيد"
  | "متوتر"
  | "احترافي"
  | "حالم"
  | "قوي"
  | "دافئ";

export type CaptionStyle = "default" | "bold" | "highlight" | "karaoke";

export type OverlayPosition = "top" | "center" | "bottom";

/** جزء واحد من خطة القص: ماذا نفعل بفترة زمنية معينة من الفيديو الأصلي. */
export interface PlanSegment {
  start: number;
  end: number;
  /** true = إبقاء في الناتج، false = قص/حذف. */
  keep: boolean;
  /** سرعة التشغيل (1 = عادي، 1.2 = تسريع بسيط...). */
  speed?: number;
  /** سبب القرار (للعرض التوضيحي). */
  reason: string;
}

export interface PlanOverlay {
  text: string;
  start: number;
  end: number;
  position: OverlayPosition;
}

export interface DirectorPlan {
  title: string;
  description: string;
  tags: string[];
  /** ملخص تنفيذي قصير للعرض على المستخدم. */
  summary: string;
  style: {
    colorFilter: ColorFilterId;
    musicMood: MusicMood;
    captions: boolean;
    captionStyle: CaptionStyle;
    musicVolume: number;
  };
  /** خطة القص — يجب أن تغطي 0..مدة الفيديو. */
  segments: PlanSegment[];
  textOverlays: PlanOverlay[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface SceneInfo {
  start: number;
  end: number;
  score: number;
  description?: string;
}

export interface HighlightInfo {
  start: number;
  end: number;
  reason: string;
}

export interface QualityInfo {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
}

/** استجابة كاملة من وكيلة المديرة التنفيذية. */
export interface CeoResponse {
  plan: DirectorPlan;
  transcript: string;
  segments: TranscriptSegment[];
  silences: { start: number; end: number }[];
  scenes: SceneInfo[];
  highlights: HighlightInfo[];
  quality: QualityInfo;
  /** مسار الملف على الخادم (لعمليات التصدير اللاحقة). */
  filePath: string;
  /** true عندما لم يتوفر API key واستُخدمت خطة محلية بديلة. */
  mock: boolean;
}
