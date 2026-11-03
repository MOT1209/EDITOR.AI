"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { ApiSettingsModal, ShortcutsModal } from "./modals";
import { ProjectsModal, ExportModal, ExportResultModal, type ServerProjectSummary } from "./project-modals";
import { Upload, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  defaultProject,
  loadProjects,
  loadProjectsReport,
  upsertProject,
  deleteProject,
  formatTime,
  formatBytes,
} from "@/lib/project";
import { findLostAudio } from "@/lib/engine/export-guard";
import { activeVideoClip, clipFraming, framingCss } from "@/lib/engine/framing";
import { ensureAudioRefs } from "@/lib/client/audio-upload";
import { aiJobs } from "@/lib/mockAi";
import { apiFetch, SIMULATED_EVENT } from "@/lib/api-config";
import { uploadFileRaw } from "@/lib/client/upload";
import { parseProject } from "@/lib/engine/project-schema";
import {
  clipSourceEnd,
  deleteClip as deleteClipOp,
  exportClips,
  duplicateClip,
  newId,
  previewClips,
  snapPoints,
  sourceToTimelineAt,
  splitClip,
  timelineDuration,
  timelineToSource,
} from "@/lib/engine/timeline";
import type { AppNotification, ProjectState } from "@/lib/types";
import { COLOR_FILTERS, FONT_OPTIONS, fmtSrtTime, fmtVttTime, reducer, initialState } from "./state";
import { SubtitleOverlay, EffectOverlay, Notifications, PipelineModal } from "./overlays";
import { Timeline, Transport } from "./timeline";
import { LeftPanel } from "./panels/left-panel";
import { RightPanel } from "./panels/right-panel";
import { Header } from "./panels/header";
import { createAiActions } from "./ai-actions";

