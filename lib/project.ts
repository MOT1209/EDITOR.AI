import { v4 as uuid } from "uuid";
import type { ProjectState } from "./types";
import { parseProject, PROJECT_SCHEMA_VERSION } from "./engine/project-schema";

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
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * يحمّل المشاريع المحفوظة في localStorage مع تحقق المخطط وترقية النسخ القديمة.
 * المشاريع التالفة تُستبعد (ويُبلَّغ عددها عبر loadProjectsReport).
 * ⚠️ المخزَّن هنا بيانات المشروع فقط — ملفات الفيديو نفسها لا تُحفظ في المتصفح.
 */
export function loadProjectsReport(): { projects: ProjectState[]; invalid: number } {
  if (typeof window === "undefined") return { projects: [], invalid: 0 };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { projects: [], invalid: 0 };
  }
  if (!raw) return { projects: [], invalid: 0 };
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return { projects: [], invalid: 1 };
  }
  if (!Array.isArray(list)) return { projects: [], invalid: 1 };
  const projects: ProjectState[] = [];
  let invalid = 0;
  for (const item of list) {
    const r = parseProject(item);
    if (r.ok) projects.push(r.project);
    else invalid++;
  }
  return { projects, invalid };
}

export function loadProjects(): ProjectState[] {
  return loadProjectsReport().projects;
}

/** أقصى حجم لصورة مصغّرة تُحفظ مع المشروع (data URL) — أكبر منها يُسقط لتوفير الحصة. */
const MAX_THUMBNAIL_CHARS = 150_000;

export type SaveResult = { ok: true; bytes: number } | { ok: false; error: string; quota: boolean };

export function saveProjects(projects: ProjectState[]): SaveResult {
  if (typeof window === "undefined") return { ok: false, error: "لا متصفح", quota: false };
  const slim = projects.map((p) =>
    p.thumbnail && p.thumbnail.length > MAX_THUMBNAIL_CHARS ? { ...p, thumbnail: undefined } : p
  );
  const json = JSON.stringify(slim);
  try {
    localStorage.setItem(STORAGE_KEY, json);
    return { ok: true, bytes: json.length * 2 };
  } catch (e) {
    const quota =
      e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
    return {
      ok: false,
      quota,
      error: quota
        ? "امتلأت مساحة تخزين المتصفح — احذف مشاريع قديمة أو صدّر المشروع كملف JSON"
        : "تعذّر الحفظ في تخزين المتصفح",
    };
  }
}

export function upsertProject(p: ProjectState): { project: ProjectState; result: SaveResult } {
  const all = loadProjects();
  const idx = all.findIndex((x) => x.id === p.id);
  const updated = { ...p, schemaVersion: PROJECT_SCHEMA_VERSION, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = updated;
  else all.unshift(updated);
  const result = saveProjects(all);
  if (result.ok) setActiveProjectId(p.id);
  return { project: updated, result };
}

export function deleteProject(id: string): SaveResult {
  const all = loadProjects().filter((p) => p.id !== id);
  const r = saveProjects(all);
  if (getActiveProjectId() === id) setActiveProjectId(null);
  return r;
}

export function getActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* التخزين غير متاح (وضع خاص/حصة) — غير حرج */
  }
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
