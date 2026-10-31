// حالة المحرّر: أنواع، ثوابت الواجهة، ومختزل (reducer) — مستخرجة من Editor.tsx
// لتقليل حجم الملف الأحادي وتسهيل الاختبار وإعادة الاستخدام.
import { Sparkles, FolderOpen, Wand2, Music, Type, Volume2, Palette, Download } from "lucide-react";
import { defaultProject } from "@/lib/project";
import type {
  AIJob,
  AppNotification,
  AudioClip,
  ProjectAspect,
  ProjectState,
  SubtitleCue,
  TextOverlay,
  TimelineTrack,
  VideoClip,
} from "@/lib/types";

export const TABS = [
  { id: "ai", label: "أدوات الذكاء", icon: Sparkles },
  { id: "media", label: "الوسائط", icon: FolderOpen },
  { id: "effects", label: "تأثيرات", icon: Wand2 },
  { id: "music", label: "موسيقى", icon: Music },
  { id: "text", label: "نص وترجمة", icon: Type },
  { id: "audio", label: "صوت", icon: Volume2 },
  { id: "color", label: "ألوان", icon: Palette },
  { id: "export", label: "تصدير", icon: Download },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const COLOR_FILTERS = [
  { id: "none", name: "بدون", css: "none" },
  { id: "cinematic", name: "سينمائي", css: "contrast(1.1) saturate(1.15) brightness(0.95)" },
  { id: "warm", name: "دافئ", css: "sepia(0.2) saturate(1.3) hue-rotate(-10deg)" },
  { id: "cool", name: "بارد", css: "hue-rotate(15deg) saturate(0.9) brightness(1.05)" },
  { id: "vhs", name: "VHS", css: "contrast(1.2) saturate(0.85) hue-rotate(5deg)" },
  { id: "bw", name: "أبيض وأسود", css: "grayscale(1)" },
  { id: "vivid", name: "حيوي", css: "saturate(1.6) contrast(1.1)" },
  { id: "dreamy", name: "حالم", css: "brightness(1.1) saturate(1.2) blur(0.4px)" },
];

export const FONT_OPTIONS = [
  { id: "tajawal", name: "تجوال", css: "Tajawal, system-ui, sans-serif" },
  { id: "cairo", name: "القاهرة", css: "Cairo, system-ui, sans-serif" },
  { id: "ibm", name: "IBM Plex", css: "'IBM Plex Sans Arabic', system-ui, sans-serif" },
  { id: "system", name: "النظام", css: "system-ui, sans-serif" },
];

// صيغة SRT: HH:MM:SS,mmm (فاصلة + 3 خانات مللي ثانية)
export function fmtSrtTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 1000);
  const p = (n: number, l = 2) => n.toString().padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

// صيغة VTT: HH:MM:SS.mmm (نقطة + 3 خانات مللي ثانية)
export function fmtVttTime(t: number): string {
  return fmtSrtTime(t).replace(",", ".");
}

export interface State {
  project: ProjectState;
  videoUrl: string | null;
  videoFile: File | null;
  videoMeta: { width: number; height: number; duration: number; size: number; name: string } | null;
  activeTab: TabId;
  jobs: AIJob[];
  notifications: AppNotification[];
  playhead: number;
  isPlaying: boolean;
  zoom: number;
  selectedClipId: string | null;
  /** تحديد متعدد (Shift/Ctrl) — selectedClipId هو آخر عنصر محدَّد (الأساسي). */
  selectedClipIds: string[];
  selectedAudioId: string | null;
  /** الالتصاق بحدود المقاطع/المؤشر أثناء السحب. */
  snapEnabled: boolean;
  selectedSubtitleId: string | null;
  showLeftPanel: boolean;
  showRightPanel: boolean;
  aiMood: string;
  bRollCount: number;
  shortsCount: number;
  /** سجل التراجع: لقطات المشروع السابقة (الأحدث آخراً). */
  past: ProjectState[];
  /** سجل الإعادة. */
  future: ProjectState[];
  /** وقت آخر لقطة سجل — لدمج دفعات الإجراءات المتتالية (مثل أدوات الذكاء) في خطوة واحدة. */
  lastHistoryAt: number;
}

