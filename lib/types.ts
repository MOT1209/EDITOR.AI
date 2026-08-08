export type ProjectAspect = "16:9" | "9:16" | "1:1" | "4:5";

export type VideoFormat = "mp4" | "mov" | "webm" | "mkv";

export interface MediaAsset {
  id: string;
  type: "video" | "audio" | "image" | "music" | "sfx";
  name: string;
  url: string;
  duration: number;
  thumbnail?: string;
  meta?: Record<string, string | number>;
}

export interface VideoClip {
  id: string;
  assetId: string;
  trackId: string;
  start: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  effects: string[];
  volume: number;
  speed: number;
  zoom: number;
  panX: number;
  panY: number;
  smartZoom: boolean;
  colorFilter?: string;
  /** "video" (default) trims/plays the uploaded source; "image" overlays a still from imageUrl. */
  kind?: "video" | "image";
  /** Server-local path (under .montage_ai/assets) — only set when kind === "image". */
  imageUrl?: string;
}

export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  position: "top" | "center" | "bottom";
  fontFamily: string;
  fontSize: number;
  color: string;
  animation: "none" | "fade" | "pop";
}

export interface AudioClip {
  id: string;
  name: string;
  trackId: string;
  start: number;
  duration: number;
  url: string;
  volume: number;
  kind: "music" | "voiceover" | "dub" | "sfx";
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  lang: string;
  style?: "default" | "bold" | "highlight" | "karaoke";
}

export interface TimelineTrack {
  id: string;
  kind: "video" | "audio" | "subtitle" | "fx";
  label: string;
  height: number;
  muted: boolean;
  locked: boolean;
}

export interface Effect {
  id: string;
  name: string;
  category: "transition" | "color" | "motion" | "vfx" | "audio";
  preview: string;
  intensity: number;
  css?: string;
}

export interface MusicTrack {
  id: string;
  title: string;
  genre: string;
  mood: string;
  duration: number;
  bpm: number;
  url: string;
  cover: string;
}

export interface ProjectState {
  id: string;
  name: string;
  aspect: ProjectAspect;
  format: VideoFormat;
  resolution: "720p" | "1080p" | "4k";
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high" | "ultra";
  duration: number;
  tracks: TimelineTrack[];
  clips: VideoClip[];
  audioClips: AudioClip[];
  subtitles: SubtitleCue[];
  textOverlays: TextOverlay[];
  effects: string[];
  musicId?: string;
  videoUrl?: string;
  thumbnail?: string;
  title?: string;
  description?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export type AIJobStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface AIJob {
  id: string;
  kind: string;
  label: string;
  status: AIJobStatus;
  progress: number;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  result?: unknown;
}

export interface AppNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  timestamp: number;
}
