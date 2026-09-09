"use client";

import { useState } from "react";
import {
  X,
  Bot,
  Brain,
  Film,
  FileText,
  Captions,
  Music2,
  Download,
  Loader2,
  Share2,
  CheckCircle2,
  AlertCircle,
  Info,
} from "lucide-react";
import { formatTime, formatBytes } from "@/lib/project";
import type { SubtitleCue, AppNotification } from "@/lib/types";

export function SubtitleOverlay({
  cue,
  fontSize,
  fontColor,
  fontBg,
  fontFamily,
}: {
  cue?: SubtitleCue;
  fontSize: number;
  fontColor: string;
  fontBg: string;
  fontFamily: string;
}) {
  if (!cue) return null;
  return (
    <div className="absolute bottom-6 left-0 right-0 flex justify-center px-6 pointer-events-none">
      <div
        className="px-4 py-2 rounded-md text-center max-w-[80%]"
        style={{
          fontSize,
          color: fontColor,
          backgroundColor: fontBg + "cc",
          fontFamily,
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          lineHeight: 1.3,
        }}
      >
        {cue.text}
      </div>
    </div>
  );
}

export function EffectOverlay({ effects }: { effects: string[] }) {
  if (effects.length === 0) return null;
  return (
    <>
      {effects.includes("fx_vhs") && (
        <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-40 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_4px]" />
      )}
      {effects.includes("fx_glitch") && (
        <div className="absolute inset-0 pointer-events-none mix-blend-color-dodge opacity-20 bg-[repeating-linear-gradient(90deg,rgba(255,0,0,0.3),rgba(0,255,255,0.3)_2px,transparent_2px,transparent_4px)]" />
      )}
      {effects.includes("fx_light_leak") && (
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(255,180,80,0.25),transparent_60%)]" />
      )}
    </>
  );
}