export default function Editor() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [audio, setAudio] = useState<{ url: string; name: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [renderedPreview, setRenderedPreview] = useState<{ url: string; start: number; end: number } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [savedProjects, setSavedProjects] = useState<ProjectState[]>([]);
  const [exportResult, setExportResult] = useState<{ name: string; size: number; jobId?: string } | null>(null);
  const [serverSourceRef, setServerSourceRef] = useState<string | null>(null);
  // مشروع مفتوح من مساحة عمل الخادم (MCP) — الحفظ يكتب إليه أيضاً.
  const [serverProjectId, setServerProjectId] = useState<string | null>(null);
  const [serverProjects, setServerProjects] = useState<ServerProjectSummary[] | null>(null);
  // معرّف مهمة التصدير الجارية (للإلغاء الحقيقي من الخادم).
  const exportJobRef = useRef<string | null>(null);
  const exportCancelledRef = useRef(false);
  // فهرس المقطع الذي يشغّله المشغّل الآن (لتتبع خطة التايملاين أثناء التشغيل).
  const playClipRef = useRef(-1);
  const [subtitleText, setSubtitleText] = useState("");
  const [voiceoverText, setVoiceoverText] = useState("");
  const [translateTarget, setTranslateTarget] = useState("en");
  const [ttsVoice, setTtsVoice] = useState("ar-male-1");
  const [videoStabilize, setVideoStabilize] = useState(false);
  const [colorGrading, setColorGrading] = useState(0.5);
  const [audioDenoise, setAudioDenoise] = useState(0.5);
  const [audioEnhance, setAudioEnhance] = useState(0.5);
  const [fontSize, setFontSize] = useState(28);
  const [fontColor, setFontColor] = useState("#ffffff");
  const [fontBg, setFontBg] = useState("#000000");
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].id);
  const [subLang, setSubLang] = useState("ar");
  const [bpmInput, setBpmInput] = useState(120);
  // طلب المستخدم لوكيلة المديرة التنفيذية (المساعد الذكي)
  const [agentRequest, setAgentRequest] = useState("");
  // المسار الكامل متعدد الوكلاء: نتيجة التخطيط + نتيجة الرندر
  const [pipelinePlan, setPipelinePlan] = useState<Record<string, unknown> | null>(null);
  const [pipelineRender, setPipelineRender] = useState<Record<string, unknown> | null>(null);
  const [showPipelineModal, setShowPipelineModal] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiActionsRef = useRef<Record<string, () => void | Promise<void>>>({});

  const totalDuration = useMemo(() => {
    if (state.videoMeta?.duration) return state.videoMeta.duration;
    return state.project.duration || 30;
  }, [state.videoMeta, state.project.duration]);

  // الشاشات الصغيرة: اللوحتان مخفيتان افتراضياً (أدراج فوق المحتوى) — تُفتحان من شريط الأزرار.
  const collapsedOnce = useRef(false);
  useEffect(() => {
    if (collapsedOnce.current) return; // StrictMode يشغّل التأثير مرتين — التبديل مرة واحدة فقط
    collapsedOnce.current = true;
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      dispatch({ type: "TOGGLE_LEFT" });
      dispatch({ type: "TOGGLE_RIGHT" });
    }
  }, []);

  const notify = useCallback(
    (type: AppNotification["type"], title: string, message?: string) => {
      const id = uuid();
      dispatch({
        type: "ADD_NOTIFICATION",
        n: { id, type, title, message, timestamp: Date.now() },
      });
      setTimeout(() => dispatch({ type: "REMOVE_NOTIFICATION", id }), 4500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    };
  }, [state.videoUrl]);

  useEffect(() => {
    if (state.isPlaying) {
      if (videoRef.current) videoRef.current.play().catch(() => {});
    } else {
      videoRef.current?.pause();
    }
  }, [state.isPlaying]);

  // المعاينة تتبع خطة التصدير: المشغّل يقفز فوق المقاطع المحذوفة، ويطبّق سرعة
  // وصوت كل مقطع، والمؤشر يعرض زمن التايملاين (لا زمن المصدر).
  const projectRef = useRef(state.project);
  projectRef.current = state.project;

  const seekTimeline = useCallback((t: number) => {
    const v = videoRef.current;
    const pos = timelineToSource(projectRef.current, t);
    if (v && pos) {
      playClipRef.current = pos.index;
      v.currentTime = pos.sourceTime;
      v.playbackRate = pos.clip?.speed || 1;
      v.volume = Math.min(1, pos.clip?.volume ?? 1);
    }
    dispatch({ type: "SET_PLAYHEAD", t: Math.max(0, t) });
  }, []);

  const handleVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const p = projectRef.current;
    const clips = previewClips(p);
    if (clips.length === 0) {
      dispatch({ type: "SET_PLAYHEAD", t: v.currentTime });
      if (v.currentTime >= v.duration) dispatch({ type: "TOGGLE_PLAY" });
      return;
    }
    let idx = playClipRef.current;
    if (idx < 0 || idx >= clips.length) {
      idx = Math.max(0, clips.findIndex((c) => v.currentTime >= c.inPoint && v.currentTime < clipSourceEnd(c)));
      playClipRef.current = idx;
    }
    const clip = clips[idx];
    if (v.currentTime >= clipSourceEnd(clip) - 0.04) {
      const next = clips[idx + 1];
      if (!next) {
        dispatch({ type: "SET_PLAYHEAD", t: timelineDuration(p) });
        if (!v.paused) dispatch({ type: "TOGGLE_PLAY" });
        return;
      }
      playClipRef.current = idx + 1;
      v.currentTime = next.inPoint;
      v.playbackRate = next.speed || 1;
      v.volume = Math.min(1, next.volume ?? 1);
      return;
    }
    dispatch({ type: "SET_PLAYHEAD", t: sourceToTimelineAt(p, idx, v.currentTime) });
  }, []);

  const handlePlayheadChange = useCallback((t: number) => seekTimeline(t), [seekTimeline]);
  const seekRef = useRef(seekTimeline);
  seekRef.current = seekTimeline;

  const onUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        size: file.size,
        name: file.name,
      };
      dispatch({ type: "SET_VIDEO", file, url, meta });
      dispatch({ type: "SET_PLAYHEAD", t: 0 });
      playClipRef.current = -1;
      setServerSourceRef(null);
      // إعادة ربط الوسائط: مشروع محفوظ مفتوح بلا فيديو + ملف بنفس المدة ⇒ نبقي التعديلات.
      const p = projectRef.current;
      const hasEdits = p.clips.length > 0 || p.subtitles.length > 0 || p.textOverlays.length > 0;
      const sameSource = p.duration > 0 && Math.abs(p.duration - video.duration) < 0.5;
      if (hasEdits && sameSource && !state.videoMeta) {
        notify("success", "أُعيد ربط الفيديو بالمشروع", `${file.name} • التعديلات محفوظة`);
        return;
      }
      if (hasEdits && !window.confirm("رفع فيديو جديد سيبدأ مشروعاً جديداً ويستبدل التايملاين الحالي. متابعة؟")) {
        return;
      }
      dispatch({
        type: "REPLACE_PROJECT",
        project: {
          ...defaultProject(file.name.replace(/\.[^.]+$/, "")),
          duration: video.duration,
        },
      });
      notify("success", "تم رفع الفيديو بنجاح", `${file.name} • ${formatBytes(file.size)}`);
    };
    video.onerror = () => {
      notify("error", "تعذر قراءة الفيديو", "تأكد من أن الملف بصيغة مدعومة.");
    };
    video.src = url;
  }, [notify, state.videoMeta]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onUpload(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("video/")) onUpload(f);
  };

  const runAIJob = useCallback(
    async (
      kind: string,
      label: string,
      run: (update: (p: number, msg?: string) => void) => Promise<unknown>
    ) => {
      const job = aiJobs.create(kind, label);
      dispatch({ type: "ADD_JOB", job });
      const update = (p: number, msg?: string) => {
        aiJobs.update(job.id, { progress: p, message: msg });
        dispatch({ type: "UPDATE_JOB", id: job.id, patch: { progress: p, message: msg } });
      };
      try {
        const result = await run(update);
        aiJobs.complete(job.id, result);
        dispatch({ type: "UPDATE_JOB", id: job.id, patch: { status: "completed", progress: 100 } });
        notify("success", "اكتملت العملية", label);
        return result;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "خطأ غير معروف";
        aiJobs.fail(job.id, message);
        dispatch({ type: "UPDATE_JOB", id: job.id, patch: { status: "failed", message } });
        notify("error", "فشلت العملية", message);
        return null;
      }
    },
    [notify]
  );

  const {
    aiFullPipeline,
    aiPipelineRender,
    aiFullAuto,
    aiDirectorAgent,
    aiSilenceRemove,
    aiSubtitles,
    aiEnhanceAudio,
    aiColor,
    aiStabilize,
    aiBRoll,
    aiShorts,
    aiSceneDetect,
    aiFaceDetect,
    aiObjectDetect,
    aiHighlight,
    aiReframe,
    aiMusicSync,
    aiTranslate,
    aiDub,
    aiThumbnail,
    aiTitleDesc,
  } = createAiActions({
    state,
    dispatch,
    notify,
    totalDuration,
    runAIJob,
    voiceoverText,
    translateTarget,
    subLang,
    ttsVoice,
    fontColor,
    fontFamily,
    fontSize,
    agentRequest,
    audioEnhance,
    audioDenoise,
    bpmInput,
    serverSourceRef,
    setServerSourceRef,
    setPipelinePlan,
    setPipelineRender,
    setShowPipelineModal,
    setVideoStabilize,
    setAudio,
  });

  // نمط "latest ref": يُحدَّث في كل render (ليس فقط عند تغيّر التبعيات) —
  // يضمن أن مستمع حدث ai-trigger يجد دائماً أحدث نسخة من الدوال دون useEffect/تبعيات.
  aiActionsRef.current = {
    silence: aiSilenceRemove,
    subtitles: aiSubtitles,
    color: aiColor,
    stabilize: aiStabilize,
    broll: aiBRoll,
    shorts: aiShorts,
    translate: aiTranslate,
    dub: aiDub,
    thumb: aiThumbnail,
    title: aiTitleDesc,
    audio: aiEnhanceAudio,
    scenes: aiSceneDetect,
    faces: aiFaceDetect,
    objects: aiObjectDetect,
    highlight: aiHighlight,
    reframe: aiReframe,
    "music-sync": aiMusicSync,
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const fn = aiActionsRef.current[detail];
      if (fn) fn();
    };
    window.addEventListener("ai-trigger", handler);
    return () => window.removeEventListener("ai-trigger", handler);
  }, []);

  /** يبني مراجع المصادر المتعددة (assetId → مرجع معتم) من مكتبة الوسائط. */
  const buildSourceRefs = (): Record<string, string> => {
    const refs: Record<string, string> = {};
    for (const a of state.project.assets ?? []) if (typeof a.meta?.ref === "string") refs[a.id] = a.meta.ref;
    return refs;
  };

  /** تصدير كامل، أو معاينة مرندرة لنافذة قصيرة (نفس الخطة والمركِّب — المرجع الحاكم لمطابقة المعاينة). */
  const runServerRender = async (previewWindow?: { start: number; end: number }) => {
    const refs = buildSourceRefs();
    const hasLibrary = Object.keys(refs).length > 0;
    if ((!state.videoMeta || !state.videoFile) && !hasLibrary) return notify("warning", "ارفع فيديو أولاً");
    // لا انحراف صامت (T-01): ما تسمعه في المعاينة من موسيقى/تعليق المتصفح لا يصل للمخرَج إلا إن رُفع للخادم.
    // T-13: نرفع صوت التايملاين (blob/data) كأصول خادم أولاً ليُمزج فعلاً؛ ما يفشل رفعه يبقى «مفقوداً» ويتطلب إقراراً.
    const { project: exportProject } = await ensureAudioRefs(state.project);
    const withRef = new Set(exportProject.audioClips.filter((a) => a.ref).map((a) => a.id));
    const lostAudio = findLostAudio(exportProject, withRef);
    if (lostAudio.length > 0) {
      const ok = window.confirm(
        `بعض الصوت المضاف تعذّر رفعه ولن يدخل الملف المصدَّر (${lostAudio.slice(0, 3).join("، ")}${lostAudio.length > 3 ? "…" : ""}).\nالمخرَج سيحوي صوت الفيديو الأصلي فقط. هل تريد المتابعة؟`
      );
      if (!ok) return;
    }
    exportCancelledRef.current = false;
    exportJobRef.current = null;
    setIsExporting(true);
    setExportProgress(0);
    try {
      let sourcePath = serverSourceRef;
      if (!sourcePath && state.videoFile) {
        const uploadRes = await uploadFileRaw("/api/ffmpeg/probe", state.videoFile).then((r) => r.json());
        if (!uploadRes?.ref) throw new Error(uploadRes?.error || "فشل رفع الفيديو للمعالجة");
        sourcePath = uploadRes.ref as string;
        setServerSourceRef(sourcePath);
      }

      const startRes = await apiFetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sourcePath ? { sourceRef: sourcePath } : {}),
          sources: Object.entries(refs).map(([assetId, ref]) => ({ assetId, ref })),
          project: exportProject,
          videoStabilize,
          colorGrading,
          acknowledgeAudioLoss: lostAudio.length > 0,
          ...(previewWindow ? { preview: previewWindow } : {}),
        }),
      }).then((r) => r.json());
      if (!startRes?.job?.id) {
        const details = Array.isArray(startRes?.details) ? ` (${startRes.details.slice(0, 2).join("؛ ")})` : "";
        throw new Error((startRes?.error || "تعذّر بدء التصدير") + details);
      }
      const jobId = startRes.job.id as string;
      exportJobRef.current = jobId;

      // Poll the file-backed export status (not the in-memory /api/jobs list,
      // which Next.js dev mode can reset between route module reloads).
      let misses = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        if (exportCancelledRef.current) return;
        const job = await fetch(`/api/export/status/${jobId}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!job) {
          // حد أقصى للمحاولات بدل حلقة لا تنتهي إن اختفت حالة المهمة.
          if (++misses > 20) throw new Error("تعذّر متابعة حالة التصدير (الخادم لا يعرف المهمة)");
          continue;
        }
        misses = 0;
        if (job.status === "cancelled") {
          setIsExporting(false);
          notify("info", "أُلغي التصدير");
          return;
        }
        setExportProgress(job.progress || 0);
        if (job.status === "completed") {
          setIsExporting(false);
          if (previewWindow) {
            setRenderedPreview({ url: `/api/export/download/${jobId}?inline=1`, start: previewWindow.start, end: previewWindow.end });
            notify("success", "المعاينة المرندرة جاهزة", "هذا ما سيظهر في الملف المصدَّر (بدقة منخفضة)");
            return;
          }
          setExportResult({
            name: `${state.project.name || "video"}.${state.project.format}`,
            size: job.result?.size || 0,
            jobId,
          });
          notify("success", "تم التصدير بنجاح", "الفيديو جاهز للتنزيل.");
          return;
        }
        if (job.status === "failed") {
          setIsExporting(false);
          // مشاكل الخطة المهيكلة (مصدر مفقود/تداخل/صوت بلا ملف) تُعرض بدقة وقابلة للإصلاح.
          const issues = Array.isArray(job.issues) ? (job.issues as { severity: string; message: string }[]).filter((i) => i.severity === "error") : [];
          notify("error", "فشل التصدير", issues.length ? issues.slice(0, 3).map((i) => i.message).join(" • ") : job.message || "حدث خطأ أثناء المعالجة.");
          return;
        }
      }
    } catch (err: unknown) {
      setIsExporting(false);
      const msg = err instanceof Error ? err.message : "فشل التصدير";
      notify("error", "فشل التصدير", msg);
    }
  };

  const startExport = () => void runServerRender();
  const startRenderedPreview = () => {
    const total = timelineDuration(state.project) || state.project.duration || 10;
    const start = Math.min(Math.max(0, state.playhead), Math.max(0, total - 0.5));
    void runServerRender({ start, end: Math.min(total, start + 10) });
  };

  const cancelExport = async () => {
    exportCancelledRef.current = true;
    setIsExporting(false);
    const id = exportJobRef.current;
    if (!id) return;
    const res = await apiFetch(`/api/export?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    notify(res?.ok ? "info" : "warning", res?.ok ? "أُلغي التصدير" : "تعذّر إلغاء التصدير على الخادم");
  };

  // ---- تعديلات التايملاين عبر عمليات المحرّك المشتركة (نفسها المستخدمة في MCP)
  const ensureBaseClip = (p: ProjectState): ProjectState => {
    if (exportClips(p).length > 0) return p;
    const d = p.duration || totalDuration;
    return {
      ...p,
      clips: [
        ...p.clips,
        {
          id: newId("clip"), assetId: "main", trackId: "t_video", start: 0, duration: d, inPoint: 0, outPoint: d,
          effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
        },
      ],
    };
  };

  const splitAtPlayhead = () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    try {
      const p = ensureBaseClip(state.project);
      const t = state.playhead;
      const clips = exportClips(p);
      const selected = clips.find((c) => c.id === state.selectedClipId && t > c.start && t < c.start + c.duration);
      const target = selected ?? clips.find((c) => t > c.start && t < c.start + c.duration);
      if (!target) return notify("warning", "ضع المؤشر داخل مقطع للتقسيم");
      const r = splitClip(p, target.id, t);
      dispatch({ type: "COMMIT_PROJECT", project: r.project });
      dispatch({ type: "SELECT_CLIP", id: r.newClipId });
    } catch (e) {
      notify("error", "تعذّر التقسيم", e instanceof Error ? e.message : undefined);
    }
  };

  const deleteSelectedClip = () => {
    if (state.selectedAudioId) {
      dispatch({ type: "REMOVE_AUDIO", id: state.selectedAudioId });
      dispatch({ type: "SELECT_AUDIO", id: null });
      return notify("info", "حُذف المقطع الصوتي", "Ctrl+Z للتراجع");
    }
    const ids = state.selectedClipIds.length > 0 ? state.selectedClipIds : state.selectedClipId ? [state.selectedClipId] : [];
    if (ids.length === 0) return notify("warning", "حدّد مقطعاً أولاً");
    try {
      let p = state.project;
      for (const id of ids) p = deleteClipOp(p, id);
      if (exportClips(p).length === 0 && exportClips(state.project).length > 0) {
        return notify("warning", "لا يمكن حذف آخر مقطع", "التايملاين الفارغ يصدّر الفيديو كاملاً");
      }
      dispatch({ type: "COMMIT_PROJECT", project: p });
      dispatch({ type: "SELECT_CLIP", id: null });
      notify("info", ids.length > 1 ? `حُذفت ${ids.length} مقاطع` : "حُذف المقطع", "Ctrl+Z للتراجع");
    } catch (e) {
      notify("error", "تعذّر الحذف", e instanceof Error ? e.message : undefined);
    }
  };

  const duplicateSelected = () => {
    const id = state.selectedClipId;
    if (!id) return notify("warning", "حدّد مقطعاً أولاً");
    try {
      const r = duplicateClip(state.project, id);
      dispatch({ type: "COMMIT_PROJECT", project: r.project });
      dispatch({ type: "SELECT_CLIP", id: r.newClipId });
    } catch (e) {
      notify("error", "تعذّر النسخ", e instanceof Error ? e.message : undefined);
    }
  };

  const editorActionsRef = useRef({ splitAtPlayhead, deleteSelectedClip, duplicateSelected });
  editorActionsRef.current = { splitAtPlayhead, deleteSelectedClip, duplicateSelected };
  const liveRef = useRef({ playhead: state.playhead, zoom: state.zoom, project: state.project, clipIds: state.project.clips.map((c) => c.id) });
  liveRef.current = { playhead: state.playhead, zoom: state.zoom, project: state.project, clipIds: state.project.clips.map((c) => c.id) };

  // اختصارات لوحة المفاتيح (لا تعمل داخل حقول الكتابة). القائمة المعروضة في ShortcutsModal = هذا الكود حرفياً.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const live = liveRef.current;
      const total = (() => {
        const d = timelineDuration(live.project);
        return d > 0 ? d : live.project.duration || 30;
      })();
      const fps = live.project.fps || 30;
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      } else if (mod && key === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT_CLIPS", ids: live.clipIds });
      } else if (mod && key === "d") {
        e.preventDefault();
        editorActionsRef.current.duplicateSelected();
      } else if (!mod && key === "s") {
        e.preventDefault();
        editorActionsRef.current.splitAtPlayhead();
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        editorActionsRef.current.deleteSelectedClip();
      } else if (!mod && e.key === " ") {
        e.preventDefault();
        dispatch({ type: "TOGGLE_PLAY" });
      } else if (!mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const step = e.shiftKey ? 1 : 1 / fps; // Shift = ثانية، بدونه = إطار واحد
        seekRef.current(Math.max(0, Math.min(total, Math.round((live.playhead + dir * step) * fps) / fps)));
      } else if (!mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // القفز بين نقاط القطع (حدود المقاطع) السابقة/التالية.
        e.preventDefault();
        const pts = snapPoints(live.project).map((x) => x.time).sort((a, b) => a - b);
        const eps = 1e-3;
        const target = e.key === "ArrowUp" ? pts.find((t) => t > live.playhead + eps) : [...pts].reverse().find((t) => t < live.playhead - eps);
        if (target !== undefined) seekRef.current(target);
      } else if (!mod && e.key === "Home") {
        e.preventDefault();
        seekRef.current(0);
      } else if (!mod && e.key === "End") {
        e.preventDefault();
        seekRef.current(total);
      } else if (!mod && (e.key === "+" || e.key === "=")) {
        dispatch({ type: "SET_ZOOM", z: Math.min(400, Math.round(live.zoom * 1.25)) });
      } else if (!mod && (e.key === "-" || e.key === "_")) {
        dispatch({ type: "SET_ZOOM", z: Math.max(10, Math.round(live.zoom / 1.25)) });
      } else if (!mod && key === "n") {
        dispatch({ type: "TOGGLE_SNAP" });
      } else if (!mod && e.key === "Escape") {
        dispatch({ type: "SELECT_CLIP", id: null });
        dispatch({ type: "SELECT_AUDIO", id: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // نتائج محاكاة من أي مسار API تُعرض كتحذير صريح (لا تُقدَّم كتحليل حقيقي).
  useEffect(() => {
    const onSim = (e: Event) => {
      const detail = (e as CustomEvent<{ url: string; warning: string }>).detail;
      notify("warning", "نتيجة تقديرية (محاكاة)", detail.warning || detail.url);
    };
    window.addEventListener(SIMULATED_EVENT, onSim);
    return () => window.removeEventListener(SIMULATED_EVENT, onSim);
  }, [notify]);

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

  useEffect(() => {
    const { projects, invalid } = loadProjectsReport();
    setSavedProjects(projects);
    if (invalid > 0) notify("warning", `تُجوهل ${invalid} مشروع تالف في تخزين المتصفح`);
  }, [notify]);

  const aspectRatio = useMemo(() => {
    switch (state.project.aspect) {
      case "9:16":
        return 9 / 16;
      case "1:1":
        return 1;
      case "4:5":
        return 4 / 5;
      default:
        return 16 / 9;
    }
  }, [state.project.aspect]);

  return (
    <div
      className="h-screen w-screen flex flex-col bg-bg text-ink overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Header
        state={state}
        dispatch={dispatch}
        onUploadClick={() => fileInputRef.current?.click()}
        onExport={startExport}
        onSave={saveProjectToList}
        onProjects={() => {
          setSavedProjects(loadProjects());
          void refreshServerProjects();
          setShowProjects(true);
        }}
        onImport={() => {
          const inp = document.createElement("input");
          inp.type = "file";
          inp.accept = ".json";
          inp.onchange = (ev) =>
            importProject(ev as unknown as React.ChangeEvent<HTMLInputElement>);
          inp.click();
        }}
        onShortcuts={() => setShowShortcuts(true)}
        onApiSettings={() => setShowApiSettings(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        {(state.showLeftPanel || state.showRightPanel) && (
          <button
            aria-label="إغلاق اللوحة"
            className="lg:hidden fixed inset-0 z-30 bg-black/60"
            onClick={() => {
              if (state.showLeftPanel) dispatch({ type: "TOGGLE_LEFT" });
              if (state.showRightPanel) dispatch({ type: "TOGGLE_RIGHT" });
            }}
          />
        )}
        {state.showLeftPanel && (
          <aside className="fixed inset-y-0 right-0 z-40 w-[min(20rem,92vw)] lg:static lg:z-auto lg:w-80 border-l border-line bg-bg-panel flex flex-col" aria-label="لوحة الأدوات والوسائط">
              <LeftPanel
                state={state}
                dispatch={dispatch}
                notify={notify}
                ensureBase={ensureBaseClip}
                setAudio={setAudio}
                onFullAuto={aiFullAuto}
                onDirector={aiDirectorAgent}
                onFullPipeline={aiFullPipeline}
                agentRequest={agentRequest}
                setAgentRequest={setAgentRequest}
                onSilence={aiSilenceRemove}
                onSubtitles={aiSubtitles}
                onEnhanceAudio={aiEnhanceAudio}
                onColor={aiColor}
                onStabilize={aiStabilize}
                onBRoll={aiBRoll}
                onShorts={aiShorts}
                onSceneDetect={aiSceneDetect}
                onFaceDetect={aiFaceDetect}
                onObjectDetect={aiObjectDetect}
                onHighlight={aiHighlight}
                onReframe={aiReframe}
                onMusicSync={aiMusicSync}
                onTranslate={aiTranslate}
                onDub={aiDub}
                onThumbnail={aiThumbnail}
                onTitleDesc={aiTitleDesc}
                audioDenoise={audioDenoise}
                setAudioDenoise={setAudioDenoise}
                audioEnhance={audioEnhance}
                setAudioEnhance={setAudioEnhance}
                colorGrading={colorGrading}
                setColorGrading={setColorGrading}
                videoStabilize={videoStabilize}
                setVideoStabilize={setVideoStabilize}
                subtitleText={subtitleText}
                setSubtitleText={setSubtitleText}
                voiceoverText={voiceoverText}
                setVoiceoverText={setVoiceoverText}
                subLang={subLang}
                setSubLang={setSubLang}
                translateTarget={translateTarget}
                setTranslateTarget={setTranslateTarget}
                ttsVoice={ttsVoice}
                setTtsVoice={setTtsVoice}
                fontSize={fontSize}
                setFontSize={setFontSize}
                fontColor={fontColor}
                setFontColor={setFontColor}
                fontBg={fontBg}
                setFontBg={setFontBg}
                fontFamily={fontFamily}
                setFontFamily={setFontFamily}
                bpmInput={bpmInput}
                setBpmInput={setBpmInput}
                onAddSubtitle={() => {
                  if (!subtitleText.trim()) return;
                  const start = state.playhead;
                  const dur = Math.max(1.5, subtitleText.length * 0.18);
                  dispatch({
                    type: "ADD_SUBTITLES",
                    cues: [
                      {
                        id: uuid(),
                        start,
                        end: start + dur,
                        text: subtitleText,
                        lang: subLang,
                      },
                    ],
                  });
                  setSubtitleText("");
                  notify("success", "تمت إضافة الترجمة");
                }}
                onExportSRT={exportSRT}
                onExportVTT={exportVTT}
                onExportProject={exportProject}
              />
          </aside>
        )}

          <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#06060b]">
          <div className="lg:hidden flex items-center gap-2 px-2 py-1 border-b border-line bg-bg-panel text-[11px]">
            <button className="btn-outline px-2 py-1" aria-pressed={state.showLeftPanel} onClick={() => dispatch({ type: "TOGGLE_LEFT" })}>الأدوات والوسائط</button>
            <button className="btn-outline px-2 py-1" aria-pressed={state.showRightPanel} onClick={() => dispatch({ type: "TOGGLE_RIGHT" })}>الخصائص</button>
          </div>
            <div className="flex-1 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-grid opacity-[0.03]" />
              <div className="relative rounded-lg overflow-hidden shadow-2xl border border-[#1e1e2e]"
                style={{ aspectRatio: aspectRatio, maxHeight: "80%", maxWidth: "90%" }}
              >
                <div className="absolute inset-0 bg-black/5 pointer-events-none z-10" />
                <div className="absolute top-0 left-0 right-0 h-5 bg-black/40 flex items-center px-2 gap-1 z-10 pointer-events-none">
                  <div className="h-1.5 w-1.5 rounded-full bg-rose-500/70" />
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500/70" />
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
                  <span className="text-[7px] text-white/30 mr-2 font-mono">{state.project.aspect} • {state.project.resolution}</span>
                </div>
              {state.videoUrl ? (
                <video
                  ref={videoRef}
                  src={state.videoUrl}
                  className="w-full h-full object-contain bg-black"
                  preload="auto"
                  playsInline
                  onTimeUpdate={handleVideoTimeUpdate}
                  style={{
                    // معاينة التأطير الذكي بنفس هندسة قصّ التصدير (T-15)
                    transform: framingCss(clipFraming(activeVideoClip(state.project.clips, state.playhead) ?? ({ smartZoom: false, zoom: 1, panX: 0, panY: 0 }))),
                    filter: (() => {
                      const base = COLOR_FILTERS.find((c) => c.id === state.project.clips[0]?.colorFilter);
                      let f = base && base.id !== "none" ? base.css : "none";
                      const gain = (colorGrading - 0.5) * 0.4;
                      if (f === "none") f = `brightness(${1 + gain}) saturate(${1 + gain}) contrast(${1 + gain * 0.5})`;
                      return f;
                    })(),
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-bg-panel to-bg-soft p-8 text-center">
                  <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-brand to-brand-accent flex items-center justify-center shadow-glow mb-4">
                    <Upload className="h-10 w-10 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold glow-text mb-2">ابدأ مشروعك الجديد</h2>
                  <p className="text-ink-soft mb-6 max-w-md">
                    اسحب الفيديو هنا أو اضغط الزر أدناه ليقوم الذكاء الاصطناعي بكل شيء تلقائياً
                  </p>
                  <button
                    className="btn-primary text-base px-6 py-3"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-5 w-5" />
                    رفع فيديو للبدء
                  </button>
                  <div className="mt-6 text-xs text-ink-mute">
                    MP4 • MOV • WebM • MKV — كل المعالجة محلية على جهازك
                  </div>
                </div>
              )}

              {state.project.subtitles.length > 0 && state.videoUrl && (
                <SubtitleOverlay
                  cue={state.project.subtitles.find(
                    (c) => state.playhead >= c.start && state.playhead <= c.end
                  )}
                  fontSize={fontSize}
                  fontColor={fontColor}
                  fontBg={fontBg}
                  fontFamily={FONT_OPTIONS.find((f) => f.id === fontFamily)?.css || FONT_OPTIONS[0].css}
                />
              )}

              {state.project.effects.length > 0 && state.videoUrl && (
                <EffectOverlay effects={state.project.effects} />
              )}

              {audio?.url && (
                <audio
                  key={audio.url}
                  src={audio.url}
                  loop
                  controls={false}
                  autoPlay
                  className="hidden"
                />
              )}

              <input
                ref={fileInputRef}
                type="file"
                aria-label="رفع فيديو"
                accept="video/*"
                hidden
                onChange={handleFileInput}
              />
            </div>

            <div className="absolute top-4 right-4 flex flex-col gap-2">
              {state.jobs.slice(0, 3).map((j) => (
                <div
                  key={j.id}
                  className="glass px-3 py-2 rounded-lg flex items-center gap-2 text-xs min-w-[220px]"
                >
                  {j.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 text-brand-glow animate-spin" />
                  ) : j.status === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span>{j.label}</span>
                      <span className="text-ink-mute">{Math.round(j.progress)}%</span>
                    </div>
                    {j.message && <div className="text-[10px] text-ink-mute">{j.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Timeline
            state={state}
            dispatch={dispatch}
            videoRef={videoRef}
            onSeek={seekTimeline}
            onSplit={splitAtPlayhead}
            onDeleteClip={deleteSelectedClip}
            formatTime={formatTime}
            onSelectClip={(id) => dispatch({ type: "SELECT_CLIP", id })}
            onSelectSub={(id) => dispatch({ type: "SELECT_SUBTITLE", id })}
            notify={notify}
          />

            <Transport
              state={state}
              dispatch={dispatch}
              videoRef={videoRef}
              audio={audio}
              onPlayPause={() => dispatch({ type: "TOGGLE_PLAY" })}
              onSkip={(d) => handlePlayheadChange(Math.max(0, state.playhead + d))}
              onSeek={seekTimeline}
              formatTime={formatTime}
              onRenderedPreview={startRenderedPreview}
              renderBusy={isExporting}
            />
        </main>

        {state.showRightPanel && (
          <aside className="fixed inset-y-0 left-0 z-40 w-[min(20rem,92vw)] lg:static lg:z-auto lg:w-80 border-r border-line bg-bg-panel flex flex-col" aria-label="لوحة الخصائص">
            <RightPanel
              state={state}
              dispatch={dispatch}
              audio={audio}
              setAudio={setAudio}
              notify={notify}
            />
          </aside>
        )}
      </div>

      <Notifications
        notifications={state.notifications}
        onRemove={(id) => dispatch({ type: "REMOVE_NOTIFICATION", id })}
      />

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showApiSettings && <ApiSettingsModal onClose={() => setShowApiSettings(false)} />}

      {showProjects && (
        <ProjectsModal
          projects={savedProjects}
          serverProjects={serverProjects}
          onClose={() => setShowProjects(false)}
          onLoad={(p) => {
            setServerProjectId(null);
            loadProject(p);
          }}
          onOpenServer={openServerProject}
          onDelete={removeProject}
          onNew={() => {
            setServerProjectId(null);
            dispatch({ type: "REPLACE_PROJECT", project: defaultProject() });
            setShowProjects(false);
          }}
        />
      )}

      {isExporting && (
        <ExportModal
          project={state.project}
          progress={exportProgress}
          onCancel={cancelExport}
        />
      )}

      {renderedPreview && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="المعاينة المرندرة" onClick={() => setRenderedPreview(null)}>
          <div className="bg-bg-panel border border-line rounded-lg p-3 max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2 text-xs">
              <span>معاينة مرندرة: {renderedPreview.start.toFixed(1)}s → {renderedPreview.end.toFixed(1)}s (دقة منخفضة، نفس خطة التصدير)</span>
              <button onClick={() => setRenderedPreview(null)} aria-label="إغلاق" className="text-ink-mute hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <video src={renderedPreview.url} controls autoPlay className="w-full max-h-[70vh] bg-black rounded" />
          </div>
        </div>
      )}

      {exportResult && (
        <ExportResultModal
          result={exportResult}
          onClose={() => setExportResult(null)}
          onDownload={() => {
            if (exportResult.jobId) {
              const a = document.createElement("a");
              a.href = `/api/export/download/${exportResult.jobId}`;
              a.download = exportResult.name;
              a.click();
            }
            setExportResult(null);
          }}
        />
      )}

      {showPipelineModal && pipelinePlan && (
        <PipelineModal
          plan={pipelinePlan}
          render={pipelineRender}
          isRendering={state.jobs.some((j) => j.kind === "pipeline-render" && j.status === "running")}
          onClose={() => setShowPipelineModal(false)}
          onRender={() => {
            const jobId = String(pipelinePlan.jobId || "");
            if (jobId) void aiPipelineRender(jobId);
          }}
        />
      )}

    </div>
  );
}
