"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Play,
  Pause,
  Download,
  Sparkles,
  Wand2,
  Loader2,
  Film,
  Hash,
  Scissors,
} from "lucide-react";
import CaptionOverlay from "./CaptionOverlay";
import { CAPTION_TEMPLATES, getTemplate } from "@/lib/captions/templates";
import { groupWordsIntoLines } from "@/lib/captions/lines";
import { linesToAss, linesToSrt, downloadText } from "@/lib/captions/export";
import type { TranscriptResult } from "@/lib/captions/types";
import { captureFrame } from "@/lib/ai/client";

type Aspect = "9:16" | "1:1" | "4:5";
const ASPECT_RATIO: Record<Aspect, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

interface Meta { title: string; description: string; tags: string[]; }
interface Short { id: string; start: number; end: number; score: number; }

export default function ShortsStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [templateId, setTemplateId] = useState("hormozi");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [shorts, setShorts] = useState<Short[]>([]);
  const [broll, setBroll] = useState<{ time: number; keyword: string }[]>([]);
  const [sfx, setSfx] = useState<{ time: number; effect: string }[]>([]);
  const [containerW, setContainerW] = useState(360);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>();

  const template = getTemplate(templateId);
  const lines = useMemo(
    () => (transcript ? groupWordsIntoLines(transcript.words, template.maxWordsPerLine) : []),
    [transcript, template.maxWordsPerLine]
  );

  // قياس عرض حاوية المعاينة لضبط حجم الخط
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      setContainerW(entries[0].contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [url, aspect]);

  // حلقة المزامنة مع التشغيل (rAF لا يلمس الصوت)
  const startLoop = useCallback(() => {
    const loop = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);
  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);
  useEffect(() => () => stopLoop(), [stopLoop]);

  const handleFile = (f: File | null) => {
    if (!f) return;
    setErr("");
    setTranscript(null);
    setMeta(null);
    setShorts([]);
    setBroll([]);
    setSfx([]);
    if (url) URL.revokeObjectURL(url);
    const u = URL.createObjectURL(f);
    setFile(f);
    setUrl(u);
    setTime(0);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
      startLoop();
    } else {
      v.pause();
      setPlaying(false);
      stopLoop();
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = t;
      setTime(t);
    }
  };

  // ---- Whisper الحقيقي بتوقيتات الكلمات ----
  const transcribe = async () => {
    if (!file) return;
    setErr("");
    setBusy("نسخ الكلام بتوقيتات الكلمات (Whisper)...");
    try {
      const form = new FormData();
      form.append("audio", file, file.name);
      const res = await fetch("/api/ai/transcribe-words", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "تعذّر النسخ");
        return;
      }
      if (!data.words || data.words.length === 0) {
        setErr("لم يُرجع Whisper توقيتات كلمات. تأكد من وجود كلام واضح في الفيديو.");
        return;
      }
      setTranscript(data as TranscriptResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "خطأ في الاتصال");
    } finally {
      setBusy(null);
    }
  };

  // ---- تحليل ذكي: عنوان/وصف/هاشتاغات + Shorts + B-roll + مؤثرات ----
  const smartAnalyze = async () => {
    if (!url || !duration) return;
    setBusy("التقاط إطارات وتحليل...");
    setErr("");
    try {
      const frames: string[] = [];
      const steps = Math.min(6, Math.max(2, Math.floor(duration / 5)));
      for (let i = 0; i < steps; i++) {
        const fr = await captureFrame(url, (i / steps) * duration);
        if (fr) frames.push(fr);
      }

      setBusy("توليد العنوان والوصف والهاشتاغات...");
      const metaRes = await fetch("/api/ai/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration, transcript: transcript?.text }),
      }).then((r) => r.json());
      if (metaRes && metaRes.title) {
        setMeta({
          title: metaRes.title,
          description: metaRes.description || "",
          tags: metaRes.tags || [],
        });
      }

      setBusy("استخراج مقاطع Shorts والمؤثرات...");
      const wf = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "workflow",
          workflow: "viral-shorts",
          document: { duration, aspect, frames },
        }),
      }).then((r) => r.json());
      const doc = wf?.result?.document || {};
      setShorts((doc.shorts as Short[]) || []);

      // B-roll + مؤثرات صوتية عبر Skills مفردة باستخدام اللحظات المهمة
      const highlights = doc.highlights || [];
      const [brollRes, sfxRes] = await Promise.all([
        fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "skill",
            skill: "BRollGenerationSkill",
            document: { duration, highlights, objects: doc.objects || [] },
          }),
        }).then((r) => r.json()),
        fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "skill",
            skill: "SoundEffectsSkill",
            document: { duration, highlights },
          }),
        }).then((r) => r.json()),
      ]);
      setBroll(brollRes?.result?.output?.bRoll || []);
      setSfx(sfxRes?.result?.output?.soundEffects || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "خطأ في التحليل");
    } finally {
      setBusy(null);
    }
  };

  const frameStyle = {
    aspectRatio: ASPECT_RATIO[aspect].toString(),
  } as const;

  return (
    <div className="min-h-screen bg-[#0a0a12] text-zinc-100" dir="rtl">
      {/* الشريط العلوي */}
      <header className="flex items-center justify-between px-5 h-14 border-b border-white/10 bg-[#0d0d18]">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition">
            <ArrowLeft size={16} /> المحرّر الكامل
          </Link>
          <span className="text-white/20">|</span>
          <h1 className="font-bold flex items-center gap-2">
            <Sparkles size={18} className="text-violet-400" /> استوديو Shorts
          </h1>
        </div>
        <span className="text-xs text-zinc-500">ترجمة متحركة • Shorts • نشر</span>
      </header>

      {!url ? (
        // ---- شاشة الرفع ----
        <div className="flex flex-col items-center justify-center" style={{ height: "calc(100vh - 3.5rem)" }}>
          <label className="cursor-pointer group">
            <div className="w-[420px] max-w-[90vw] border-2 border-dashed border-white/15 rounded-2xl p-12 text-center hover:border-violet-500/60 transition bg-white/[0.02]">
              <Upload size={44} className="mx-auto text-violet-400 mb-4 group-hover:scale-110 transition" />
              <p className="font-semibold mb-1">ارفع فيديو لإنشاء Short</p>
              <p className="text-sm text-zinc-500">MP4 / MOV / WebM — يُفضّل فيديو فيه كلام واضح</p>
            </div>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 p-5">
          {/* ---- المعاينة ---- */}
          <div className="flex flex-col items-center">
            <div
              ref={wrapRef}
              className="relative bg-black rounded-xl overflow-hidden max-h-[72vh]"
              style={frameStyle}
            >
              <video
                ref={videoRef}
                src={url}
                className="w-full h-full object-cover"
                playsInline
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onClick={togglePlay}
                onEnded={() => { setPlaying(false); stopLoop(); }}
              />
              {lines.length > 0 && (
                <CaptionOverlay lines={lines} template={template} time={time} containerWidth={containerW} />
              )}
            </div>

            {/* أدوات التشغيل */}
            <div className="flex items-center gap-3 w-full max-w-[420px] mt-3">
              <button onClick={togglePlay} className="p-2 rounded-full bg-violet-600 hover:bg-violet-500 transition">
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={time}
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="flex-1 accent-violet-500"
              />
              <span className="text-xs text-zinc-400 tabular-nums w-12 text-left">
                {time.toFixed(1)}s
              </span>
            </div>

            {/* نسبة العرض */}
            <div className="flex gap-2 mt-3">
              {(["9:16", "1:1", "4:5"] as Aspect[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAspect(a)}
                  className={`px-3 py-1 rounded-md text-xs border transition ${
                    aspect === a ? "bg-violet-600 border-violet-500" : "border-white/15 text-zinc-400 hover:text-white"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* ---- اللوحة الجانبية ---- */}
          <div className="space-y-4">
            {err && (
              <div className="text-sm bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-3 py-2">
                {err}
              </div>
            )}
            {busy && (
              <div className="text-sm bg-violet-500/10 border border-violet-500/30 text-violet-200 rounded-lg px-3 py-2 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> {busy}
              </div>
            )}

            {/* خطوة 1: النسخ */}
            <Panel title="١ — الترجمة" icon={<Wand2 size={15} />}>
              <button
                onClick={transcribe}
                disabled={!!busy}
                className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm font-medium transition"
              >
                {transcript ? "إعادة النسخ" : "نسخ الكلام (Whisper)"}
              </button>
              {transcript && (
                <p className="text-xs text-zinc-500 mt-2">
                  ✓ {transcript.words.length} كلمة • {lines.length} سطر • لغة: {transcript.language}
                </p>
              )}
            </Panel>

            {/* خطوة 2: القالب */}
            <Panel title="٢ — قالب الترجمة" icon={<Sparkles size={15} />}>
              <div className="grid grid-cols-2 gap-2">
                {CAPTION_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTemplateId(t.id)}
                    className={`px-2 py-2 rounded-lg text-xs border transition ${
                      templateId === t.id ? "bg-white/10 border-violet-500" : "border-white/10 text-zinc-400 hover:text-white"
                    }`}
                    style={{ color: templateId === t.id ? t.activeColor : undefined }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </Panel>

            {/* خطوة 3: تحليل ذكي */}
            <Panel title="٣ — تحليل ونشر" icon={<Film size={15} />}>
              <button
                onClick={smartAnalyze}
                disabled={!!busy || !duration}
                className="w-full py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-sm font-medium transition"
              >
                تحليل ذكي (عنوان • Shorts • B-roll)
              </button>

              {meta && (
                <div className="mt-3 space-y-2 text-xs">
                  <div><span className="text-zinc-500">العنوان:</span> {meta.title}</div>
                  {meta.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {meta.tags.slice(0, 8).map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5 bg-white/5 px-1.5 py-0.5 rounded text-zinc-300">
                          <Hash size={10} />{t.replace(/^#/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {shorts.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Scissors size={11} /> مقاطع مقترحة:</p>
                  <div className="space-y-1">
                    {shorts.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => seek(s.start)}
                        className="w-full text-right text-xs bg-white/5 hover:bg-white/10 rounded px-2 py-1 flex justify-between transition"
                      >
                        <span>{s.start.toFixed(1)}s → {s.end.toFixed(1)}s</span>
                        <span className="text-violet-400">{Math.round(s.score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(broll.length > 0 || sfx.length > 0) && (
                <p className="text-xs text-zinc-500 mt-2">
                  {broll.length > 0 && `B-roll: ${broll.length} مقترح`}
                  {broll.length > 0 && sfx.length > 0 && " • "}
                  {sfx.length > 0 && `مؤثرات: ${sfx.length}`}
                </p>
              )}
            </Panel>

            {/* تصدير */}
            <Panel title="تصدير الترجمة" icon={<Download size={15} />}>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => lines.length && downloadText("captions.srt", linesToSrt(lines))}
                  disabled={!lines.length}
                  className="py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-sm transition"
                >
                  SRT
                </button>
                <button
                  onClick={() => lines.length && downloadText("captions.ass", linesToAss(lines, meta?.title))}
                  disabled={!lines.length}
                  className="py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-sm transition"
                >
                  ASS (كاريوكي)
                </button>
              </div>
              <p className="text-[11px] text-zinc-600 mt-2">
                ASS يحفظ تأثير الكلمة-بكلمة، قابل للحرق في أي محرّر أو ffmpeg.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
      <h3 className="text-sm font-semibold mb-2.5 flex items-center gap-1.5 text-zinc-200">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}