export function Notifications({
  notifications,
  onRemove,
}: {
  notifications: AppNotification[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 left-4 z-50 space-y-2 max-w-sm">
      {notifications.map((n) => {
        const color =
          n.type === "success"
            ? "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30"
            : n.type === "error"
            ? "from-rose-500/20 to-rose-600/10 border-rose-500/30"
            : n.type === "warning"
            ? "from-amber-500/20 to-amber-600/10 border-amber-500/30"
            : "from-brand/20 to-brand-accent/10 border-brand/30";
        const Icon =
          n.type === "success"
            ? CheckCircle2
            : n.type === "error"
            ? AlertCircle
            : n.type === "warning"
            ? AlertCircle
            : Info;
        const iconColor =
          n.type === "success"
            ? "text-emerald-300"
            : n.type === "error"
            ? "text-rose-300"
            : n.type === "warning"
            ? "text-amber-300"
            : "text-brand-glow";
        return (
          <div
            key={n.id}
            className={`glass bg-gradient-to-br ${color} border rounded-lg p-3 flex items-start gap-2 shadow-panel animate-pulse-soft`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{n.title}</div>
              {n.message && <div className="text-[10px] text-ink-soft mt-0.5">{n.message}</div>}
            </div>
            <button onClick={() => onRemove(n.id)} className="text-ink-mute hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** نافذة المسار الكامل متعدد الوكلاء: التقرير ← الخطة → تأكيد ← الرندر ← الفيديو */
export function PipelineModal({
  plan,
  render,
  isRendering,
  onClose,
  onRender,
}: {
  plan: Record<string, unknown>;
  render: Record<string, unknown> | null;
  isRendering: boolean;
  onClose: () => void;
  onRender: () => void;
}) {
  const [exportFormat, setExportFormat] = useState("premiere");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  const exportNle = async () => {
    if (exporting) return;
    setExporting(true);
    setExportMsg("");
    try {
      const res = await fetch("/api/agents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, format: exportFormat, plan: edl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setExportMsg(String(err?.error || `فشل التصدير (${res.status})`));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${jobId}.${exportFormat}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg("تم تصدير الجدول الزمني لبرنامج المونتاج.");
    } catch {
      setExportMsg("تعذّر التصدير — تأكد أن auto-editor مثبت.");
    } finally {
      setExporting(false);
    }
  };
  const edl = (plan.edl || {}) as Record<string, any>;
  const analyst = (plan.analyst || {}) as Record<string, any>;
  const preview = (plan.previewStats || {}) as Record<string, number>;
  const critic = (plan.critic || {}) as Record<string, any>;
  const audio = (plan.audio || {}) as Record<string, any>;
  const audioMusic = (audio.music || {}) as Record<string, any>;
  const segments = (edl.segments || []) as any[];
  const keeps = segments.filter((s: any) => s.keep);
  const cuts = segments.length - keeps.length;
  const captions = (edl.captions || []) as any[];
  const overlays = (edl.textOverlays || []) as any[];
  const style = (edl.style || {}) as Record<string, any>;
  const jobId = String(plan.jobId || "");
  const videoUrl = render ? `/api/agents/pipeline?job=${jobId}` : null;
  const renderOk = render?.rendered === true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[86vh] flex flex-col rounded-xl border border-line bg-bg-panel shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-gradient-to-l from-violet-600/10 to-transparent">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-bold">المسار الكامل متعدد الوكلاء</h2>
          </div>
          <button onClick={onClose} className="text-ink-soft hover:text-ink p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* الخطوة 1: التقرير والخطة */}
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-bold text-violet-400 mb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> تقرير التحليل (المحلل)
              </h3>
              <div className="grid grid-cols-4 gap-2">
                <PStat label="المدة" value={`${(analyst.duration || 0).toFixed(1)}s`} />
                <PStat label="كلمات" value={String(analyst.words?.length || 0)} />
                <PStat label="صمت" value={String(analyst.silences?.length || 0)} />
                <PStat label="وجوه" value={String(analyst.faceTracks?.length || 0)} />
              </div>
              {(analyst.transcript || "").trim() && (
                <p className="mt-2 text-[11px] text-ink-soft bg-bg-soft rounded-md p-2 border border-line line-clamp-3">
                  {String(analyst.transcript).slice(0, 220)}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-xs font-bold text-indigo-400 mb-2 flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" /> خطة EDL (المخرج)
              </h3>
              <div className="rounded-md border border-line bg-bg-soft p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{edl.title || "بدون عنوان"}</span>
                  <span className="text-[10px] text-ink-soft">
                    {keeps.length} إبقاء • {cuts} قص • {captions.length} ترجمة • {overlays.length} نص
                  </span>
                </div>
                {edl.summary && <p className="text-[11px] text-ink-soft leading-relaxed">{edl.summary}</p>}
                {preview.keptSeconds != null && (
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    <PStat label="المحتفظ به" value={`${preview.keptSeconds}s`} />
                    <PStat label="المقصّ" value={`${preview.cutSeconds}s`} />
                    <PStat label="نسبة الإبقاء" value={`${preview.keptPercent}%`} />
                    <PStat label="مقاطع" value={String(preview.clipCount || 0)} />
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25">
                    فلتر: {style.colorFilter || "none"}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                    ترجمة: {style.captionStyle || "—"} {style.captions ? "" : "(معطلة)"}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">
                    موسيقى: {String(style.musicMood || "—")}
                  </span>
                </div>
              </div>
            </div>

            {captions.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-cyan-400 mb-2 flex items-center gap-1.5">
                  <Captions className="h-3.5 w-3.5" /> الترجمة ({captions.length})
                </h3>
                <div className="space-y-1">
                  {captions.slice(0, 6).map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] bg-bg-soft border border-line rounded px-2 py-1">
                      <span className="text-[9px] text-ink-soft tabular-nums shrink-0">
                        {formatTime(c.start)}–{formatTime(c.end)}
                      </span>
                      <span className="truncate">{c.text}</span>
                    </div>
                  ))}
                  {captions.length > 6 && (
                    <p className="text-[10px] text-ink-soft">+ {captions.length - 6} ترجمة أخرى…</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* الناقد الإبداعي: درجة + حكم + ملاحظات توجيهية */}
          {critic && typeof critic.score === "number" && (
            <div className="border-t border-line pt-3">
              <h3 className="text-xs font-bold text-rose-400 mb-2 flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5" /> الناقد الإبداعي
              </h3>
              <div className="rounded-md border border-line bg-bg-soft p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`text-lg font-black tabular-nums ${critic.score >= 70 ? "text-emerald-400" : critic.score >= 50 ? "text-amber-400" : "text-rose-400"}`}
                  >
                    {critic.score.toFixed(0)}
                    <span className="text-[10px] font-normal text-ink-soft">/100</span>
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      critic.verdict === "approve"
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                    }`}
                  >
                    {critic.verdict === "approve" ? "✓ معتمدة" : "↻ تحتاج مراجعة"}
                  </span>
                </div>
                {Array.isArray(critic.suggestions) && critic.suggestions.length > 0 && (
                  <ul className="space-y-1">
                    {critic.suggestions.slice(0, 4).map((s: string, i: number) => (
                      <li key={i} className="text-[11px] text-ink-soft flex gap-1.5">
                        <span className="text-rose-400/70 shrink-0">•</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* مهندس الصوت: خطة موسيقى + Ducking + ضبط LUFS */}
          {audio && typeof audioMusic.bpm === "number" && (
            <div className="border-t border-line pt-3">
              <h3 className="text-xs font-bold text-teal-400 mb-2 flex items-center gap-1.5">
                <Music2 className="h-3.5 w-3.5" /> خطة الصوت (مهندس الصوت)
              </h3>
              <div className="rounded-md border border-line bg-bg-soft p-3">
                <div className="grid grid-cols-4 gap-2">
                  <PStat label="المزاج" value={String(audioMusic.mood || "—")} />
                  <PStat label="BPM" value={String(audioMusic.bpm || "—")} />
                  <PStat label="Ducking" value={String((audio.ducking || []).length)} />
                  <PStat label="LUFS" value={`${Number(audio.loudnessLufs ?? audio.loudness_lufs ?? 0).toFixed(0)}`} />
                </div>
                {Array.isArray(audio.notes) && audio.notes.length > 0 && (
                  <p className="mt-2 text-[10px] text-ink-soft leading-relaxed">
                    {audio.notes.slice(0, 3).join(" • ")}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* الخطوة 2: نتيجة الرندر */}
          {render && (
            <div className="border-t border-line pt-4 space-y-3">
              <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Film className="h-3.5 w-3.5" /> الرندر الفعلي
              </h3>
              {renderOk && videoUrl ? (
                <>
                  <video src={videoUrl} controls className="w-full rounded-lg border border-line bg-black aspect-video" />
                  <div className="grid grid-cols-3 gap-2">
                    <PStat label="الحجم" value={formatBytes(Number(render.outputBytes ?? 0))} />
                    <PStat label="زمن الرندر" value={`${(Number(render.renderSeconds ?? 0)).toFixed(1)}s`} />
                    <PStat label="المحوّل" value={String(render.encoder || "—")} />
                  </div>
                  <a
                    href={videoUrl}
                    download={`${jobId}.mp4`}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition"
                  >
                    <Download className="h-4 w-4" /> تحميل الفيديو النهائي
                  </a>
                </>
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-ink-soft bg-bg-soft border border-line rounded-md p-3">
                  {isRendering ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                      جارٍ تنفيذ أمر ffmpeg على الخادم… قد يستغرق عدة ثوانٍ حسب طول الفيديو
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-rose-400" />
                      فشل الرندر: {String(render.renderError || render.error || "خطأ غير معروف")}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-line flex items-center justify-between gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-ink-soft hover:text-ink border border-line hover:bg-bg-soft transition">
            إغلاق
          </button>
          <div className="flex items-center gap-2">
            {jobId && (
              <div className="flex items-center gap-2">
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  disabled={exporting}
                  className="px-2 py-2 rounded-lg text-xs bg-bg-soft border border-line text-ink outline-none disabled:opacity-50"
                  title="تصدير الجدول الزمني لبرنامج مونتاج"
                >
                  <option value="premiere">Premiere</option>
                  <option value="resolve">DaVinci Resolve</option>
                  <option value="shotcut">Shotcut</option>
                  <option value="kdenlive">Kdenlive</option>
                  <option value="final_cut_pro">Final Cut Pro</option>
                </select>
                <button
                  onClick={exportNle}
                  disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 text-xs font-bold disabled:opacity-50 transition"
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  تصدير NLE
                </button>
              </div>
            )}
            {!render && (
              <button
                onClick={onRender}
                disabled={isRendering || !jobId}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isRendering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> جارٍ الرندر…
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" /> ابدأ الرندر الفعلي
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        {exportMsg && (
          <div className="px-4 pb-3 text-[11px] text-ink-soft text-left">{exportMsg}</div>
        )}
      </div>
    </div>
  );
}

/** بطاقة إحصاء نصية صغيرة (المدة/العدد/الحجم...) */
export function PStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-md bg-bg-soft border border-line/50 text-center">
      <div className="text-xs font-bold text-ink">{value}</div>
      <div className="text-[9px] text-ink-soft mt-0.5">{label}</div>
    </div>
  );
}