export type Action =
  | { type: "SET_PROJECT"; project: ProjectState }
  | { type: "SET_VIDEO"; file: File; url: string; meta: State["videoMeta"] }
  | { type: "CLEAR_VIDEO" }
  | { type: "SET_TAB"; tab: TabId }
  | { type: "ADD_JOB"; job: AIJob }
  | { type: "UPDATE_JOB"; id: string; patch: Partial<AIJob> }
  | { type: "ADD_NOTIFICATION"; n: AppNotification }
  | { type: "REMOVE_NOTIFICATION"; id: string }
  | { type: "SET_PLAYHEAD"; t: number }
  | { type: "TOGGLE_PLAY" }
  | { type: "SET_ZOOM"; z: number }
  | { type: "SELECT_CLIP"; id: string | null }
  | { type: "SELECT_CLIPS"; ids: string[] }
  | { type: "SELECT_AUDIO"; id: string | null }
  | { type: "TOGGLE_SNAP" }
  | { type: "SELECT_SUBTITLE"; id: string | null }
  | { type: "TOGGLE_LEFT" }
  | { type: "TOGGLE_RIGHT" }
  | { type: "SET_MOOD"; mood: string }
  | { type: "SET_BROLL"; n: number }
  | { type: "SET_SHORTS"; n: number }
  | { type: "PATCH_PROJECT"; patch: Partial<ProjectState> }
  | { type: "ADD_CLIP"; clip: VideoClip }
  | { type: "ADD_AUDIO"; clip: AudioClip }
  | { type: "ADD_SUBTITLES"; cues: SubtitleCue[] }
  | { type: "UPDATE_SUBTITLE"; id: string; patch: Partial<SubtitleCue> }
  | { type: "REMOVE_SUBTITLE"; id: string }
  | { type: "UPDATE_CLIP"; id: string; patch: Partial<VideoClip> }
  | { type: "REMOVE_CLIP"; id: string }
  | { type: "REMOVE_AUDIO"; id: string }
  | { type: "ADD_TRACK"; track: TimelineTrack }
  | { type: "UPDATE_TRACK"; id: string; patch: Partial<TimelineTrack> }
  | { type: "REMOVE_TRACK"; id: string }
  | { type: "TOGGLE_EFFECT"; effectId: string }
  | { type: "SET_MUSIC"; id: string | undefined }
  | { type: "SET_THUMBNAIL"; dataUrl: string }
  | { type: "SET_TITLE_META"; title: string; description: string; tags: string[] }
  | { type: "SET_ASPECT"; aspect: ProjectAspect }
  | { type: "REPLACE_PROJECT"; project: ProjectState }
  | { type: "ADD_TEXT_OVERLAY"; overlay: TextOverlay }
  | { type: "UPDATE_TEXT_OVERLAY"; id: string; patch: Partial<TextOverlay> }
  | { type: "REMOVE_TEXT_OVERLAY"; id: string }
  /** تعديل محسوب مسبقاً بعمليات المحرّك المشتركة (lib/engine/timeline.ts) — يدخل السجل. */
  | { type: "COMMIT_PROJECT"; project: ProjectState }
  | { type: "UNDO" }
  | { type: "REDO" };

/** حد السجل في الذاكرة. */
export const HISTORY_LIMIT = 100;
/** إجراءات متتالية خلال هذه المدة تُدمج في خطوة تراجع واحدة. */
export const HISTORY_COALESCE_MS = 400;

/** الإجراءات التي تعدّل المشروع فعلياً (تُسجَّل للتراجع). التحميل/الاستبدال يصفّر السجل. */
const TRACKED_ACTIONS = new Set<Action["type"]>([
  "PATCH_PROJECT", "ADD_CLIP", "ADD_AUDIO", "ADD_SUBTITLES", "UPDATE_SUBTITLE", "REMOVE_SUBTITLE",
  "UPDATE_CLIP", "REMOVE_CLIP", "REMOVE_AUDIO", "ADD_TRACK", "UPDATE_TRACK", "REMOVE_TRACK",
  "TOGGLE_EFFECT", "SET_MUSIC", "SET_TITLE_META", "SET_ASPECT", "ADD_TEXT_OVERLAY",
  "UPDATE_TEXT_OVERLAY", "REMOVE_TEXT_OVERLAY", "COMMIT_PROJECT",
]);

