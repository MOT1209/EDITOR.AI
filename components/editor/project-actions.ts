// تنزيل/استيراد الملفات وإدارة المشاريع (محلية ومساحة عمل الخادم) — مستخرجة من Editor.tsx بنقل حرفي بلا تغيير سلوك.
// دوال عادية (ليست hooks) تُنشأ في كل render وتغلق على أحدث state عبر ctx، تماماً كما كانت داخل المكوّن.
import { type ServerProjectSummary } from "./project-modals";
import { defaultProject, loadProjects, upsertProject, deleteProject } from "@/lib/project";
import { apiFetch } from "@/lib/api-config";
import { parseProject } from "@/lib/engine/project-schema";
import type { ProjectState } from "@/lib/types";
import { fmtSrtTime, fmtVttTime } from "./state";
import type { NotifyFn, Setter } from "./ctx-types";
import type { State, Action } from "./state";

export interface ProjectActionsContext {
  state: State;
  dispatch: React.Dispatch<Action>;
  notify: NotifyFn;
  audio: { url: string; name: string } | null;
  playClipRef: React.MutableRefObject<number>;
  seekTimeline: (t: number) => void;
  serverProjectId: string | null;
  setSavedProjects: Setter<ProjectState[]>;
  setServerProjectId: Setter<string | null>;
  setServerProjects: Setter<ServerProjectSummary[] | null>;
  setServerSourceRef: Setter<string | null>;
  setShowProjects: Setter<boolean>;
}

export function createProjectActions(ctx: ProjectActionsContext) {
  const {
    state,
    dispatch,
    notify,
    audio,
    playClipRef,
    seekTimeline,
    serverProjectId,
    setSavedProjects,
    setServerProjectId,
    setServerProjects,
    setServerSourceRef,
    setShowProjects,
  } = ctx;

  const downloadJSON = (data: unknown, name: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadFile = (content: string, name: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSRT = () => {
    const cues = state.project.subtitles;
    const srt = cues
      .map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n`)
      .join("\n");
    downloadFile(srt, `${state.project.name}.srt`, "text/plain");
  };

  const exportVTT = () => {
    const cues = state.project.subtitles;
    const vtt = "WEBVTT\n\n" + cues
      .map((c) => `${fmtVttTime(c.start)} --> ${fmtVttTime(c.end)}\n${c.text}\n`)
      .join("\n");
    downloadFile(vtt, `${state.project.name}.vtt`, "text/vtt");
  };

  const exportProject = () => {
    const project = {
      ...state.project,
      videoMeta: state.videoMeta,
      audio,
      timestamp: Date.now(),
    };
    downloadJSON(project, `${state.project.name}.montageai.json`);
    notify("success", "تم حفظ ملف المشروع محلياً");
  };

  const importProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        // تحقق المخطط + ترقية النسخ القديمة؛ الحقول الزائدة (videoMeta/audio) تُتجاهل.
        const r = parseProject({ ...defaultProject(), ...raw });
        if (!r.ok) {
          notify("error", "ملف مشروع غير صالح", r.errors.slice(0, 2).join("؛ "));
          return;
        }
        dispatch({ type: "REPLACE_PROJECT", project: r.project });
        notify("success", "تم استيراد المشروع", "أعد رفع الفيديو المصدر لربطه (الملف لا يُحفظ داخل JSON).");
      } catch {
        notify("error", "ملف غير صالح", "تعذّرت قراءة JSON");
      }
    };
    reader.readAsText(f);
  };

  const refreshServerProjects = async () => {
    setServerProjects(null);
    const r = await apiFetch("/api/projects").then((x) => x.json()).catch(() => null);
    setServerProjects(Array.isArray(r?.projects) ? r.projects : []);
  };

  const openServerProject = async (id: string) => {
    setShowProjects(false);
    try {
      const r = await apiFetch(`/api/projects/${encodeURIComponent(id)}`).then((x) => x.json());
      if (!r?.project) throw new Error(r?.error || "تعذّر تحميل المشروع");
      const parsed = parseProject(r.project);
      if (!parsed.ok) throw new Error(parsed.errors.join("؛ "));
      dispatch({ type: "REPLACE_PROJECT", project: parsed.project });
      dispatch({ type: "CLEAR_VIDEO" });
      playClipRef.current = -1;
      setServerProjectId(parsed.project.id);
      setServerSourceRef(r.media?.sourceRef ?? null);
      if (!r.media) {
        notify("info", "فُتح المشروع", "لا فيديو في هذا المشروع بعد");
        return;
      }
      notify("info", "جارِ تحميل الفيديو من مساحة العمل…", r.media.name);
      const blob = await fetch(r.media.url).then((x) => {
        if (!x.ok) throw new Error("تعذّر تحميل الوسيط");
        return x.blob();
      });
      const file = new File([blob], r.media.name, { type: blob.type || "video/mp4" });
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        dispatch({
          type: "SET_VIDEO",
          file,
          url,
          meta: { width: v.videoWidth, height: v.videoHeight, duration: v.duration, size: file.size, name: file.name },
        });
        seekTimeline(0);
        notify("success", "فُتح مشروع مساحة العمل", parsed.project.name);
      };
      v.onerror = () => notify("error", "تعذّر تشغيل الوسيط في المتصفح");
      v.src = url;
    } catch (e) {
      notify("error", "تعذّر فتح المشروع", e instanceof Error ? e.message : undefined);
    }
  };

  const saveProjectToList = () => {
    if (serverProjectId && serverProjectId === state.project.id) {
      void apiFetch(`/api/projects/${encodeURIComponent(serverProjectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: state.project }),
      })
        .then((x) => x.json().then((d) => ({ ok: x.ok, d })))
        .then(({ ok, d }) =>
          ok
            ? notify("success", "حُفظ في مساحة العمل", "قابل للتراجع عبر MCP (undo_edit)")
            : notify("error", "فشل الحفظ في مساحة العمل", d?.error)
        )
        .catch(() => notify("error", "فشل الحفظ في مساحة العمل"));
    }
    const { project: updated, result } = upsertProject({ ...state.project, thumbnail: state.project.thumbnail });
    setSavedProjects(loadProjects());
    if (!result.ok) {
      notify("error", "فشل الحفظ", result.error);
      return;
    }
    notify("success", "تم الحفظ في المتصفح", `${updated.name} — بيانات المشروع فقط؛ الفيديو يبقى ملفاً على جهازك ويُعاد ربطه عند الفتح.`);
  };

  const loadProject = (p: ProjectState) => {
    dispatch({ type: "REPLACE_PROJECT", project: p });
    dispatch({ type: "CLEAR_VIDEO" });
    setServerSourceRef(null);
    playClipRef.current = -1;
    setShowProjects(false);
    notify("info", "تم تحميل المشروع", `${p.name} — ارفع الفيديو المصدر (نفس الملف) لإعادة ربطه.`);
  };

  const removeProject = (id: string) => {
    const r = deleteProject(id);
    if (!r.ok) notify("error", "تعذّر الحذف", r.error);
    setSavedProjects(loadProjects());
  };

  return {
    exportSRT,
    exportVTT,
    exportProject,
    importProject,
    refreshServerProjects,
    openServerProject,
    saveProjectToList,
    loadProject,
    removeProject,
  };
}
