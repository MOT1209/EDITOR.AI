// ====================================================================
// نظام Skills — الأنواع الأساسية (Core Types)
// كل Skill مستقلة وتلتزم بعقد ISkill، فيمكن إضافتها أو حذفها مستقبلاً
// دون تعديل النواة (SkillManager / Workflow).
// ====================================================================

export type SkillCategory =
  | "analysis" // تحليل (مشاهد، لقطات، وجوه، أشياء...)
  | "editing" // قص وتحرير
  | "audio" // صوت
  | "visual" // صورة/ألوان/تأطير
  | "text" // نصوص (ترجمة، عناوين، أوصاف)
  | "generation" // توليد (Shorts، صور مصغرة، B-roll)
  | "export"; // تصدير

export type SkillStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SkillLogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * المستند المشترك الذي يمرّ عبر الـ Workflow.
 * كل Skill تقرأ ما تحتاجه وتكتب ناتجها هنا، فتتشارك Skills البيانات.
 */
export interface MediaDocument {
  videoUrl?: string;
  duration: number;
  fps?: number;
  width?: number;
  height?: number;
  aspect?: string;
  frames?: string[]; // إطارات base64 مُلتقطة للتحليل البصري
  audioBase64?: string;
  language?: string;
  targetLanguage?: string;
  // نتائج متراكمة من Skills (مفاتيح ديناميكية)
  [key: string]: unknown;
}

/**
 * سياق التنفيذ — يُمرَّر لكل Skill ويتيح قراءة/كتابة البيانات المشتركة،
 * والتسجيل، وإلغاء التنفيذ عبر AbortSignal.
 */
export interface SkillContext {
  shared: MediaDocument;
  results: Record<string, unknown>;
  config: Record<string, unknown>;
  signal?: AbortSignal;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  log: (level: LogLevel, message: string, data?: unknown) => void;
}

export interface SkillResult<O = Record<string, unknown>> {
  skill: string;
  ok: boolean;
  status: SkillStatus;
  output?: O;
  error?: string;
  startedAt: number;
  durationMs: number;
  logs: SkillLogEntry[];
}

export interface SkillDescriptor {
  name: string;
  description: string;
  category: SkillCategory;
  inputSpec: Record<string, string>;
  outputSpec: Record<string, string>;
  config: Record<string, unknown>;
  status: SkillStatus;
}

/**
 * عقد كل Skill. أي Skill جديدة تُنفّذ هذا العقد (عبر BaseSkill عادةً)
 * فتعمل تلقائياً مع المدير والـ Workflow.
 */
export interface ISkill<I = MediaDocument, O = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly category: SkillCategory;
  readonly inputSpec: Record<string, string>;
  readonly outputSpec: Record<string, string>;
  config: Record<string, unknown>;
  status: SkillStatus;
  readonly logs: SkillLogEntry[];
  configure(patch: Record<string, unknown>): void;
  run(input: I, ctx: SkillContext): Promise<SkillResult<O>>;
  stop(): void;
  reset(): void;
  describe(): SkillDescriptor;
}
