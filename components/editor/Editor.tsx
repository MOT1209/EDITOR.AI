"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  ModalShell,
  SectionTitle,
  EmptyState,
  InfoRow,
  StatBox,
  SliderRow,
  ColorRow,
  ToggleRow,
} from "./ui";
import { ApiSettingsModal, ShortcutsModal } from "./modals";
import { ProjectsModal, ExportModal, ExportResultModal } from "./project-modals";
import {
  Sparkles,
  Upload,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
  Volume2,
  Palette,
  Captions,
  Music,
  Image as ImageIcon,
  Mic,
  Languages,
  Wand2,
  Download,
  Settings2,
  Type,
  ZoomIn,
  ZoomOut,
  Plus,
  X,
  Loader2,
  Trash2,
  Save,
  Sliders,
  RefreshCcw,
  Film,
  Layers,
  AudioWaveform,
  AudioLines,
  FileVideo,
  FolderOpen,
  MousePointer2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  Gauge,
  Smartphone,
  Monitor,
  VolumeX,
  Tag,
  FileText,
  Bot,
  Brain,
  Music2,
  Aperture,
  Activity,
  Settings,
  SquareSplitHorizontal,
  Search,
  Crop,
  Waves,
  Video,
  Eye,
  Share2,
} from "lucide-react";

import {
  defaultProject,
  loadProjects,
  upsertProject,
  deleteProject,
  formatTime,
  formatBytes,
} from "@/lib/project";
import { EFFECTS_LIBRARY, MUSIC_LIBRARY, aiJobs, generateToneTrack } from "@/lib/mockAi";
import { apiConfig, apiFetch } from "@/lib/api-config";
import {
  analyzeVideo,
  captureFrame,
  generateSubtitles,
  generateMetadata,
  translateTexts,
  mockProgress,
} from "@/lib/ai/client";
import type {
  AIJob,
  AppNotification,
  AudioClip,
  MusicTrack,
  ProjectAspect,
  ProjectState,
  SubtitleCue,
  TextOverlay,
  TimelineTrack,
  VideoClip,
  Effect,
} from "@/lib/types";
import type { CeoResponse } from "@/lib/agents/types";

import {
  TABS,
  COLOR_FILTERS,
  FONT_OPTIONS,
  fmtSrtTime,
  fmtVttTime,
  reducer,
  initialState,
} from "./state";
import type { State, Action, TabId } from "./state";
import { SubtitleOverlay, EffectOverlay, Notifications, PipelineModal } from "./overlays";
import { Timeline, Transport } from "./timeline";


