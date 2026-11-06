// التصدير (تصدير كامل/معاينة مرندرة/إلغاء) ومراجع المصادر — مستخرجة من Editor.tsx بنقل حرفي بلا تغيير سلوك.
// دوال عادية (ليست hooks) تُنشأ في كل render وتغلق على أحدث state عبر ctx، تماماً كما كانت داخل المكوّن.
import { findLostAudio } from "@/lib/engine/export-guard";
import { ensureAudioRefs } from "@/lib/client/audio-upload";
import { apiFetch } from "@/lib/api-config";
import { uploadFileRaw } from "@/lib/client/upload";
import { timelineDuration } from "@/lib/engine/timeline";
import type { NotifyFn, Setter } from "./ctx-types";
import type { State } from "./state";

export interface ExportActionsContext {
  state: State;
  notify: NotifyFn;
  colorGrading: number;
  videoStabilize: boolean;
  serverSourceRef: string | null;
  exportJobRef: React.MutableRefObject<string | null>;
  exportCancelledRef: React.MutableRefObject<boolean>;
  setExportProgress: Setter<number>;
  setExportResult: Setter<{ name: string; size: number; jobId?: string } | null>;
  setIsExporting: Setter<boolean>;
  setRenderedPreview: Setter<{ url: string; start: number; end: number } | null>;
  setServerSourceRef: Setter<string | null>;
}

export function createExportActions(ctx: ExportActionsContext) {
  const {
    state,
    notify,
    colorGrading,
    videoStabilize,
    serverSourceRef,
    exportJobRef,
    exportCancelledRef,
    setExportProgress,
    setExportResult,
    setIsExporting,
    setRenderedPreview,
    setServerSourceRef,
  } = ctx;

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

  return {
    startExport,
    startRenderedPreview,
    cancelExport,
  };
}
