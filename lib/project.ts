import { v4 as uuid } from "uuid";
import type { ProjectState } from "./types";

const STORAGE_KEY = "montage_ai_projects_v1";
const ACTIVE_KEY = "montage_ai_active_v1";

export function defaultProject(name = "مشروع جديد"): ProjectState {
  const now = Date.now();
  return {
    id: uuid(),
    name,
    aspect: "16:9",
    format: "mp4",
    resolution: "1080p",
    fps: 30,
    quality: "high",
    duration: 0,
    tracks: [
      { id: "t_video", kind: "video", label: "فيديو", height: 64, muted: false, locked: false },
      { id: "t_text", kind: "subtitle", label: "ترجمة", height: 36, muted: false, locked: false },
      { id: "t_audio", kind: "audio", label: "صوت وموسيقى", height: 48, muted: false, locked: false },
    ],
    clips: [],
    audioClips: [],
    subtitles: [],
    textOverlays: [],
    effects: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadProjects(): ProjectState[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ProjectState[];
  } catch {
    return [];
  }
}

export function saveProjects(projects: ProjectState[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error("فشل حفظ المشاريع", e);
  }
}

export function upsertProject(p: ProjectState) {
  const all = loadProjects();
  const idx = all.findIndex((x) => x.id === p.id);
  const updated = { ...p, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = updated;
  else all.unshift(updated);
  saveProjects(all);
  setActiveProjectId(p.id);
  return updated;
}

export function deleteProject(id: string) {
  const all = loadProjects().filter((p) => p.id !== id);
  saveProjects(all);
  if (getActiveProjectId() === id) setActiveProjectId(null);
}

export function getActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function formatTime(seconds: number, withMs = false): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 100);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return withMs
    ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms)}`
    : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}