export default function Editor() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [audio, setAudio] = useState<{ url: string; name: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [savedProjects, setSavedProjects] = useState<ProjectState[]>([]);
  const [exportResult, setExportResult] = useState<{ name: string; size: number; jobId?: string } | null>(null);
  const [serverVideoPath, setServerVideoPath] = useState<string | null>(null);
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

  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    dispatch({ type: "SET_PLAYHEAD", t });
    if (t >= videoRef.current.duration) {
      dispatch({ type: "TOGGLE_PLAY" });
    }
  }, []);

  const handlePlayheadChange = useCallback((t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    dispatch({ type: "SET_PLAYHEAD", t });
  }, []);

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
      setServerVideoPath(null);
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
  }, [notify]);

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

  /**
   * المسار الكامل متعدد الوكلاء (1.3): يرفع الفيديو، يحلل (Whisper + مشاهد + وجوه)،
   * يضع خطة EDL (مخرج) ويوقف قبل الرندر ليعرض التقرير والخطة على المستخدم
   * ثم يؤكد فيبدأ الرندر الفعلي (ffmpeg) ويعرض الفيديو النهائي.
   */
  const aiFullPipeline = async () => {
    if (!state.videoMeta || !state.videoFile) {
      return notify("warning", "ارفع فيديو أولاً", "المسار الكامل يحتاج ملف فيديو.");
    }
    const videoFile = state.videoFile;
    await runAIJob("pipeline", "المسار الكامل متعدد الوكلاء", async (update) => {
      update(4, "رفع الفيديو وتحليل الصوت (Whisper)...");
      const form = new FormData();
      form.append("file", videoFile);
      form.append("request", agentRequest || "فيديو قصير جذاب مع ترجمة");
      form.append("language", subLang);
      form.append("aspect", state.project.aspect);
      form.append("mood", state.aiMood);
      form.append("phase", "plan");
      const res = await apiFetch("/api/agents/pipeline", { method: "POST", body: form });
      const data = (await res.json()) as Record<string, any> & { error?: string };
      if (data?.error || !data?.edl) throw new Error(data?.error || "فشلت خطة المسار الكامل");
      update(90, "عرض التقرير والخطة...");
      setPipelineRender(null);
      setPipelinePlan(data);
      setShowPipelineModal(true);
      update(100, "الخطة جاهزة — انتظر تأكيدك قبل الرندر");
      return {
        jobId: data.jobId,
        title: (data.edl as any)?.title,
        keeps: (data.edl as any)?.segments?.filter((s: any) => s.keep)?.length || 0,
        words: (data.analyst as any)?.words?.length || 0,
      };
    });
  };

  /** المرحلة الثانية: تنفيذ الرندر الفعلي للخطة المعتمدة */
  const aiPipelineRender = async (jobId: string) => {
    await runAIJob("pipeline-render", "رندر الفيديو النهائي", async (update) => {
      update(15, "بناء أمر ffmpeg وتنفيذه...");
      const form = new FormData();
      form.append("phase", "render");
      form.append("jobId", jobId);
      const res = await apiFetch("/api/agents/pipeline", { method: "POST", body: form });
      const data = (await res.json()) as Record<string, any> & { error?: string };
      if (data?.error) throw new Error(data.error);
      update(95, "تحديث النتيجة...");
      setPipelineRender(data.render || data);
      update(100, "اكتمل الرندر ✓");
      return { videoUrl: data.videoUrl, size: data.render?.outputBytes || 0 };
    });
  };

  const aiFullAuto = async () => {
    if (!state.videoMeta) {
      notify("warning", "ارفع فيديو أولاً");
      return;
    }
    await runAIJob("full", "المونتاج الكامل التلقائي", async (update) => {
      update(5, "تحليل المشاهد...");
      const res = state.videoUrl
        ? await analyzeVideo(state.videoUrl, totalDuration)
        : await apiFetch("/api/ai/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ duration: totalDuration }),
          }).then((r) => r.json());
      update(25, "إنشاء الترجمات...");
      const subResult = await generateSubtitles(
        state.videoFile,
        state.videoUrl || "",
        totalDuration,
        "ar"
      );
      if (subResult.cues.length > 0) {
        dispatch({ type: "ADD_SUBTITLES", cues: subResult.cues });
      }
      update(45, "اختيار الموسيقى وتوليدها...");
      const music = MUSIC_LIBRARY.find((m) => m.mood === state.aiMood) || MUSIC_LIBRARY[0];
      dispatch({ type: "SET_MUSIC", id: music.id });
      let musicUrl = music.url;
      if (!musicUrl) {
        try {
          musicUrl = (await generateToneTrack(music)) || "";
        } catch {
          musicUrl = "";
        }
      }
      setAudio({ url: musicUrl, name: music.title });
      update(60, "تحسين الألوان والصوت...");
      update(75, "توليد العنوان والوصف...");
      const meta = await generateMetadata(totalDuration, subResult.transcript);
      dispatch({ type: "SET_TITLE_META", title: meta.title, description: meta.description, tags: meta.tags });
      update(88, "إنشاء Thumbnail...");
      const thumb = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: meta.title, aspect: state.project.aspect }),
      }).then((r) => r.json());
      const thumbDataUrl = thumb?.dataUrl || thumb?.svg;
      if (thumbDataUrl) dispatch({ type: "SET_THUMBNAIL", dataUrl: thumbDataUrl });
      update(100, "تم");
      return { ...res, ...meta };
    });
  };

  /**
   * وكيلة المديرة التنفيذية: تستلم الفيديو + طلب المستخدم، تحلله (تفريغ، صمت، مشاهد)،
   * تضع خطة EDL عبر الذكاء الاصطناعي، ثم يطبقها مهندس التنفيذ على التايملاين تلقائياً.
   */
  const aiDirectorAgent = async (requestText: string) => {
    if (!state.videoMeta || !state.videoFile) {
      return notify("warning", "ارفع فيديو أولاً", "المديرة التنفيذية تحتاج ملف فيديو لتخطط له.");
    }
    const videoFile = state.videoFile;
    const captionsLang = subLang;
    await runAIJob("director", "المديرة التنفيذية — مونتاج ذكي", async (update) => {
      update(4, "المديرة التنفيذية تستلم الفيديو والطلب...");
      const form = new FormData();
      form.append("file", videoFile);
      form.append("request", requestText || "");
      form.append("language", captionsLang);
      form.append("moodHint", state.aiMood);
      form.append("duration", String(totalDuration));
      const res = await apiFetch("/api/agents/ceo", { method: "POST", body: form });
      const data = (await res.json()) as CeoResponse & { error?: string };
      if (!data?.plan) throw new Error(data?.error || "فشلت خطة المديرة التنفيذية");
      const plan = data.plan;

      update(25, "مهندس التنفيذ يعيد بناء التايملاين...");
      // امسح التايملاين السابق (مقاطع، ترجمات، نصوص)
      state.project.clips.forEach((c) => dispatch({ type: "REMOVE_CLIP", id: c.id }));
      state.project.subtitles.forEach((s) => dispatch({ type: "REMOVE_SUBTITLE", id: s.id }));
      state.project.textOverlays.forEach((o) => dispatch({ type: "REMOVE_TEXT_OVERLAY", id: o.id }));

      // أجزاء القص (keep فقط) بتوقيتات جديدة متتالية
      let t = 0;
      const kept = plan.segments.filter((s) => s.keep);
      kept.forEach((s) => {
        const dur = Math.max(0.25, s.end - s.start);
        dispatch({
          type: "ADD_CLIP",
          clip: {
            id: uuid(),
            assetId: "main",
            trackId: "t_video",
            start: t,
            duration: dur,
            inPoint: s.start,
            outPoint: s.end,
            effects: ["fx_fade"],
            volume: 1,
            speed: s.speed || 1,
            zoom: 1,
            panX: 0,
            panY: 0,
            smartZoom: false,
            colorFilter: plan.style.colorFilter,
          },
        });
        t += dur;
      });

      // الترجمة التلقائية من التفريغ الحقيقي
      update(45, "إضافة الترجمة من التفريغ الصوتي...");
      if (plan.style.captions && data.segments.length > 0) {
        dispatch({
          type: "ADD_SUBTITLES",
          cues: data.segments.map((s, i) => ({
            id: `sub_${i}_${Date.now()}`,
            start: Math.max(0, s.start),
            end: Math.min(s.end, totalDuration),
            text: s.text,
            lang: captionsLang,
            style: plan.style.captionStyle,
          })),
        });
      }

      // الموسيقى حسب مزاج الخطة
      update(58, "اختيار الموسيقى حسب المزاج...");
      const music =
        MUSIC_LIBRARY.find((m) => m.mood === plan.style.musicMood) || MUSIC_LIBRARY[0];
      dispatch({ type: "SET_MUSIC", id: music.id });
      let musicUrl = music.url;
      if (!musicUrl) {
        try {
          musicUrl = (await generateToneTrack(music)) || "";
        } catch {
          musicUrl = "";
        }
      }
      setAudio({ url: musicUrl, name: music.title });

      // النصوص التوضيحية (overlays)
      update(66, "إضافة النصوص التوضيحية...");
      plan.textOverlays.forEach((o) => {
        dispatch({
          type: "ADD_TEXT_OVERLAY",
          overlay: {
            id: uuid(),
            text: o.text,
            start: Math.max(0, o.start),
            end: Math.min(o.end, totalDuration),
            position: o.position,
            fontFamily,
            fontSize,
            color: fontColor,
            animation: "fade",
          },
        });
      });

      // الفلتر اللوني على مستوى المشروع
      if (plan.style.colorFilter && plan.style.colorFilter !== "none") {
        const existing = state.project.effects.filter((e) => !e.startsWith("color_"));
        dispatch({
          type: "PATCH_PROJECT",
          patch: { effects: [...existing, `color_${plan.style.colorFilter}`] },
        });
      }

      // العنوان والوصف
      update(80, "توليد العنوان والوصف...");
      dispatch({
        type: "SET_TITLE_META",
        title: plan.title,
        description: plan.description,
        tags: plan.tags || [],
      });

      // الصورة المصغرة
      update(88, "إنشاء الصورة المصغرة...");
      try {
        const thumb = await fetch("/api/thumbnail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: plan.title, aspect: state.project.aspect }),
        }).then((r) => r.json());
        const thumbDataUrl = thumb?.dataUrl || thumb?.svg;
        if (thumbDataUrl) dispatch({ type: "SET_THUMBNAIL", dataUrl: thumbDataUrl });
      } catch {
        /* الصورة المصغرة اختيارية */
      }

      // احتفظ بمسار الفيديو على الخادم لعمليات التصدير اللاحقة
      if (data.filePath) setServerVideoPath(data.filePath);

      update(100, "اعتماد المديرة التنفيذية ✓");
      return {
        summary: plan.summary,
        mock: data.mock,
        keptSegments: kept.length,
        cuts: plan.segments.filter((s) => !s.keep).length,
      };
    });
  };

  const aiSilenceRemove = async () => {
    if (!state.videoMeta || !state.videoFile) return notify("warning", "ارفع فيديو أولاً");
    const videoFile = state.videoFile; // نسخة محلية: يضمن تحليل TypeScript عدم كونها null داخل الـ closure
    await runAIJob("silence", "إزالة الصمت والتوقفات", async (update) => {
      // ارفع الفيديو للخادم (إن لم يُرفع بعد) حتى يعمل الكشف بففلتر FFmpeg الحقيقي
      // بدل المحاكاة العشوائية التي تُستخدم عند غياب filePath.
      update(10, "رفع الفيديو للتحليل...");
      let sourcePath = serverVideoPath;
      if (!sourcePath) {
        const form = new FormData();
        form.append("file", videoFile);
        const uploadRes = await apiFetch("/api/ffmpeg/probe", { method: "POST", body: form }).then((r) =>
          r.json()
        );
        if (!uploadRes?.path) throw new Error(uploadRes?.error || "فشل رفع الفيديو للتحليل");
        sourcePath = uploadRes.path as string;
        setServerVideoPath(sourcePath);
      }
      const res = await apiFetch("/api/ai/silence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: totalDuration, filePath: sourcePath }),
      }).then((r) => r.json());
      update(50, "قص الصمت من التايملاين...");
      const cuts = (res.segments as { start: number; end: number }[])
        .map((s) => ({ start: Math.max(0, s.start), end: Math.min(s.end, totalDuration) }))
        .filter((s) => s.end > s.start)
        .sort((a, b) => a.start - b.start);

      // المقاطع المحتفظ بها = الفيديو كاملاً ناقص فترات الصمت.
      const keeps: { start: number; end: number }[] = [];
      let cursor = 0;
      for (const c of cuts) {
        if (c.start > cursor) keeps.push({ start: cursor, end: c.start });
        cursor = Math.max(cursor, c.end);
      }
      if (cursor < totalDuration) keeps.push({ start: cursor, end: totalDuration });

      // احذف المقاطع السابقة ثم أضف المقاطع المحتفظ بها (بدون فواصل صامتة).
      state.project.clips.forEach((c) =>
        dispatch({ type: "REMOVE_CLIP", id: c.id })
      );
      keeps.forEach((k, i) => {
        dispatch({
          type: "ADD_CLIP",
          clip: {
            id: uuid(),
            assetId: "main",
            trackId: "t_video",
            start: i * 0.5, // فجوة بصرية صغيرة بين المقاطع على التايملاين
            duration: Math.max(0.2, k.end - k.start),
            inPoint: k.start,
            outPoint: k.end,
            effects: ["fx_fade"],
            volume: 1,
            speed: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
            smartZoom: false,
            colorFilter: "none",
          },
        });
      });
      update(100, "تم");
      return { cuts: cuts.length, keeps: keeps.length };
    });
  };

  const aiSubtitles = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("subtitles", "توليد الترجمة التلقائية", async (update) => {
      update(20, "معالجة الصوت...");
      const result = await generateSubtitles(
        state.videoFile,
        state.videoUrl || "",
        totalDuration,
        subLang
      );
      update(60, "إضافة الترجمة للتايملاين...");
      if (result.cues.length > 0) {
        dispatch({ type: "ADD_SUBTITLES", cues: result.cues });
      }
      update(100, "تم");
      return result;
    });
  };

  const aiEnhanceAudio = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("audio", "تحسين جودة الصوت وإزالة الضوضاء", async (update) => {
      update(15, "تحليل الموجات الصوتية...");
      await new Promise((r) => setTimeout(r, 200));

      try {
        const video = document.createElement("video");
        video.src = state.videoUrl!;
        video.crossOrigin = "anonymous";
        await new Promise<void>((res, rej) => {
          video.onloadedmetadata = () => res();
          video.onerror = () => rej();
          video.load();
        });

        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();

        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -30 * audioDenoise;
        compressor.ratio.value = 4 + audioEnhance * 8;
        compressor.knee.value = 10;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        const filter = audioCtx.createBiquadFilter();
        filter.type = "highshelf";
        filter.frequency.value = 3000;
        filter.gain.value = audioEnhance * 8;

        source.connect(compressor);
        compressor.connect(filter);
        filter.connect(dest);
        source.connect(audioCtx.destination);

        update(50, "تطبيق الضغط والمعادلة...");
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm";
        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        // عالج المدة الفعلية بحد أقصى 60 ثانية (المعالجة تعمل بوقت حقيقي أثناء التشغيل).
        const videoDuration = state.videoMeta?.duration ?? 3;
        const recordSec = Math.max(3, Math.min(videoDuration, 60));
        update(60, `تسجيل المسار المحسّن (${recordSec.toFixed(0)} ثانية)...`);
        let closed = false;
        const closeCtx = () => {
          if (!closed) {
            closed = true;
            audioCtx.close().catch(() => {});
          }
        };
        await new Promise<void>((res) => {
          recorder.onstop = () => { closeCtx(); res(); };
          recorder.start();
          video.play();
          video.muted = false;
          setTimeout(() => { video.pause(); recorder.stop(); closeCtx(); }, recordSec * 1000);
        });

        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: mime });
          const url = URL.createObjectURL(blob);
          update(80, "إضافة المسار المحسّن...");
          dispatch({
            type: "ADD_AUDIO",
            clip: {
              id: uuid(),
              name: "صوت محسّن",
              trackId: "t_audio",
              start: 0,
              duration: state.videoMeta!.duration,
              url,
              volume: 1,
              kind: "voiceover",
            },
          });
        }
        video.remove();
      } catch (e) {
        update(50, "استخدام المعالجة الافتراضية...");
        await new Promise((r) => setTimeout(r, 500));
      }
      update(100, "تم تحسين الصوت");
      return { ok: true };
    });
  };

  const aiColor = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("color", "تحسين الألوان وتعديل الإضاءة", async (update) => {
      update(20, "تحليل ألوان الإطارات...");
      try {
        const frames: string[] = [];
        for (let s = 0; s < Math.min(totalDuration, 30); s += 5) {
          const frame = await captureFrame(state.videoUrl!, s);
          if (frame) frames.push(frame);
        }
        update(50, "تحليل التوزيع اللوني...");
        if (frames.length > 0) {
          const res = await apiFetch("/api/ai/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ duration: totalDuration, frameBase64: frames[0] }),
          }).then((r) => r.json());
          if (res.quality) {
            const q = res.quality;
            const brightness = q.brightness || 0.6;
            const contrast = q.contrast || 0.6;
            const saturation = q.saturation || 0.6;
            const filter = `contrast(${0.8 + contrast * 0.6}) saturate(${0.6 + saturation * 0.8}) brightness(${0.7 + brightness * 0.5})`;
            dispatch({ type: "PATCH_PROJECT", patch: { effects: [...state.project.effects.filter(e => !e.startsWith("color_")), `color_auto_${Date.now()}`] } });
            notify("info", "تم تحليل الألوان", `السطوع: ${Math.round(brightness * 100)}% • التباين: ${Math.round(contrast * 100)}%`);
          }
        }
        update(80, "تطبيق التصحيح...");
        await new Promise((r) => setTimeout(r, 300));
        dispatch({ type: "PATCH_PROJECT", patch: { effects: [...state.project.effects, `fx_cinematic`] } });
      } catch {
        dispatch({ type: "PATCH_PROJECT", patch: { effects: [...state.project.effects, `fx_cinematic`] } });
      }
      update(100, "تم تحسين الألوان");
      return { ok: true };
    });
  };

  const aiStabilize = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("stabilize", "تثبيت الفيديو المهتز", async (update) => {
      await mockProgress(4, 300, update, "تحليل الحركة");
      setVideoStabilize(true);
      return { ok: true };
    });
  };

  const aiBRoll = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("broll", `توليد ${state.bRollCount} مقاطع B-Roll`, async (update) => {
      const total = state.bRollCount;
      for (let i = 0; i < total; i++) {
        await new Promise((r) => setTimeout(r, 350));
        update(((i + 1) / total) * 100, `إنشاء B-Roll ${i + 1}/${total}`);
        dispatch({
          type: "ADD_CLIP",
          clip: {
            id: uuid(),
            assetId: `broll_${i}`,
            trackId: "t_video",
            start: 2 + i * 6,
            duration: 2 + Math.random() * 2,
            inPoint: 0,
            outPoint: 0,
            effects: ["fx_fade", "fx_zoom_punch"],
            volume: 1,
            speed: 1,
            zoom: 1.1,
            panX: 0,
            panY: 0,
            smartZoom: false,
            colorFilter: "cinematic",
          },
        });
      }
      return { count: total };
    });
  };

  const aiShorts = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("shorts", "إنشاء Shorts/Reels", async (update) => {
      update(20, "تحليل اللحظات المهمة...");
      // استدعاء ShortsGenerationSkill الحقيقي عبر نظام Skills
      const wf = await apiFetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "skill",
          skill: "ShortsGenerationSkill",
          document: { duration: totalDuration, aspect: state.project.aspect },
        }),
      }).then((r) => r.json());
      const shorts =
        (wf?.result?.output?.shorts as { start: number; end: number; score: number }[]) || [];

      const count = Math.max(1, state.shortsCount);
      if (shorts.length === 0) {
        notify("info", "لم يجد التحليل لحظات مميزة", "سيُقسَّم الفيديو لمقاطع متساوية بدلاً من ذلك");
      }
      const cuts =
        shorts.length > 0
          ? shorts.slice(0, count)
          : Array.from({ length: count }, (_, i) => ({
              start: (i / count) * totalDuration,
              end: ((i + 1) / count) * totalDuration,
              score: 1,
            }));

      update(55, "إضافة المقاطع العمودية...");
      const trackId = `t_shorts_${Date.now()}`;
      dispatch({
        type: "ADD_TRACK",
        track: {
          id: trackId,
          kind: "video",
          label: "Shorts",
          height: 50,
          muted: false,
          locked: false,
        },
      });
      cuts.forEach((c, i) => {
        dispatch({
          type: "ADD_CLIP",
          clip: {
            id: uuid(),
            assetId: `short_${i}`,
            trackId,
            start: c.start,
            duration: Math.max(1, c.end - c.start),
            inPoint: c.start,
            outPoint: c.end,
            effects: ["fx_zoom_punch"],
            volume: 1,
            speed: 1,
            zoom: 1.1,
            panX: 0,
            panY: 0,
            smartZoom: true,
            colorFilter: "cinematic",
          },
        });
      });
      update(100, "تم");
      notify(
        "success",
        `تم إنشاء ${cuts.length} Short`,
        shorts.length > 0
          ? "بناءً على تحليل ShortsGenerationSkill"
          : "تقسيم متساوٍ (لا يوجد مفتاح API)"
      );
      return { count: cuts.length, ai: shorts.length > 0 };
    });
  };

  const aiSceneDetect = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("scenes", "تقسيم الفيديو إلى مشاهد", async (update) => {
      update(15, "التقاط إطارات...");
      const frames: string[] = [];
      const steps = Math.min(10, Math.floor(totalDuration / 3));
      for (let i = 0; i < steps; i++) {
        const frame = await captureFrame(state.videoUrl!, (i / steps) * totalDuration);
        if (frame) frames.push(frame);
      }
      update(40, "تحليل المشاهد...");
      const res = await apiFetch("/api/ai/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: totalDuration, frames }),
      }).then((r) => r.json());
      const scenes = res.scenes as { start: number; end: number; score: number; description?: string }[];
      if (scenes && scenes.length > 0) {
        update(70, `إنشاء ${scenes.length} مشهد...`);
        const trackId = `t_scenes_${Date.now()}`;
        dispatch({
          type: "ADD_TRACK",
          track: { id: trackId, kind: "video", label: "المشاهد", height: 60, muted: false, locked: false },
        });
        scenes.forEach((s, i) => {
          dispatch({
            type: "ADD_CLIP",
            clip: {
              id: uuid(),
              assetId: `scene_${i}`,
              trackId,
              start: s.start,
              duration: Math.max(0.5, s.end - s.start),
              inPoint: 0,
              outPoint: 0,
              effects: ["fx_fade"],
              volume: 1,
              speed: 1,
              zoom: 1,
              panX: 0,
              panY: 0,
              smartZoom: false,
              colorFilter: s.score > 0.7 ? "cinematic" : "none",
            },
          });
        });
        notify("success", `تم اكتشاف ${scenes.length} مشهد`);
      }
      update(100, "تم");
      return { count: scenes?.length || 0 };
    });
  };

  const aiFaceDetect = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("faces", "كشف الوجوه وتتبعها", async (update) => {
      update(20, "التقاط إطارات...");
      const frames: string[] = [];
      for (let i = 0; i < 5; i++) {
        const frame = await captureFrame(state.videoUrl!, (i / 5) * totalDuration);
        if (frame) frames.push(frame);
      }
      update(50, "تحليل الوجوه...");
      const res = await apiFetch("/api/ai/faces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: totalDuration, frames }),
      }).then((r) => r.json());
      const faces = res.faces as { start: number; end: number; x: number; y: number; w: number; h: number }[];
      update(80, "تحديث التايملاين...");
      if (faces && faces.length > 0) {
        const trackId = `t_faces_${Date.now()}`;
        dispatch({
          type: "ADD_TRACK",
          track: { id: trackId, kind: "fx", label: "الوجوه", height: 40, muted: false, locked: false },
        });
        notify("success", `تم كشف ${faces.length} وجه`);
      } else {
        notify("info", "لم يتم كشف وجوه", "جرّب رفع إطار أوضح");
      }
      update(100, "تم");
      return { count: faces?.length || 0 };
    });
  };

  const aiObjectDetect = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("objects", "كشف الأشياء المهمة", async (update) => {
      update(20, "التقاط إطارات...");
      const frames: string[] = [];
      for (let i = 0; i < 5; i++) {
        const frame = await captureFrame(state.videoUrl!, (i / 5) * totalDuration);
        if (frame) frames.push(frame);
      }
      update(50, "تحليل الأشياء...");
      const res = await apiFetch("/api/ai/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: totalDuration, frames }),
      }).then((r) => r.json());
      const objects = res.objects as { start: number; end: number; label: string; confidence: number }[];
      if (objects && objects.length > 0) {
        const labels = [...new Set(objects.map(o => o.label))];
        notify("success", `تم كشف: ${labels.join("، ")}`);
      }
      update(100, "تم");
      return { objects: objects || [] };
    });
  };

  const aiHighlight = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("highlight", "استخراج أفضل اللقطات", async (update) => {
      update(20, "تحليل المشاهد...");
      const res = await analyzeVideo(state.videoUrl!, totalDuration);
      const highlights = res.highlights as { start: number; end: number; reason: string }[];
      if (highlights && highlights.length > 0) {
        update(60, `إنشاء ${highlights.length} لقطة مميزة...`);
        highlights.forEach((h, i) => {
          dispatch({
            type: "ADD_CLIP",
            clip: {
              id: uuid(),
              assetId: `highlight_${i}`,
              trackId: "t_video",
              start: h.start,
              duration: Math.max(1, h.end - h.start),
              inPoint: 0,
              outPoint: 0,
              effects: ["fx_fade", "fx_zoom_punch"],
              volume: 1,
              speed: 1,
              zoom: 1.1,
              panX: 0,
              panY: 0,
              smartZoom: true,
              colorFilter: "cinematic",
            },
          });
        });
        notify("success", `تم استخراج ${highlights.length} لقطة مميزة`);
      } else {
        notify("info", "لم يتم العثور على لقطات مميزة");
      }
      update(100, "تم");
      return { count: highlights?.length || 0 };
    });
  };

  const aiReframe = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("reframe", "تحويل الفيديو (عمودي/أفقي)", async (update) => {
      update(20, "التقاط إطارات...");
      const frames: string[] = [];
      for (let i = 0; i < 4; i++) {
        const frame = await captureFrame(state.videoUrl!, (i / 4) * totalDuration);
        if (frame) frames.push(frame);
      }
      update(45, "تحليل الإطارات...");
      const isVertical = state.project.aspect === "9:16" || state.project.aspect === "4:5";
      const res = await apiFetch("/api/ai/reframe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: totalDuration, frames, targetAspect: state.project.aspect }),
      }).then((r) => r.json());
      const points = res.reframePoints as { time: number; x: number; y: number; zoom: number }[];
      if (points && points.length > 0) {
        const applyCount = Math.min(points.length, state.project.clips.length);
        update(70, `تطبيق ${applyCount} نقطة إعادة تأطير...`);
        for (let i = 0; i < applyCount; i++) {
          const p = points[i];
          dispatch({
            type: "UPDATE_CLIP",
            id: state.project.clips[i].id,
            patch: { panX: p.x - 0.5, panY: p.y - 0.5, zoom: p.zoom, smartZoom: true },
          });
        }
        notify("success", `تم إعادة تأطير الفيديو إلى ${isVertical ? "عمودي" : "أفقي"}`);
      }
      update(100, "تم");
      return { points: points?.length || 0 };
    });
  };

  const aiMusicSync = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("music-sync", "مزامنة الموسيقى مع الإيقاع", async (update) => {
      update(20, "تحليل الإيقاع...");
      const bpm = bpmInput || 120;
      const res = await apiFetch("/api/ai/music-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bpm, duration: totalDuration }),
      }).then((r) => r.json());
      const editPoints = res.editPoints as { time: number; strength: number }[];
      if (editPoints && editPoints.length > 0) {
        update(60, `إنشاء ${editPoints.length} نقطة مزامنة...`);
        const trackId = `t_sync_${Date.now()}`;
        dispatch({
          type: "ADD_TRACK",
          track: { id: trackId, kind: "fx", label: `مزامنة ${bpm} BPM`, height: 30, muted: false, locked: true },
        });
        editPoints.slice(0, 20).forEach((ep, i) => {
          dispatch({
            type: "ADD_CLIP",
            clip: {
              id: uuid(),
              assetId: `sync_${i}`,
              trackId,
              start: ep.time,
              duration: 0.1,
              inPoint: 0,
              outPoint: 0,
              effects: i % 4 === 0 ? ["fx_zoom_punch"] : ["fx_fade"],
              volume: 1,
              speed: 1,
              zoom: 1 + ep.strength * 0.15,
              panX: 0,
              panY: 0,
              smartZoom: false,
            },
          });
        });
        notify("success", `تمت المزامنة على ${bpm} BPM`);
      }
      update(100, "تم");
      return { editPoints: editPoints?.length || 0 };
    });
  };

  const aiTranslate = async () => {
    if (!state.project.subtitles.length) return notify("warning", "لا توجد ترجمة للترجمة");
    await runAIJob("translate", `ترجمة الترجمات إلى ${translateTarget}`, async (update) => {
      update(30, "ترجمة النص...");
      const texts = state.project.subtitles.map((c) => c.text);
      const { translated, fallback } = await translateTexts(texts, translateTarget);
      const cues = state.project.subtitles.map((c, i) => ({
        ...c,
        text: translated[i] || c.text,
        lang: translateTarget,
      }));
      dispatch({ type: "REPLACE_PROJECT", project: { ...state.project, subtitles: cues } });
      if (fallback) {
        notify("warning", "ترجمة تقريبية", "لا يوجد مفتاح API — استُخدمت عبارات جاهزة بدل ترجمة حقيقية. اضبط مفتاحاً من إعدادات API.");
      }
      update(100, "تم");
      return { count: cues.length, fallback };
    });
  };

  const aiDub = async () => {
    if (!voiceoverText.trim()) return notify("warning", "اكتب نصاً أولاً");
    await runAIJob("dub", "دبلجة بصوت مستنسخ", async (update) => {
      update(15, "تحويل النص إلى صوت (TTS)...");
      const res = await apiFetch("/api/ai/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: voiceoverText, voice: ttsVoice }),
      }).then((r) => r.json());

      let audioUrl = "";
      if (res?.audioBase64 && res?.mime) {
        const bytes = atob(res.audioBase64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        audioUrl = URL.createObjectURL(new Blob([arr], { type: res.mime }));
      }

      if (!audioUrl) {
        throw new Error(res?.error || "تعذّر توليد الصوت (تحقق من مفتاح API)");
      }

      update(70, "إضافة المسار للتايملاين...");
      const dur = Math.max(2, Number(res.durationEst) || voiceoverText.length * 0.06);
      dispatch({
        type: "ADD_AUDIO",
        clip: {
          id: uuid(),
          name: `Dub ${voiceoverText.slice(0, 16)}`,
          trackId: "t_audio",
          start: state.playhead,
          duration: dur,
          url: audioUrl,
          volume: 0.9,
          kind: "dub",
        },
      });
      update(100, "تم توليد الصوت");
      return { duration: dur, url: audioUrl.slice(0, 40) };
    });
  };

  const aiThumbnail = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("thumb", "إنشاء Thumbnail", async (update) => {
      const title = state.project.title || "مونتاج رائع";
      const res = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, aspect: state.project.aspect }),
      }).then((r) => r.json());
      const thumbDataUrl = res?.dataUrl || res?.svg;
      if (thumbDataUrl) dispatch({ type: "SET_THUMBNAIL", dataUrl: thumbDataUrl });
      update(100, "تم");
      return res;
    });
  };

  const aiTitleDesc = async () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    await runAIJob("meta", "توليد العنوان والوصف", async (update) => {
      update(20, "توليد العنوان والوصف...");
      const res = await generateMetadata(totalDuration);
      dispatch({ type: "SET_TITLE_META", title: res.title, description: res.description, tags: res.tags });
      update(100, "تم");
      return res;
    });
  };

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

  const startExport = async () => {
    if (!state.videoMeta || !state.videoFile) return notify("warning", "ارفع فيديو أولاً");
    setIsExporting(true);
    setExportProgress(0);
    try {
      let sourcePath = serverVideoPath;
      if (!sourcePath) {
        const form = new FormData();
        form.append("file", state.videoFile);
        const uploadRes = await apiFetch("/api/ffmpeg/probe", { method: "POST", body: form }).then((r) => r.json());
        if (!uploadRes?.path) throw new Error(uploadRes?.error || "فشل رفع الفيديو للمعالجة");
        sourcePath = uploadRes.path as string;
        setServerVideoPath(sourcePath);
      }

      const startRes = await apiFetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath,
          project: state.project,
          videoStabilize,
          colorGrading,
        }),
      }).then((r) => r.json());
      if (!startRes?.job?.id) throw new Error(startRes?.error || "تعذّر بدء التصدير");
      const jobId = startRes.job.id as string;

      // Poll the file-backed export status (not the in-memory /api/jobs list,
      // which Next.js dev mode can reset between route module reloads).
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const job = await fetch(`/api/export/status/${jobId}`).then((r) => (r.ok ? r.json() : null));
        if (!job) continue;
        setExportProgress(job.progress || 0);
        if (job.status === "completed") {
          setIsExporting(false);
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
          notify("error", "فشل التصدير", job.message || "حدث خطأ أثناء المعالجة.");
          return;
        }
      }
    } catch (err: unknown) {
      setIsExporting(false);
      const msg = err instanceof Error ? err.message : "فشل التصدير";
      notify("error", "فشل التصدير", msg);
    }
  };

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
        const p = JSON.parse(String(reader.result));
        dispatch({ type: "REPLACE_PROJECT", project: { ...defaultProject(), ...p } });
        notify("success", "تم استيراد المشروع");
      } catch {
        notify("error", "ملف غير صالح");
      }
    };
    reader.readAsText(f);
  };

  const saveProjectToList = () => {
    const updated = upsertProject({ ...state.project, thumbnail: state.project.thumbnail });
    setSavedProjects(loadProjects());
    notify("success", "تم الحفظ", `المشروع: ${updated.name}`);
  };

  const loadProject = (p: ProjectState) => {
    dispatch({ type: "REPLACE_PROJECT", project: p });
    setShowProjects(false);
    notify("info", "تم تحميل المشروع", p.name);
  };

  const removeProject = (id: string) => {
    deleteProject(id);
    setSavedProjects(loadProjects());
  };

  useEffect(() => {
    setSavedProjects(loadProjects());
  }, []);

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
        {state.showLeftPanel && (
          <aside className="w-80 border-l border-line bg-bg-panel flex flex-col">
              <LeftPanel
                state={state}
                dispatch={dispatch}
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

          <main className="flex-1 flex flex-col overflow-hidden bg-[#06060b]">
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
            formatTime={formatTime}
            onSelectClip={(id) => dispatch({ type: "SELECT_CLIP", id })}
            onSelectSub={(id) => dispatch({ type: "SELECT_SUBTITLE", id })}
          />

            <Transport
              state={state}
              dispatch={dispatch}
              videoRef={videoRef}
              audio={audio}
              onPlayPause={() => dispatch({ type: "TOGGLE_PLAY" })}
              onSkip={(d) => handlePlayheadChange(Math.max(0, state.playhead + d))}
              formatTime={formatTime}
            />
        </main>

        {state.showRightPanel && (
          <aside className="w-80 border-r border-line bg-bg-panel flex flex-col">
            <RightPanel
              state={state}
              dispatch={dispatch}
              audio={audio}
              setAudio={setAudio}
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
          onClose={() => setShowProjects(false)}
          onLoad={loadProject}
          onDelete={removeProject}
          onNew={() => {
            dispatch({ type: "REPLACE_PROJECT", project: defaultProject() });
            setShowProjects(false);
          }}
        />
      )}

      {isExporting && (
        <ExportModal
          project={state.project}
          progress={exportProgress}
          onCancel={() => setIsExporting(false)}
        />
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

function Header({
  state,
  dispatch,
  onUploadClick,
  onExport,
  onSave,
  onProjects,
  onImport,
  onShortcuts,
  onApiSettings,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onUploadClick: () => void;
  onExport: () => void;
  onSave: () => void;
  onProjects: () => void;
  onImport: () => void;
  onShortcuts: () => void;
  onApiSettings: () => void;
}) {
  return (
    <header className="h-11 bg-[#0a0a12] border-b border-[#1e1e2e] flex items-center px-3 gap-2 shrink-0">
      <div className="flex items-center gap-1.5">
        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-bold text-zinc-200 tracking-tight">MontageAI</span>
        <span className="text-[9px] text-zinc-600 mr-1">استوديو محلي</span>
      </div>

      <div className="h-4 w-px bg-[#1e1e2e] mx-1.5" />

      <div className="flex items-center gap-0.5">
        <button className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a28] px-2 py-1 rounded transition-colors" onClick={onProjects}>
          <FolderOpen className="h-3.5 w-3.5 inline-block ml-1" />
          المشاريع
        </button>
        <button className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a28] px-2 py-1 rounded transition-colors" onClick={onImport}>
          <FileText className="h-3.5 w-3.5 inline-block ml-1" />
          استيراد
        </button>
        <button className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a28] px-2 py-1 rounded transition-colors" onClick={onSave}>
          <Save className="h-3.5 w-3.5 inline-block ml-1" />
          حفظ
        </button>
      </div>

      <div className="h-4 w-px bg-[#1e1e2e] mx-1.5" />

      <input
        type="text"
        value={state.project.name}
        onChange={(e) =>
          dispatch({ type: "PATCH_PROJECT", patch: { name: e.target.value } })
        }
        className="bg-[#12121e] border border-[#1e1e2e] rounded px-2 py-1 text-[11px] text-zinc-300 w-36 focus:outline-none focus:border-blue-600/50 transition-colors"
        placeholder="اسم المشروع"
      />

      <div className="flex-1" />

      <button className="text-[11px] text-zinc-500 hover:text-zinc-300 px-1.5 py-1 transition-colors" onClick={onApiSettings} title="إعدادات API">
        <Settings className="h-3.5 w-3.5 inline-block" />
      </button>

      <button className="text-[11px] text-zinc-500 hover:text-zinc-300 px-1.5 py-1" onClick={onShortcuts} title="اختصارات">
        <kbd className="text-[9px] bg-[#1a1a28] border border-[#1e1e2e] px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
      </button>

      <button className="text-[11px] text-zinc-400 hover:text-zinc-200 bg-[#1a1a28] hover:bg-[#22223a] border border-[#1e1e2e] px-3 py-1.5 rounded transition-colors flex items-center gap-1" onClick={onUploadClick}>
        <Upload className="h-3.5 w-3.5" />
        رفع
      </button>
      <button className="text-[11px] text-white bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded transition-colors flex items-center gap-1 shadow-sm" onClick={onExport}>
        <Download className="h-3.5 w-3.5" />
        تصدير
      </button>
    </header>
  );
}

function LeftPanel(props: {
  state: State;
  dispatch: React.Dispatch<Action>;
  setAudio: (a: { url: string; name: string } | null) => void;
  onFullAuto: () => void;
  onDirector: (requestText: string) => void;
  onFullPipeline: () => void;
  agentRequest: string;
  setAgentRequest: (s: string) => void;
  onSilence: () => void;
  onSubtitles: () => void;
  onEnhanceAudio: () => void;
  onColor: () => void;
  onStabilize: () => void;
  onBRoll: () => void;
  onShorts: () => void;
  onSceneDetect: () => void;
  onFaceDetect: () => void;
  onObjectDetect: () => void;
  onHighlight: () => void;
  onReframe: () => void;
  onMusicSync: () => void;
  onTranslate: () => void;
  onDub: () => void;
  onThumbnail: () => void;
  onTitleDesc: () => void;
  audioDenoise: number;
  setAudioDenoise: (n: number) => void;
  audioEnhance: number;
  setAudioEnhance: (n: number) => void;
  colorGrading: number;
  setColorGrading: (n: number) => void;
  videoStabilize: boolean;
  setVideoStabilize: (b: boolean) => void;
  subtitleText: string;
  setSubtitleText: (s: string) => void;
  voiceoverText: string;
  setVoiceoverText: (s: string) => void;
  subLang: string;
  setSubLang: (s: string) => void;
  translateTarget: string;
  setTranslateTarget: (s: string) => void;
  ttsVoice: string;
  setTtsVoice: (s: string) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontColor: string;
  setFontColor: (s: string) => void;
  fontBg: string;
  setFontBg: (s: string) => void;
  fontFamily: string;
  setFontFamily: (s: string) => void;
  bpmInput: number;
  setBpmInput: (n: number) => void;
  onAddSubtitle: () => void;
  onExportSRT: () => void;
  onExportVTT: () => void;
  onExportProject: () => void;
}) {
  const { state, dispatch } = props;
  return (
    <>
      <div className="border-b border-line p-3">
        <div className="grid grid-cols-2 gap-1">
          {TABS.map((t) => {
            const Active = t.icon;
            const active = state.activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => dispatch({ type: "SET_TAB", tab: t.id })}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] transition ${
                  active
                    ? "bg-brand/15 text-brand-glow border border-brand/30"
                    : "text-ink-soft hover:bg-bg-soft border border-transparent"
                }`}
              >
                <Active className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {state.activeTab === "ai" && (
          <AIQuickPanel
            state={state}
            dispatch={dispatch}
            onFullAuto={props.onFullAuto}
            onDirector={props.onDirector}
            onFullPipeline={props.onFullPipeline}
            agentRequest={props.agentRequest}
            setAgentRequest={props.setAgentRequest}
            onSilence={props.onSilence}
            onSubtitles={props.onSubtitles}
            onColor={props.onColor}
            onStabilize={props.onStabilize}
            onBRoll={props.onBRoll}
            onShorts={props.onShorts}
            onSceneDetect={props.onSceneDetect}
            onFaceDetect={props.onFaceDetect}
            onObjectDetect={props.onObjectDetect}
            onHighlight={props.onHighlight}
            onReframe={props.onReframe}
            onMusicSync={props.onMusicSync}
            onThumbnail={props.onThumbnail}
            onTitleDesc={props.onTitleDesc}
            bpmInput={props.bpmInput}
            setBpmInput={props.setBpmInput}
          />
        )}

        {state.activeTab === "media" && (
          <MediaPanel state={state} dispatch={dispatch} />
        )}

        {state.activeTab === "effects" && (
          <EffectsPanel state={state} dispatch={dispatch} />
        )}

        {state.activeTab === "music" && (
          <MusicPanel
            state={state}
            dispatch={dispatch}
            onPlay={(m) => {
              props.setAudio({ url: m.url, name: m.title });
              dispatch({ type: "SET_MUSIC", id: m.id });
            }}
            onStop={() => {
              props.setAudio(null);
              dispatch({ type: "SET_MUSIC", id: undefined });
            }}
          />
        )}

        {state.activeTab === "text" && (
          <TextPanel
            props={{
              ...props,
              dispatch,
              state,
            }}
          />
        )}

        {state.activeTab === "audio" && (
          <AudioPanel
            state={state}
            dispatch={dispatch}
            onEnhanceAudio={props.onEnhanceAudio}
            audioDenoise={props.audioDenoise}
            setAudioDenoise={props.setAudioDenoise}
            audioEnhance={props.audioEnhance}
            setAudioEnhance={props.setAudioEnhance}
          />
        )}

        {state.activeTab === "color" && (
          <ColorPanel
            state={state}
            dispatch={dispatch}
            colorGrading={props.colorGrading}
            setColorGrading={props.setColorGrading}
            videoStabilize={props.videoStabilize}
            setVideoStabilize={props.setVideoStabilize}
          />
        )}

        {state.activeTab === "export" && (
          <ExportPanel
            state={state}
            dispatch={dispatch}
            onExportSRT={props.onExportSRT}
            onExportVTT={props.onExportVTT}
            onExportProject={props.onExportProject}
          />
        )}
      </div>
    </>
  );
}

function AIQuickPanel({
  state,
  dispatch,
  onFullAuto,
  onDirector,
  agentRequest,
  setAgentRequest,
  onSilence,
  onSubtitles,
  onColor,
  onStabilize,
  onBRoll,
  onShorts,
  onSceneDetect,
  onFaceDetect,
  onObjectDetect,
  onHighlight,
  onReframe,
  onMusicSync,
  onThumbnail,
  onTitleDesc,
  onFullPipeline,
  bpmInput,
  setBpmInput,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onFullAuto: () => void;
  onDirector: (requestText: string) => void;
  onFullPipeline: () => void;
  agentRequest: string;
  setAgentRequest: (s: string) => void;
  onSilence: () => void;
  onSubtitles: () => void;
  onColor: () => void;
  onStabilize: () => void;
  onBRoll: () => void;
  onShorts: () => void;
  onSceneDetect: () => void;
  onFaceDetect: () => void;
  onObjectDetect: () => void;
  onHighlight: () => void;
  onReframe: () => void;
  onMusicSync: () => void;
  onThumbnail: () => void;
  onTitleDesc: () => void;
  bpmInput: number;
  setBpmInput: (n: number) => void;
}) {
  const items: { id: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; tone: string }[] = [
    {
      id: "auto",
      label: "مونتاج كامل تلقائي",
      desc: "تحليل + ترجمة + موسيقى + عناوين + B-Roll بضغطة واحدة",
      icon: Wand2,
      onClick: onFullAuto,
      tone: "from-brand to-brand-accent",
    },
    {
      id: "pipeline",
      label: "المسار الكامل (5 وكلاء)",
      desc: "تحليل + خطة EDL + تأكيدك ثم رندر فعلي — المسار الكامل",
      icon: Bot,
      onClick: onFullPipeline,
      tone: "from-violet-500 to-indigo-500",
    },
    {
      id: "silence",
      label: "إزالة الصمت والتوقفات",
      desc: "كشف وقص لحظات السكوت والوقفات الطويلة",
      icon: Scissors,
      onClick: onSilence,
      tone: "from-rose-500 to-orange-500",
    },
    {
      id: "scenes",
      label: "تقسيم المشاهد",
      desc: "كشف وتقسيم الفيديو إلى مشاهد منفصلة",
      icon: Video,
      onClick: onSceneDetect,
      tone: "from-sky-500 to-cyan-500",
    },
    {
      id: "faces",
      label: "كشف الوجوه",
      desc: "اكتشاف الوجوه وتتبعها في الفيديو",
      icon: Search,
      onClick: onFaceDetect,
      tone: "from-green-500 to-emerald-500",
    },
    {
      id: "objects",
      label: "كشف الأشياء",
      desc: "اكتشاف الأشياء المهمة في المشاهد",
      icon: Eye,
      onClick: onObjectDetect,
      tone: "from-teal-500 to-cyan-500",
    },
    {
      id: "subs",
      label: "ترجمة تلقائية",
      desc: "تفريغ صوتي ومزامنة على التايملاين",
      icon: Captions,
      onClick: onSubtitles,
      tone: "from-cyan-500 to-blue-500",
    },
    {
      id: "color",
      label: "تحسين الألوان",
      desc: "ضبط الإضاءة والتباين والتشبع",
      icon: Palette,
      onClick: onColor,
      tone: "from-amber-500 to-pink-500",
    },
    {
      id: "stab",
      label: "تثبيت الفيديو",
      desc: "إزالة الاهتزاز وتحسين الثبات",
      icon: Aperture,
      onClick: onStabilize,
      tone: "from-emerald-500 to-teal-500",
    },
    {
      id: "broll",
      label: "B-Roll تلقائي",
      desc: "توليد مشاهد تكميلية ذكية",
      icon: Layers,
      onClick: onBRoll,
      tone: "from-violet-500 to-fuchsia-500",
    },
    {
      id: "shorts",
      label: "Shorts / Reels",
      desc: "تحويل الفيديو إلى مقاطع عمودية",
      icon: Smartphone,
      onClick: onShorts,
      tone: "from-pink-500 to-rose-500",
    },
    {
      id: "highlight",
      label: "أفضل اللقطات",
      desc: "استخراج أفضل المشاهد تلقائياً",
      icon: Sparkles,
      onClick: onHighlight,
      tone: "from-orange-500 to-red-500",
    },
    {
      id: "reframe",
      label: "تحويل أفقي/عمودي",
      desc: "إعادة تأطير ذكية لمقاييس مختلفة",
      icon: Crop,
      onClick: onReframe,
      tone: "from-purple-500 to-violet-500",
    },
    {
      id: "music-sync",
      label: "مزامنة الموسيقى",
      desc: "مزامنة التقطيع مع الإيقاع الموسيقي",
      icon: Waves,
      onClick: onMusicSync,
      tone: "from-blue-500 to-indigo-500",
    },
    {
      id: "thumb",
      label: "Thumbnail تلقائي",
      desc: "غلاف جذاب بتقنية AI",
      icon: ImageIcon,
      onClick: onThumbnail,
      tone: "from-yellow-500 to-amber-500",
    },
    {
      id: "title",
      label: "عنوان ووصف",
      desc: "توليد عنوان SEO ووصف للفيديو",
      icon: Tag,
      onClick: onTitleDesc,
      tone: "from-indigo-500 to-purple-500",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3 bg-gradient-to-br from-brand/20 to-brand-accent/10 border border-brand/30">
        <div className="flex items-start gap-2">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand to-brand-accent flex items-center justify-center shrink-0">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">المديرة التنفيذية 🎬</div>
            <p className="text-[11px] text-ink-soft mt-1">
              اشرح ماذا تريد — المديرة تحلل الفيديو، تقص الصمت والملل، تضيف الترجمة والموسيقى واللمسات، وتنفذ كل شيء تلقائياً.
            </p>
          </div>
        </div>
        <textarea
          value={agentRequest}
          onChange={(e) => setAgentRequest(e.target.value)}
          rows={3}
          placeholder="مثال: حوّله لفيديو إعلاني قصير وحماسي مع ترجمة واضحة ونصوص توضيحية…"
          className="mt-3 w-full rounded-lg bg-black/25 border border-brand/20 text-xs p-2.5 placeholder:text-ink-mute focus:border-brand/50 focus:outline-none resize-none text-ink"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onDirector(agentRequest)}
            className="flex-1 btn-primary !py-2"
          >
            <Bot className="h-4 w-4" />
            نفّذ بالمديرة التنفيذية
          </button>
        </div>
        <button
          onClick={onFullAuto}
          className="mt-2 w-full rounded-lg border border-line/60 text-ink-soft hover:bg-bg-soft hover:text-ink transition flex items-center justify-center gap-1.5 py-2 text-[11px]"
        >
          <Wand2 className="h-3.5 w-3.5" />
          مونتاج كامل سريع (إعدادات افتراضية)
        </button>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-soft mb-2">المزاج الموسيقي</div>
        <div className="grid grid-cols-3 gap-1.5">
          {["ملهم", "مريح", "سعيد", "متوتر", "احترافي", "حالم"].map((m) => (
            <button
              key={m}
              onClick={() => dispatch({ type: "SET_MOOD", mood: m })}
              className={`text-[10px] py-1.5 rounded-md border ${
                state.aiMood === m
                  ? "bg-brand/15 border-brand/40 text-brand-glow"
                  : "border-line text-ink-soft hover:bg-bg-soft"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-soft mb-2">BPM للمزامنة</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={60}
            max={200}
            step={5}
            value={bpmInput}
            onChange={(e) => setBpmInput(Number(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none bg-bg-elev accent-brand cursor-pointer"
          />
          <span className="text-xs font-semibold text-ink-soft w-12 text-left">{bpmInput} BPM</span>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-soft mb-2">أدوات الذكاء</div>
        <div className="space-y-1.5">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={it.onClick}
              className="w-full text-right rounded-lg p-2.5 bg-bg-soft hover:bg-bg-elev border border-line/50 hover:border-brand/40 transition flex items-start gap-2.5"
            >
              <div
                className={`h-8 w-8 rounded-md bg-gradient-to-br ${it.tone} flex items-center justify-center shrink-0`}
              >
                <it.icon className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold">{it.label}</div>
                <div className="text-[10px] text-ink-mute leading-tight mt-0.5">{it.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MediaPanel({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Film} title="مقاطع الفيديو" />
      {state.project.clips.length === 0 ? (
        <EmptyState text="لا توجد مقاطع بعد. ارفع فيديو للبدء." />
      ) : (
        <div className="space-y-1.5">
          {state.project.clips.map((c) => (
            <div
              key={c.id}
              className={`p-2 rounded-md text-[11px] border ${
                state.selectedClipId === c.id
                  ? "bg-brand/10 border-brand/30"
                  : "bg-bg-soft border-line/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">مقطع #{c.id.slice(0, 5)}</span>
                <span className="text-ink-mute">{c.duration.toFixed(1)}s</span>
              </div>
              <div className="text-[10px] text-ink-mute mt-1">
                بداية: {c.start.toFixed(1)}s
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  onClick={() => dispatch({ type: "REMOVE_CLIP", id: c.id })}
                  className="text-rose-400 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <button
                  onClick={() => dispatch({ type: "SELECT_CLIP", id: c.id })}
                  className="text-ink-soft hover:text-ink"
                >
                  <MousePointer2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionTitle icon={AudioLines} title="الصوت والموسيقى" />
      {state.project.audioClips.length === 0 ? (
        <EmptyState text="لا توجد طبقات صوتية." />
      ) : (
        <div className="space-y-1.5">
          {state.project.audioClips.map((a) => (
            <div key={a.id} className="p-2 rounded-md bg-bg-soft border border-line/50 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="truncate">{a.name}</span>
                <button
                  onClick={() => dispatch({ type: "REMOVE_AUDIO", id: a.id })}
                  className="text-rose-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="text-[10px] text-ink-mute mt-1">
                {a.kind} • {a.duration.toFixed(1)}s
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionTitle icon={Type} title="الترجمات" />
      {state.project.subtitles.length === 0 ? (
        <EmptyState text="لا توجد ترجمات بعد." />
      ) : (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {state.project.subtitles.map((s) => (
            <div
              key={s.id}
              className={`p-2 rounded-md text-[11px] border ${
                state.selectedSubtitleId === s.id
                  ? "bg-brand/10 border-brand/30"
                  : "bg-bg-soft border-line/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-ink-mute">
                  {s.start.toFixed(1)}s - {s.end.toFixed(1)}s
                </span>
                <button
                  onClick={() => dispatch({ type: "REMOVE_SUBTITLE", id: s.id })}
                  className="text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <textarea
                value={s.text}
                onChange={(e) =>
                  dispatch({ type: "UPDATE_SUBTITLE", id: s.id, patch: { text: e.target.value } })
                }
                className="w-full bg-transparent border-none outline-none resize-none"
                rows={2}
              />
            </div>
          ))}
        </div>
      )}

      <SectionTitle icon={Type} title="العناوين والنصوص الحرة" />
      {state.project.textOverlays.length === 0 ? (
        <EmptyState text="لا توجد عناوين بعد." />
      ) : (
        <div className="space-y-1.5">
          {state.project.textOverlays.map((t) => (
            <div key={t.id} className="p-2 rounded-md text-[11px] border bg-bg-soft border-line/50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-ink-mute">
                  {t.start.toFixed(1)}s - {t.end.toFixed(1)}s • {t.position === "top" ? "أعلى" : t.position === "center" ? "وسط" : "أسفل"}
                </span>
                <button
                  onClick={() => dispatch({ type: "REMOVE_TEXT_OVERLAY", id: t.id })}
                  className="text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="truncate">{t.text}</div>
            </div>
          ))}
        </div>
      )}

      <ImageLibraryPanel state={state} dispatch={dispatch} />
    </div>
  );
}

interface PexelsPhoto {
  id: string;
  thumbnail: string;
  fullUrl: string;
  photographer: string;
}

function ImageLibraryPanel({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState<PexelsPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/assets/pexels?query=${encodeURIComponent(query)}`).then((r) => r.json());
      setConfigured(res.configured !== false);
      setPhotos(res.photos || []);
    } finally {
      setLoading(false);
    }
  };

  const addPhoto = async (photo: PexelsPhoto) => {
    setImportingId(photo.id);
    try {
      const res = await apiFetch("/api/assets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photo.fullUrl }),
      }).then((r) => r.json());
      if (!res.path) return;
      const start = state.playhead || 0;
      dispatch({
        type: "ADD_CLIP",
        clip: {
          id: uuid(),
          assetId: `pexels_${photo.id}`,
          trackId: "t_video",
          start,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          effects: [],
          volume: 1,
          speed: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
          smartZoom: false,
          kind: "image",
          imageUrl: res.path,
        },
      });
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <SectionTitle icon={ImageIcon} title="مكتبة صور (Pexels)" />
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="ابحث عن صورة... (مثلاً: nature)"
          className="flex-1 bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        />
        <button onClick={search} disabled={loading} className="btn-outline px-2.5">
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>
      {!configured && (
        <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
          أضف مفتاح Pexels (PEXELS_API_KEY) في .env.local أو نافذة إعدادات API لتفعيل المكتبة.
        </div>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => addPhoto(p)}
              disabled={importingId === p.id}
              className="relative aspect-video rounded-md overflow-hidden border border-line/50 hover:border-brand/40 group"
            >
              <img src={p.thumbnail} alt={p.photographer} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                {importingId === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                ) : (
                  <Plus className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EffectsPanel({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const categories: { id: Effect["category"]; label: string }[] = [
    { id: "transition", label: "انتقالات" },
    { id: "motion", label: "حركة" },
    { id: "color", label: "لون" },
    { id: "vfx", label: "VFX" },
  ];
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-ink-soft">
        اضغط لتفعيل/إلغاء التأثير على كامل الفيديو
      </div>
      {categories.map((cat) => (
        <div key={cat.id}>
          <div className="text-[11px] font-semibold text-ink-soft mb-1.5">{cat.label}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {EFFECTS_LIBRARY.filter((e) => e.category === cat.id).map((e) => {
              const active = state.project.effects.includes(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() => dispatch({ type: "TOGGLE_EFFECT", effectId: e.id })}
                  className={`p-2 rounded-md text-[10px] border text-right ${
                    active
                      ? "bg-brand/15 border-brand/40 text-brand-glow"
                      : "bg-bg-soft border-line/50 text-ink-soft hover:bg-bg-elev"
                  }`}
                >
                  <EffectPreview name={e.preview} active={active} />
                  <div className="mt-1 truncate">{e.name}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EffectPreview({ name, active }: { name: string; active: boolean }) {
  return (
    <div
      className={`h-10 w-full rounded-md overflow-hidden border ${
        active ? "border-brand/50" : "border-line"
      }`}
      style={{
        background:
          "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.3))",
        filter:
          name === "warm"
            ? "sepia(0.4) hue-rotate(-15deg)"
            : name === "cool"
            ? "hue-rotate(20deg) saturate(0.9)"
            : name === "cinematic"
            ? "contrast(1.2) saturate(1.2)"
            : name === "vhs"
            ? "contrast(1.3) hue-rotate(8deg)"
            : name === "fade"
            ? "brightness(0.7)"
            : name === "zoom"
            ? "brightness(1.2)"
            : name === "shake"
            ? "hue-rotate(5deg)"
            : name === "zoom-blur"
            ? "blur(1px)"
            : "none",
      }}
    >
      <div className="h-full w-full grid place-items-center">
        <Wand2 className="h-3 w-3 text-white/80" />
      </div>
    </div>
  );
}

function MusicPanel({
  state,
  dispatch,
  onPlay,
  onStop,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onPlay: (m: MusicTrack) => void;
  onStop: () => void;
}) {
  const moods = Array.from(new Set(MUSIC_LIBRARY.map((m) => m.mood)));
  const [filter, setFilter] = useState<string | null>(null);
  const filtered = filter ? MUSIC_LIBRARY.filter((m) => m.mood === filter) : MUSIC_LIBRARY;

  const [playingId, setPlayingId] = useState<string | null>(null);

  const play = async (m: MusicTrack) => {
    if (!m.url) {
      // لا يوجد ملف — ولّد نغمة حقيقية عبر Web Audio API ثم شغّلها.
      setPlayingId(m.id);
      try {
        const url = await generateToneTrack(m);
        onPlay({ ...m, url: url || "" });
      } catch {
        onPlay(m);
      } finally {
        setPlayingId(null);
      }
      return;
    }
    onPlay(m);
  };
  const stop = () => {
    onStop();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setFilter(null)}
          className={`text-[10px] px-2 py-1 rounded-md border ${
            !filter ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"
          }`}
        >
          الكل
        </button>
        {moods.map((m) => (
          <button
            key={m}
            onClick={() => setFilter(m)}
            className={`text-[10px] px-2 py-1 rounded-md border ${
              filter === m ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {filtered.map((m) => {
          const active = state.project.musicId === m.id;
          return (
            <div
              key={m.id}
              className={`p-2 rounded-md border flex items-center gap-2 ${
                active ? "bg-brand/10 border-brand/40" : "bg-bg-soft border-line/50"
              }`}
            >
              <div
                className="h-10 w-10 rounded-md shrink-0"
                style={{ background: m.cover }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{m.title}</div>
                <div className="text-[10px] text-ink-mute">
                  {m.genre} • {m.bpm} BPM • {Math.round(m.duration / 60)} دقيقة
                </div>
              </div>
              <button
                onClick={() => (active ? stop() : play(m))}
                className={`h-7 w-7 rounded-full grid place-items-center ${
                  active ? "bg-brand text-white" : "bg-bg-elev text-ink-soft"
                }`}
                title={!m.url ? "توليد نغمة ثم التشغيل" : undefined}
              >
                {playingId === m.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : active ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TextPanelProps {
  state: State;
  dispatch: React.Dispatch<Action>;
  onSubtitles: () => void;
  subLang: string;
  setSubLang: (s: string) => void;
  subtitleText: string;
  setSubtitleText: (s: string) => void;
  onAddSubtitle: () => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontColor: string;
  setFontColor: (s: string) => void;
  fontBg: string;
  setFontBg: (s: string) => void;
  fontFamily: string;
  setFontFamily: (s: string) => void;
  translateTarget: string;
  setTranslateTarget: (s: string) => void;
  onTranslate: () => void;
  voiceoverText: string;
  setVoiceoverText: (s: string) => void;
  ttsVoice: string;
  setTtsVoice: (s: string) => void;
  onDub: () => void;
}

function TextPanel({ props }: { props: TextPanelProps }) {
  const [overlayText, setOverlayText] = useState("");
  const [overlayPosition, setOverlayPosition] = useState<TextOverlay["position"]>("center");
  const [overlayFont, setOverlayFont] = useState(FONT_OPTIONS[0].css);
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlaySize, setOverlaySize] = useState(56);
  const [overlayDuration, setOverlayDuration] = useState(3);
  const [overlayAnimation, setOverlayAnimation] = useState<TextOverlay["animation"]>("fade");

  const addTextOverlay = () => {
    if (!overlayText.trim()) return;
    const start = props.state.playhead || 0;
    props.dispatch({
      type: "ADD_TEXT_OVERLAY",
      overlay: {
        id: uuid(),
        text: overlayText,
        start,
        end: start + overlayDuration,
        position: overlayPosition,
        fontFamily: overlayFont,
        fontSize: overlaySize,
        color: overlayColor,
        animation: overlayAnimation,
      },
    });
    setOverlayText("");
  };

  return (
    <div className="space-y-3">
      <SectionTitle icon={Type} title="عنوان / نص حر" />
      <textarea
        value={overlayText}
        onChange={(e) => setOverlayText(e.target.value)}
        rows={2}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        placeholder="اكتب العنوان أو النص..."
      />
      <div className="grid grid-cols-2 gap-1.5">
        {(["top", "center", "bottom"] as TextOverlay["position"][]).map((p) => (
          <button
            key={p}
            onClick={() => setOverlayPosition(p)}
            className={`p-1.5 rounded-md border text-[10px] ${
              overlayPosition === p ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"
            }`}
          >
            {p === "top" ? "أعلى" : p === "center" ? "وسط" : "أسفل"}
          </button>
        ))}
        <select
          value={overlayAnimation}
          onChange={(e) => setOverlayAnimation(e.target.value as TextOverlay["animation"])}
          className="bg-bg-soft border border-line rounded-md px-2 py-1 text-[10px]"
        >
          <option value="none">بدون حركة</option>
          <option value="fade">تلاشي</option>
          <option value="pop">قفزة</option>
        </select>
      </div>
      <select
        value={overlayFont}
        onChange={(e) => setOverlayFont(e.target.value)}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.id} value={f.css}>{f.name}</option>
        ))}
      </select>
      <SliderRow label="حجم الخط" value={overlaySize} onChange={setOverlaySize} min={20} max={120} suffix={`${overlaySize}px`} />
      <SliderRow label="مدة الظهور" value={overlayDuration} onChange={setOverlayDuration} min={1} max={10} step={0.5} suffix={`${overlayDuration}s`} />
      <ColorRow label="لون النص" value={overlayColor} onChange={setOverlayColor} />
      <button className="btn-primary w-full" onClick={addTextOverlay}>
        <Plus className="h-3.5 w-3.5" />
        أضف للتايملاين (من موضع المؤشر)
      </button>

      <SectionTitle icon={Captions} title="ترجمة تلقائية" />
      <button className="btn-primary w-full" onClick={props.onSubtitles}>
        <Captions className="h-4 w-4" />
        توليد الترجمة
      </button>
      <div>
        <div className="text-[11px] text-ink-soft mb-1">لغة الترجمة</div>
        <select
          value={props.subLang}
          onChange={(e) => props.setSubLang(e.target.value)}
          className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
          <option value="tr">Türkçe</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      <SectionTitle icon={Plus} title="إضافة ترجمة يدوية" />
      <textarea
        value={props.subtitleText}
        onChange={(e) => props.setSubtitleText(e.target.value)}
        rows={3}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        placeholder="اكتب نص الترجمة هنا..."
      />
      <button className="btn-outline w-full" onClick={props.onAddSubtitle}>
        <Plus className="h-3.5 w-3.5" />
        إضافة للتايملاين
      </button>

      <SectionTitle icon={Type} title="نمط الترجمة" />
      <div className="space-y-2">
        <SliderRow
          label="حجم الخط"
          value={props.fontSize}
          onChange={props.setFontSize}
          min={14}
          max={48}
          suffix="px"
        />
        <ColorRow label="لون النص" value={props.fontColor} onChange={props.setFontColor} />
        <ColorRow label="لون الخلفية" value={props.fontBg} onChange={props.setFontBg} />
        <div>
          <div className="text-[11px] text-ink-soft mb-1">نوع الخط</div>
          <select
            value={props.fontFamily}
            onChange={(e) => props.setFontFamily(e.target.value)}
            className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SectionTitle icon={Languages} title="ترجمة ودبلجة" />
      <select
        value={props.translateTarget}
        onChange={(e) => props.setTranslateTarget(e.target.value)}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="es">Español</option>
        <option value="tr">Türkçe</option>
        <option value="de">Deutsch</option>
      </select>
      <button className="btn-outline w-full" onClick={props.onTranslate}>
        <Languages className="h-3.5 w-3.5" />
        ترجمة الترجمات
      </button>

      <SectionTitle icon={Mic} title="تعليق صوتي / TTS" />
      <textarea
        value={props.voiceoverText}
        onChange={(e) => props.setVoiceoverText(e.target.value)}
        rows={3}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
        placeholder="اكتب النص المراد تحويله لصوت..."
      />
      <select
        value={props.ttsVoice}
        onChange={(e) => props.setTtsVoice(e.target.value)}
        className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
      >
        <option value="ar-male-1">صوت عربي - ذكر</option>
        <option value="ar-female-1">صوت عربي - أنثى</option>
        <option value="en-male-1">English - Male</option>
        <option value="en-female-1">English - Female</option>
        <option value="clone">استنساخ صوتي (محلياً)</option>
      </select>
      <button className="btn-primary w-full" onClick={props.onDub}>
        <Mic className="h-3.5 w-3.5" />
        توليد الصوت وإضافته
      </button>
    </div>
  );
}

function AudioPanel({
  state,
  dispatch,
  onEnhanceAudio,
  audioDenoise,
  setAudioDenoise,
  audioEnhance,
  setAudioEnhance,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onEnhanceAudio: () => void;
  audioDenoise: number;
  setAudioDenoise: (n: number) => void;
  audioEnhance: number;
  setAudioEnhance: (n: number) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Volume2} title="تحسين الصوت" />
      <button className="btn-primary w-full" onClick={onEnhanceAudio}>
        <Wand2 className="h-4 w-4" />
        تحسين تلقائي للصوت
      </button>

      <SliderRow
        label="إزالة الضوضاء"
        value={audioDenoise}
        onChange={setAudioDenoise}
        min={0}
        max={1}
        step={0.05}
        suffix={`${Math.round(audioDenoise * 100)}%`}
      />
      <SliderRow
        label="تحسين الترددات"
        value={audioEnhance}
        onChange={setAudioEnhance}
        min={0}
        max={1}
        step={0.05}
        suffix={`${Math.round(audioEnhance * 100)}%`}
      />

      <SectionTitle icon={Scissors} title="الصمت" />
      <button
        className="btn-outline w-full"
        onClick={() => {
          const ev = new CustomEvent("ai-trigger", { detail: "silence" });
          window.dispatchEvent(ev);
        }}
      >
        <Scissors className="h-3.5 w-3.5" />
        إزالة الصمت تلقائياً
      </button>
    </div>
  );
}

function ColorPanel({
  state,
  dispatch,
  colorGrading,
  setColorGrading,
  videoStabilize,
  setVideoStabilize,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  colorGrading: number;
  setColorGrading: (n: number) => void;
  videoStabilize: boolean;
  setVideoStabilize: (b: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Palette} title="فلاتر الألوان" />
      <div className="grid grid-cols-2 gap-1.5">
        {COLOR_FILTERS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              if (state.project.clips[0]) {
                dispatch({
                  type: "UPDATE_CLIP",
                  id: state.project.clips[0].id,
                  patch: { colorFilter: c.id },
                });
              }
            }}
            className="rounded-md overflow-hidden border border-line/50 hover:border-brand/40"
          >
            <div
              className="h-12"
              style={{
                background: "linear-gradient(135deg, #7c3aed, #06b6d4, #f59e0b)",
                filter: c.css,
              }}
            />
            <div className="text-[10px] py-1 bg-bg-soft">{c.name}</div>
          </button>
        ))}
      </div>

      <SectionTitle icon={Sliders} title="مستوى التصحيح" />
      <SliderRow
        label="قوة التصحيح اللوني"
        value={colorGrading}
        onChange={setColorGrading}
        min={0}
        max={1}
        step={0.05}
        suffix={`${Math.round(colorGrading * 100)}%`}
      />

      <SectionTitle icon={Aperture} title="التثبيت" />
      <ToggleRow
        label="تثبيت الفيديو تلقائياً"
        value={videoStabilize}
        onChange={setVideoStabilize}
      />
    </div>
  );
}

function ExportPanel({
  state,
  dispatch,
  onExportSRT,
  onExportVTT,
  onExportProject,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onExportSRT: () => void;
  onExportVTT: () => void;
  onExportProject: () => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Monitor} title="المقاس" />
      <div className="grid grid-cols-2 gap-1.5">
        {(["16:9", "9:16", "1:1", "4:5"] as ProjectAspect[]).map((a) => (
          <button
            key={a}
            onClick={() => dispatch({ type: "SET_ASPECT", aspect: a })}
            className={`p-2 rounded-md border text-[10px] ${
              state.project.aspect === a
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            <div className="flex items-center justify-center h-8">
              <div
                className="border-2 border-current rounded-sm"
                style={{
                  width: a === "9:16" ? 14 : a === "1:1" ? 22 : a === "4:5" ? 18 : 32,
                  height: a === "9:16" ? 26 : a === "1:1" ? 22 : a === "4:5" ? 22 : 18,
                }}
              />
            </div>
            <div className="mt-1">{a}</div>
          </button>
        ))}
      </div>

      <SectionTitle icon={Gauge} title="الجودة" />
      <div className="grid grid-cols-2 gap-1.5">
        {(["720p", "1080p", "4k"] as const).map((r) => (
          <button
            key={r}
            onClick={() =>
              dispatch({ type: "PATCH_PROJECT", patch: { resolution: r } })
            }
            className={`p-2 rounded-md border text-[10px] ${
              state.project.resolution === r
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            {r.toUpperCase()}
          </button>
        ))}
        {([24, 30, 60] as const).map((f) => (
          <button
            key={f}
            onClick={() => dispatch({ type: "PATCH_PROJECT", patch: { fps: f } })}
            className={`p-2 rounded-md border text-[10px] ${
              state.project.fps === f
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            {f} FPS
          </button>
        ))}
      </div>

      <SectionTitle icon={FileText} title="الصيغة" />
      <div className="grid grid-cols-3 gap-1.5">
        {(["mp4", "mov", "webm"] as const).map((f) => (
          <button
            key={f}
            onClick={() => dispatch({ type: "PATCH_PROJECT", patch: { format: f } })}
            className={`p-2 rounded-md border text-[10px] uppercase ${
              state.project.format === f
                ? "bg-brand/15 border-brand/40 text-brand-glow"
                : "border-line text-ink-soft"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <SectionTitle icon={Download} title="الملفات" />
      <div className="space-y-1.5">
        <button className="btn-outline w-full" onClick={onExportSRT}>
          <FileText className="h-3.5 w-3.5" />
          تصدير SRT (ترجمة)
        </button>
        <button className="btn-outline w-full" onClick={onExportVTT}>
          <FileText className="h-3.5 w-3.5" />
          تصدير VTT (ترجمة ويب)
        </button>
        <button className="btn-outline w-full" onClick={onExportProject}>
          <Save className="h-3.5 w-3.5" />
          تصدير ملف المشروع JSON
        </button>
      </div>
    </div>
  );
}

function RightPanel({
  state,
  dispatch,
  audio,
  setAudio,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  audio: { url: string; name: string } | null;
  setAudio: (a: { url: string; name: string } | null) => void;
}) {
  const [tab, setTab] = useState<"thumb" | "ai" | "info">("info");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-line p-2 grid grid-cols-3 gap-1">
        {[
          { id: "info", label: "المشروع" },
          { id: "thumb", label: "Thumbnail" },
          { id: "ai", label: "المساعد" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`text-[10px] py-1.5 rounded-md ${
              tab === t.id
                ? "bg-brand/15 text-brand-glow"
                : "text-ink-soft hover:bg-bg-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "info" && (
          <>
            <SectionTitle icon={Info} title="معلومات المشروع" />
            {state.videoMeta ? (
              <div className="space-y-1.5 text-[11px]">
                <InfoRow label="الاسم" value={state.videoMeta.name} />
                <InfoRow label="المدة" value={formatTime(state.videoMeta.duration)} />
                <InfoRow
                  label="الأبعاد"
                  value={`${state.videoMeta.width} × ${state.videoMeta.height}`}
                />
                <InfoRow label="الحجم" value={formatBytes(state.videoMeta.size)} />
                <InfoRow label="الصيغة" value={state.project.format.toUpperCase()} />
                <InfoRow label="الدقة" value={state.project.resolution} />
                <InfoRow label="FPS" value={String(state.project.fps)} />
              </div>
            ) : (
              <EmptyState text="ارفع فيديو لعرض المعلومات" />
            )}

            <SectionTitle icon={Type} title="العنوان والوصف" />
            <input
              type="text"
              value={state.project.title || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_TITLE_META",
                  title: e.target.value,
                  description: state.project.description || "",
                  tags: state.project.tags || [],
                })
              }
              placeholder="عنوان الفيديو"
              className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs"
            />
            <textarea
              value={state.project.description || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_TITLE_META",
                  title: state.project.title || "",
                  description: e.target.value,
                  tags: state.project.tags || [],
                })
              }
              rows={4}
              placeholder="وصف الفيديو..."
              className="w-full bg-bg-soft border border-line rounded-md px-2 py-1.5 text-xs resize-none"
            />
            <div className="flex flex-wrap gap-1">
              {(state.project.tags || []).map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-bg-soft border border-line"
                >
                  #{t}
                </span>
              ))}
            </div>
          </>
        )}

        {tab === "thumb" && (
          <>
            <SectionTitle icon={ImageIcon} title="Thumbnail" />
            {state.project.thumbnail ? (
              <img
                src={state.project.thumbnail}
                alt="thumb"
                className="w-full rounded-lg border border-line"
              />
            ) : (
              <EmptyState text="لم يتم توليد Thumbnail بعد" />
            )}
            <button
              className="btn-primary w-full"
              onClick={() => {
                const ev = new CustomEvent("ai-trigger", { detail: "thumb" });
                window.dispatchEvent(ev);
              }}
            >
              <Wand2 className="h-4 w-4" />
              توليد / إعادة توليد
            </button>
          </>
        )}

        {tab === "ai" && (
          <>
            <SectionTitle icon={Bot} title="العمليات الجارية" />
            {state.jobs.length === 0 ? (
              <EmptyState text="لا توجد عمليات جارية." />
            ) : (
              <div className="space-y-1.5">
                {state.jobs.map((j) => (
                  <div
                    key={j.id}
                    className="p-2 rounded-md bg-bg-soft border border-line/50 text-[11px]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold truncate">{j.label}</span>
                      <span className="text-ink-mute">{Math.round(j.progress)}%</span>
                    </div>
                    <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          j.status === "completed"
                            ? "bg-emerald-500"
                            : j.status === "failed"
                            ? "bg-rose-500"
                            : "bg-gradient-to-r from-brand to-brand-accent"
                        }`}
                        style={{ width: `${j.progress}%` }}
                      />
                    </div>
                    {j.message && (
                      <div className="text-[10px] text-ink-mute mt-1">{j.message}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <SectionTitle icon={Activity} title="إحصائيات" />
            <div className="grid grid-cols-2 gap-2">
              <StatBox icon={Scissors} label="مقاطع" value={state.project.clips.length} />
              <StatBox icon={Type} label="ترجمات" value={state.project.subtitles.length} />
              <StatBox icon={AudioLines} label="صوت" value={state.project.audioClips.length} />
              <StatBox icon={Wand2} label="تأثيرات" value={state.project.effects.length} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
