// معالجات أدوات الذكاء — مستخرجة من Editor.tsx بنقل حرفي بلا تغيير سلوك.
// دوال عادية (ليست hooks) تُنشأ في كل render وتغلق على أحدث state عبر ctx، تماماً كما كانت داخل المكوّن.
import { v4 as uuid } from "uuid";
import { MUSIC_LIBRARY, generateToneTrack } from "@/lib/mockAi";
import { apiFetch } from "@/lib/api-config";
import { uploadFileRaw } from "@/lib/client/upload";
import {
  analyzeVideo,
  captureFrame,
  generateSubtitles,
  generateMetadata,
  translateTexts,
  mockProgress,
} from "@/lib/ai/client";
import type { CeoResponse } from "@/lib/agents/types";
import type { State, Action } from "./state";

import type { NotifyFn, Setter } from "./ctx-types";

type RunAIJob = (kind: string, label: string, run: (update: (p: number, msg?: string) => void) => Promise<unknown>) => Promise<unknown>;

export interface AiActionsContext {
  state: State;
  dispatch: React.Dispatch<Action>;
  notify: NotifyFn;
  totalDuration: number;
  runAIJob: RunAIJob;
  voiceoverText: string;
  translateTarget: string;
  subLang: string;
  ttsVoice: string;
  fontColor: string;
  fontFamily: string;
  fontSize: number;
  agentRequest: string;
  audioEnhance: number;
  audioDenoise: number;
  bpmInput: number;
  serverSourceRef: string | null;
  setServerSourceRef: Setter<string | null>;
  setPipelinePlan: Setter<Record<string, unknown> | null>;
  setPipelineRender: Setter<Record<string, unknown> | null>;
  setShowPipelineModal: Setter<boolean>;
  setVideoStabilize: Setter<boolean>;
  setAudio: Setter<{ url: string; name: string } | null>;
}

export function createAiActions(ctx: AiActionsContext) {
  const {
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
  } = ctx;

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
      if (data.sourceRef) setServerSourceRef(data.sourceRef);

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
      let sourcePath = serverSourceRef;
      if (!sourcePath) {
        const uploadRes = await uploadFileRaw("/api/ffmpeg/probe", videoFile).then((r) => r.json());
        if (!uploadRes?.ref) throw new Error(uploadRes?.error || "فشل رفع الفيديو للتحليل");
        sourcePath = uploadRes.ref as string;
        setServerSourceRef(sourcePath);
      }
      const res = await apiFetch("/api/ai/silence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: totalDuration, sourceRef: sourcePath }),
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
      let cursor2 = 0;
      keeps.forEach((k) => {
        const start = cursor2;
        cursor2 += Math.max(0.2, k.end - k.start);
        dispatch({
          type: "ADD_CLIP",
          clip: {
            id: uuid(),
            assetId: "main",
            trackId: "t_video",
            start, // تتابع بلا فجوات = نفس ترتيب ومدد خطة التصدير
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
          // مسار علامات (fx) لا يدخل التصدير — كان مسار video فيُلصق بداية الفيديو مكرّرة.
          track: { id: trackId, kind: "fx", label: "المشاهد", height: 40, muted: false, locked: true },
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
              inPoint: s.start,
              outPoint: s.end,
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

  return {
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
  };
}
