// إعدادات تصدير مسبقة — بيانات خالصة؛ كل قيمة ضمن حدود project-schema (تُتحقق في الاختبار).
import type { ProjectState } from "@/lib/types";

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  aspect: ProjectState["aspect"];
  resolution: ProjectState["resolution"];
  fps: ProjectState["fps"];
  quality: ProjectState["quality"];
  format: ProjectState["format"];
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "youtube-1080p", name: "يوتيوب 1080p", description: "16:9 · 1920×1080 · 30fps · جودة عالية", aspect: "16:9", resolution: "1080p", fps: 30, quality: "high", format: "mp4" },
  { id: "youtube-4k", name: "يوتيوب 4K", description: "16:9 · 3840×2160 · 30fps · جودة عالية (بطيء)", aspect: "16:9", resolution: "4k", fps: 30, quality: "high", format: "mp4" },
  { id: "shorts-vertical", name: "شورتس/تيك توك/ريلز", description: "9:16 · 1080×1920 · 30fps", aspect: "9:16", resolution: "1080p", fps: 30, quality: "standard", format: "mp4" },
  { id: "instagram-square", name: "إنستغرام مربع", description: "1:1 · 1080×1080 · 30fps", aspect: "1:1", resolution: "1080p", fps: 30, quality: "standard", format: "mp4" },
  { id: "instagram-portrait", name: "إنستغرام عمودي", description: "4:5 · 1080×1350 · 30fps", aspect: "4:5", resolution: "1080p", fps: 30, quality: "standard", format: "mp4" },
  { id: "cinema-24", name: "سينمائي 24fps", description: "16:9 · 1080p · 24fps · جودة فائقة", aspect: "16:9", resolution: "1080p", fps: 24, quality: "ultra", format: "mp4" },
  { id: "smooth-60", name: "سلس 60fps", description: "16:9 · 1080p · 60fps", aspect: "16:9", resolution: "1080p", fps: 60, quality: "high", format: "mp4" },
  { id: "web-webm", name: "ويب WebM", description: "16:9 · 720p · VP9/Opus", aspect: "16:9", resolution: "720p", fps: 30, quality: "standard", format: "webm" },
  { id: "draft-720p", name: "مسودة سريعة", description: "720p · جودة مسودة — للمراجعة فقط", aspect: "16:9", resolution: "720p", fps: 30, quality: "draft", format: "mp4" },
];

export function findPreset(id: string): ExportPreset | undefined {
  return EXPORT_PRESETS.find((p) => p.id === id);
}

/** يطبّق إعداداً مسبقاً على المشروع (لا يغيّر المحتوى). */
export function applyExportPreset(p: ProjectState, id: string): ProjectState {
  const preset = findPreset(id);
  if (!preset) throw new Error(`إعداد تصدير غير معروف: ${id}`);
  return { ...p, aspect: preset.aspect, resolution: preset.resolution, fps: preset.fps, quality: preset.quality, format: preset.format, updatedAt: Date.now() };
}