export function reducer(state: State, action: Action): State {
  if (action.type === "UNDO") {
    const prev = state.past[state.past.length - 1];
    if (!prev) return state;
    return {
      ...state,
      project: prev,
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
      lastHistoryAt: 0,
    };
  }
  if (action.type === "REDO") {
    const next = state.future[0];
    if (!next) return state;
    return {
      ...state,
      project: next,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      lastHistoryAt: 0,
    };
  }
  const next = baseReducer(state, action);
  if (action.type === "REPLACE_PROJECT" || action.type === "SET_PROJECT") {
    return { ...next, past: [], future: [], lastHistoryAt: 0 };
  }
  if (TRACKED_ACTIONS.has(action.type) && next.project !== state.project) {
    const now = Date.now();
    const coalesce = now - state.lastHistoryAt < HISTORY_COALESCE_MS;
    return {
      ...next,
      past: coalesce ? state.past : [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: [],
      lastHistoryAt: now,
    };
  }
  return next;
}

function baseReducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_PROJECT":
      return { ...state, project: action.project };
    case "SET_VIDEO":
      return { ...state, videoFile: action.file, videoUrl: action.url, videoMeta: action.meta };
    case "CLEAR_VIDEO":
      return { ...state, videoFile: null, videoUrl: null, videoMeta: null };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "ADD_JOB":
      return { ...state, jobs: [action.job, ...state.jobs].slice(0, 20) };
    case "UPDATE_JOB":
      return {
        ...state,
        jobs: state.jobs.map((j) => (j.id === action.id ? { ...j, ...action.patch } : j)),
      };
    case "ADD_NOTIFICATION":
      return { ...state, notifications: [action.n, ...state.notifications].slice(0, 5) };
    case "REMOVE_NOTIFICATION":
      return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };
    case "SET_PLAYHEAD":
      return { ...state, playhead: action.t };
    case "TOGGLE_PLAY":
      return { ...state, isPlaying: !state.isPlaying };
    case "SET_ZOOM":
      return { ...state, zoom: action.z };
    case "SELECT_CLIP":
      return { ...state, selectedClipId: action.id, selectedClipIds: action.id ? [action.id] : [], selectedAudioId: action.id ? null : state.selectedAudioId };
    case "SELECT_CLIPS":
      return { ...state, selectedClipIds: action.ids, selectedClipId: action.ids.length ? action.ids[action.ids.length - 1] : null, selectedAudioId: null };
    case "SELECT_AUDIO":
      return { ...state, selectedAudioId: action.id, selectedClipId: action.id ? null : state.selectedClipId, selectedClipIds: action.id ? [] : state.selectedClipIds };
    case "TOGGLE_SNAP":
      return { ...state, snapEnabled: !state.snapEnabled };
    case "SELECT_SUBTITLE":
      return { ...state, selectedSubtitleId: action.id };
    case "TOGGLE_LEFT":
      return { ...state, showLeftPanel: !state.showLeftPanel };
    case "TOGGLE_RIGHT":
      return { ...state, showRightPanel: !state.showRightPanel };
    case "SET_MOOD":
      return { ...state, aiMood: action.mood };
    case "SET_BROLL":
      return { ...state, bRollCount: action.n };
    case "SET_SHORTS":
      return { ...state, shortsCount: action.n };
    case "PATCH_PROJECT":
      return { ...state, project: { ...state.project, ...action.patch, updatedAt: Date.now() } };
    case "ADD_CLIP":
      return { ...state, project: { ...state.project, clips: [...state.project.clips, action.clip] } };
    case "ADD_AUDIO":
      return { ...state, project: { ...state.project, audioClips: [...state.project.audioClips, action.clip] } };
    case "ADD_SUBTITLES":
      return {
        ...state,
        project: {
          ...state.project,
          subtitles: [...state.project.subtitles, ...action.cues],
        },
      };
    case "UPDATE_SUBTITLE":
      return {
        ...state,
        project: {
          ...state.project,
          subtitles: state.project.subtitles.map((s) =>
            s.id === action.id ? { ...s, ...action.patch } : s
          ),
        },
      };
    case "REMOVE_SUBTITLE":
      return {
        ...state,
        project: {
          ...state.project,
          subtitles: state.project.subtitles.filter((s) => s.id !== action.id),
        },
      };
    case "UPDATE_CLIP":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.id === action.id ? { ...c, ...action.patch } : c
          ),
        },
      };
    case "REMOVE_CLIP":
      return {
        ...state,
        project: { ...state.project, clips: state.project.clips.filter((c) => c.id !== action.id) },
      };
    case "REMOVE_AUDIO":
      return {
        ...state,
        project: {
          ...state.project,
          audioClips: state.project.audioClips.filter((c) => c.id !== action.id),
        },
      };
    case "ADD_TRACK":
      return { ...state, project: { ...state.project, tracks: [...state.project.tracks, action.track] } };
    case "UPDATE_TRACK":
      return {
        ...state,
        project: {
          ...state.project,
          tracks: state.project.tracks.map((t) =>
            t.id === action.id ? { ...t, ...action.patch } : t
          ),
        },
      };
    case "REMOVE_TRACK":
      return {
        ...state,
        project: { ...state.project, tracks: state.project.tracks.filter((t) => t.id !== action.id) },
      };
    case "TOGGLE_EFFECT": {
      const exists = state.project.effects.includes(action.effectId);
      return {
        ...state,
        project: {
          ...state.project,
          effects: exists
            ? state.project.effects.filter((e) => e !== action.effectId)
            : [...state.project.effects, action.effectId],
        },
      };
    }
    case "SET_MUSIC":
      return { ...state, project: { ...state.project, musicId: action.id } };
    case "SET_THUMBNAIL":
      return { ...state, project: { ...state.project, thumbnail: action.dataUrl } };
    case "SET_TITLE_META":
      return {
        ...state,
        project: {
          ...state.project,
          title: action.title,
          description: action.description,
          tags: action.tags,
        },
      };
    case "SET_ASPECT":
      return { ...state, project: { ...state.project, aspect: action.aspect } };
    case "REPLACE_PROJECT":
      return { ...state, project: action.project };
    case "COMMIT_PROJECT":
      return { ...state, project: { ...action.project, updatedAt: Date.now() } };
    case "ADD_TEXT_OVERLAY":
      return {
        ...state,
        project: { ...state.project, textOverlays: [...state.project.textOverlays, action.overlay] },
      };
    case "UPDATE_TEXT_OVERLAY":
      return {
        ...state,
        project: {
          ...state.project,
          textOverlays: state.project.textOverlays.map((t) =>
            t.id === action.id ? { ...t, ...action.patch } : t
          ),
        },
      };
    case "REMOVE_TEXT_OVERLAY":
      return {
        ...state,
        project: {
          ...state.project,
          textOverlays: state.project.textOverlays.filter((t) => t.id !== action.id),
        },
      };
    default:
      return state;
  }
}

export const initialState: State = {
  project: defaultProject("مشروع بدون عنوان"),
  videoUrl: null,
  videoFile: null,
  videoMeta: null,
  activeTab: "ai",
  jobs: [],
  notifications: [],
  playhead: 0,
  isPlaying: false,
  zoom: 60,
  selectedClipId: null,
  selectedClipIds: [],
  selectedAudioId: null,
  snapEnabled: true,
  selectedSubtitleId: null,
  showLeftPanel: true,
  showRightPanel: true,
  aiMood: "ملهم",
  bRollCount: 3,
  shortsCount: 3,
  past: [],
  future: [],
  lastHistoryAt: 0,
};
