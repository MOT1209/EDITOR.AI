"use client";

/**
 * لوحة تشخيص المسار — تعرض أدلة `.montage_ai/pipeline/<job_id>/` (manifest +
 * مُخرَج كل مرحلة: analyst/director/critic/audio/render) بملخص ملون لتصحيح
 * أسرع دون إعادة تشغيل المسار. للقراءة فقط، تستهلك GET /api/diagnostics.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Film,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react";

const STAGE_ORDER = ["analyst", "director", "critic", "audio", "render"] as const;
const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], string> = {
  analyst: "المحلل",
  director: "المخرج",
  critic: "الناقد",
  audio: "الصوت",
  render: "الرندر",
};

interface JobSummary {
  job_id: string;
  status: "completed" | "failed" | "partial" | "interrupted" | string;
  source_path?: string;
  request?: string;
  created_at?: string | null;
  duration_seconds?: number;
  stages?: Record<string, boolean>;
  errors?: string[];
  warnings?: string[];
}

interface JobDetail {
  manifest: JobSummary;
  analyst: Record<string, any> | null;
  director: Record<string, any> | null;
  critic: Record<string, any> | null;
  audio: Record<string, any> | null;
  render: Record<string, any> | null;
}

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  completed: { dot: "bg-emerald-500", text: "text-emerald-400", label: "مكتمل" },
  failed: { dot: "bg-rose-500", text: "text-rose-400", label: "فشل" },
  partial: { dot: "bg-amber-500", text: "text-amber-400", label: "جزئي" },
  interrupted: { dot: "bg-zinc-500", text: "text-zinc-400", label: "منقطع" },
};

function statusStyle(status: string) {
  return STATUS_STYLE[status] || { dot: "bg-zinc-500", text: "text-zinc-400", label: status || "غير معروف" };
}

function fmtDuration(s?: number): string {
  if (!s && s !== 0) return "—";
  return s < 60 ? `${s.toFixed(1)}ث` : `${Math.floor(s / 60)}د ${Math.round(s % 60)}ث`;
}

function fmtBytes(n?: number | null): string {
  if (!n) return "—";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(n / 1024).toFixed(0)}KB`;
}

/** صف إحصائي صغير — رقم + تسمية، لملخصات المراحل. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-bg-soft px-3 py-2 min-w-[6.5rem]">
      <div className="text-[11px] text-ink-mute">{label}</div>
      <div className="text-sm font-bold text-ink">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg-panel/60 p-4">
      <h3 className="text-xs font-bold text-ink-soft mb-3">{title}</h3>
      {children}
    </div>
  );
}

function WarningList({ items, tone }: { items: string[]; tone: "warn" | "error" }) {
  if (!items?.length) return null;
  const color = tone === "error" ? "text-rose-300" : "text-amber-300";
  const Icon = tone === "error" ? AlertCircle : AlertTriangle;
  return (
    <ul className="space-y-1.5 mt-2">
      {items.map((it, i) => (
        <li key={i} className={`flex items-start gap-2 text-xs ${color}`}>
          <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{it}</span>
        </li>
      ))}
    </ul>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`(${res.status}) تعذّر جلب ${url}`);
  return res.json();
}

export default function DiagnosticsDashboard({ initialJobId }: { initialJobId?: string }) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialJobId || null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchJson<{ jobs: JobSummary[] }>("/api/diagnostics");
      setJobs(data.jobs);
      setListError(null);
      if (!selected && data.jobs.length > 0) setSelected(data.jobs[0].job_id);
    } catch (exc) {
      setListError(exc instanceof Error ? exc.message : "تعذّر تحميل قائمة المسارات");
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    fetchJson<JobDetail>(`/api/diagnostics?job=${encodeURIComponent(selected)}`)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((exc) => {
        if (!cancelled) setDetailError(exc instanceof Error ? exc.message : "تعذّر تحميل تفاصيل المسار");
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-ink overflow-hidden" dir="rtl">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-bg-panel/70 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-brand-glow" />
          <h1 className="text-sm font-bold">لوحة تشخيص المسار</h1>
          <span className="text-[11px] text-ink-mute hidden sm:inline">
            .montage_ai/pipeline/&lt;job_id&gt;
          </span>
        </div>
        <button
          onClick={() => void loadList()}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-xs text-ink-soft hover:bg-bg-soft disabled:opacity-50 transition"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          تحديث
        </button>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* قائمة المسارات */}
        <aside className="md:w-72 shrink-0 border-b md:border-b-0 md:border-l border-line overflow-y-auto max-h-56 md:max-h-none">
          {listError && (
            <div className="p-3 text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {listError}
            </div>
          )}
          {jobs === null && !listError && (
            <div className="p-6 flex items-center justify-center text-ink-mute text-xs gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل…
            </div>
          )}
          {jobs !== null && jobs.length === 0 && (
            <div className="p-6 text-center text-xs text-ink-mute">
              لا توجد مسارات بعد — شغّل «المسار الكامل» من المحرر أولاً.
            </div>
          )}
          <ul>
            {jobs?.map((job) => {
              const s = statusStyle(job.status);
              const active = job.job_id === selected;
              return (
                <li key={job.job_id}>
                  <button
                    onClick={() => setSelected(job.job_id)}
                    className={`w-full text-right px-3 py-2.5 border-b border-line/60 flex flex-col gap-1 transition ${
                      active ? "bg-brand/10 border-r-2 border-r-brand-glow" : "hover:bg-bg-soft"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${s.dot}`} />
                      <span className="text-xs font-mono text-ink-soft truncate">{job.job_id}</span>
                    </div>
                    <div className="text-[11px] text-ink-mute truncate pr-4">
                      {job.request || "—"}
                    </div>
                    <div className="flex items-center gap-2 pr-4 text-[10px] text-ink-mute">
                      <span className={s.text}>{s.label}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {fmtDuration(job.duration_seconds)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* تفاصيل المسار المختار */}
        <main className="flex-1 overflow-y-auto p-4">
          {!selected && (
            <div className="h-full flex items-center justify-center text-ink-mute text-sm">
              اختر مساراً من القائمة لعرض تفاصيله
            </div>
          )}
          {selected && loadingDetail && (
            <div className="h-full flex items-center justify-center gap-2 text-ink-mute text-sm">
              <Loader2 className="h-5 w-5 animate-spin" /> جارٍ تحميل تفاصيل {selected}…
            </div>
          )}
          {selected && detailError && (
            <div className="flex items-center gap-2 text-rose-400 text-sm">
              <AlertCircle className="h-4 w-4" /> {detailError}
            </div>
          )}
          {selected && !loadingDetail && !detailError && detail && (
            <JobDetailView detail={detail} />
          )}
        </main>
      </div>
    </div>
  );
}

function JobDetailView({ detail }: { detail: JobDetail }) {
  const { manifest, analyst, director, critic, audio, render } = detail;
  const s = statusStyle(manifest.status);
  const videoUrl = render?.rendered ? `/api/agents/pipeline?job=${manifest.job_id}` : null;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* ملخص المسار */}
      <Section title="ملخص المسار">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`flex items-center gap-1.5 text-xs font-bold ${s.text}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} /> {s.label}
          </span>
          <span className="text-xs text-ink-mute font-mono">{manifest.job_id}</span>
        </div>
        {manifest.request && <p className="text-sm text-ink-soft mb-3">«{manifest.request}»</p>}
        <div className="flex flex-wrap gap-2 mb-3">
          <Stat label="المدة الكلية" value={fmtDuration(manifest.duration_seconds)} />
          <Stat label="المصدر" value={manifest.source_path ? manifest.source_path.split(/[/\\]/).pop()! : "—"} />
        </div>
        <div className="flex flex-wrap gap-2">
          {STAGE_ORDER.map((stage) => {
            const ok = manifest.stages?.[stage];
            return (
              <span
                key={stage}
                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${
                  ok ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/5" : "border-line text-ink-mute"
                }`}
              >
                {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {STAGE_LABELS[stage]}
              </span>
            );
          })}
        </div>
        <WarningList items={manifest.errors || []} tone="error" />
        <WarningList items={manifest.warnings || []} tone="warn" />
      </Section>

      {analyst && (
        <Section title="تقرير المحلل (Analyst)">
          <div className="flex flex-wrap gap-2">
            <Stat label="المدة" value={fmtDuration(analyst.duration)} />
            <Stat label="أبعاد" value={`${analyst.width || 0}×${analyst.height || 0}`} />
            <Stat label="كلمات" value={analyst.words?.length ?? 0} />
            <Stat label="فترات صمت" value={analyst.silences?.length ?? 0} />
            <Stat label="متحدثون" value={new Set((analyst.speakers || []).map((sp: any) => sp.label)).size} />
            <Stat label="مسارات وجه" value={analyst.faceTracks?.length ?? 0} />
          </div>
          <WarningList items={analyst.warnings || []} tone="warn" />
        </Section>
      )}

      {director && (
        <Section title="خطة المخرج (EDL)">
          <p className="text-sm text-ink-soft mb-2">{director.title}</p>
          <div className="flex flex-wrap gap-2">
            <Stat
              label="مقاطع محتفظ بها"
              value={`${(director.segments || []).filter((sg: any) => sg.keep).length}/${(director.segments || []).length}`}
            />
            <Stat label="ترجمات" value={director.captions?.length ?? 0} />
            <Stat label="B-Roll" value={director.bRoll?.length ?? 0} />
            <Stat label="نسبة العرض" value={director.render?.targetAspect || "المصدر"} />
          </div>
        </Section>
      )}

      {critic && (
        <Section title="تقييم الناقد (Critic)">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span
              className={`text-lg font-black ${
                critic.score >= 80 ? "text-emerald-400" : critic.score >= 50 ? "text-amber-400" : "text-rose-400"
              }`}
            >
              {Math.round(critic.score ?? 0)}/100
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                critic.verdict === "approve"
                  ? "border-emerald-500/30 text-emerald-300"
                  : "border-amber-500/30 text-amber-300"
              }`}
            >
              {critic.verdict === "approve" ? "مقبولة" : "تحتاج تعديل"}
            </span>
          </div>
          {(critic.strengths || []).length > 0 && (
            <ul className="space-y-1 mb-2">
              {critic.strengths.map((it: string, i: number) => (
                <li key={i} className="text-xs text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {it}
                </li>
              ))}
            </ul>
          )}
          <WarningList items={critic.suggestions || []} tone="warn" />
        </Section>
      )}

      {audio && (
        <Section title="خطة الصوت (Audio)">
          <div className="flex flex-wrap gap-2">
            <Stat label="مزاج الموسيقى" value={audio.music?.mood || "—"} />
            <Stat label="مستوى الصوت (LUFS)" value={audio.loudnessLufs ?? "—"} />
            <Stat label="تعزيز الصوت (dB)" value={audio.voiceBoostDb ?? "—"} />
            <Stat label="أحداث ducking" value={audio.ducking?.length ?? 0} />
          </div>
          <WarningList items={audio.notes || []} tone="warn" />
        </Section>
      )}

      {render && (
        <Section title="نتيجة الرندر (Render)">
          <div className="flex flex-wrap gap-2 mb-3">
            <Stat label="الحالة" value={render.rendered ? "تم" : "لم يُنفَّذ"} />
            <Stat label="الحجم" value={fmtBytes(render.outputBytes)} />
            <Stat label="زمن الرندر" value={fmtDuration(render.renderSeconds)} />
            <Stat label="المُرمِّز" value={render.encoder || "—"} />
          </div>
          {render.renderError && (
            <p className="text-xs text-rose-300 flex items-start gap-2 mb-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {render.renderError}
            </p>
          )}
          {videoUrl && (
            <div className="mt-2">
              <video src={videoUrl} controls className="w-full max-w-md rounded-lg border border-line bg-black aspect-video" />
              <a
                href={videoUrl}
                download={`${manifest.job_id}.mp4`}
                className="inline-flex items-center gap-1.5 mt-2 text-xs text-brand-glow hover:underline"
              >
                <Film className="h-3.5 w-3.5" /> تنزيل الفيديو النهائي
              </a>
            </div>
          )}
          <WarningList items={render.notes || []} tone="warn" />
        </Section>
      )}
    </div>
  );
}
