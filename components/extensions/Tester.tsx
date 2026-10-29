"use client";
// مختبِر الإضافة: مدخلات تجريبية → POST action:"test" → عرض صادق للنتيجة (المصدر، المدة، السجلات، المخرجات).
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, XCircle } from "lucide-react";
import { api, errText, kindPath, type FieldSchema, type Kind } from "./types";
import { sampleFromSchema } from "./SchemaView";
import { Dialog, Json, ProvBadge, inputCls } from "./ui";

interface TestResult {
  ok: boolean; output?: unknown; provenance?: string; warnings: string[]; logs: string[]; durationMs: number; version: string;
  error?: { code: string; message: string; hint?: string }; simulated?: boolean;
}

export function Tester({ kind, id, inputSchema, version, onDone }: { kind: Kind; id: string; inputSchema?: FieldSchema; version: string; onDone: () => void }) {
  const [text, setText] = useState("{}");
  const [res, setRes] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => { setText(JSON.stringify(sampleFromSchema(inputSchema), null, 2)); setRes(null); setFatal(""); }, [id, version, inputSchema]);

  const run = async (confirmed = false) => {
    let input: unknown;
    try { input = JSON.parse(text || "{}"); } catch { return setFatal("مدخلات الاختبار ليست JSON صالحاً"); }
    setBusy(true); setFatal(""); setConfirm(null);
    const r = await api<TestResult & { error?: string }>(`/api/extensions/${kindPath(kind)}/${id}`, { method: "POST", body: { action: "test", input, confirmed } });
    setBusy(false);
    if (!r.ok) { setRes(null); return setFatal(errText(r.data as never)); }
    setRes(r.data);
    if (!r.data.ok && r.data.error?.code === "APPROVAL_DENIED" && /تأكيد المستخدم/.test(r.data.error.message)) setConfirm(r.data.error.message);
    onDone();
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs text-ink-soft font-medium" htmlFor="tester-input">مدخلات الاختبار (JSON) — الإصدار <span dir="ltr">{version}</span></label>
      <textarea id="tester-input" dir="ltr" rows={6} spellCheck={false} className={`${inputCls} font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn-primary" disabled={busy} onClick={() => run(false)}><Play className="h-3.5 w-3.5" /> {busy ? "جارٍ التشغيل…" : "تشغيل اختبار"}</button>
      <p className="text-[10px] text-ink-mute">الاختبار يعمل حتى وهي معطّلة، لكنه لا يتجاوز الصلاحيات الممنوحة ولا ضابط التكلفة.</p>
      {fatal && <p role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md p-2">{fatal}</p>}

      {res && (
        <div className="rounded-lg border border-line p-3 space-y-2" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {res.ok ? <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-4 w-4" /> نجح</span> : <span className="flex items-center gap-1 text-red-300"><XCircle className="h-4 w-4" /> فشل</span>}
            <span className="text-ink-mute">{res.durationMs}ms</span>
            <ProvBadge prov={res.provenance} />
          </div>
          {res.provenance === "simulated" && <p className="text-xs rounded-md bg-red-500/10 border border-red-500/30 text-red-200 p-2 flex gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" /> نتيجة محاكاة/استدلالية — ليست تحليلاً حقيقياً للوسائط. لا تعتمد عليها كحقيقة.</p>}
          {res.provenance === "ai-model" && <p className="text-xs rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 p-2 flex gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" /> ناتج نموذج توليدي — لم يُحلَّل أي ملف وسائط، وقد يحتوي أخطاء.</p>}
          {res.error && (
            <p role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md p-2"><b dir="ltr">[{res.error.code}]</b> {res.error.message}{res.error.hint ? ` — ${res.error.hint}` : ""}</p>
          )}
          {res.warnings.length > 0 && <ul className="text-xs text-amber-200 list-disc ps-5">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {res.logs.length > 0 && <details><summary className="text-xs text-ink-soft cursor-pointer">السجلات ({res.logs.length})</summary><pre dir="ltr" className="text-[11px] bg-bg border border-line rounded-lg p-2 overflow-auto max-h-40 text-left">{res.logs.join("\n")}</pre></details>}
          {res.output !== undefined && <div><h4 className="text-xs font-semibold text-ink-soft mb-1">المخرجات الفعلية</h4><Json value={res.output} /></div>}
        </div>
      )}

      {confirm && (
        <Dialog title="تأكيد التنفيذ" onClose={() => setConfirm(null)}>
          <p className="text-sm mb-3">{confirm}</p>
          <p className="text-xs text-amber-200 mb-3">هذه العملية قد تعدّل مشروعاً أو تشغّل برنامجاً خارجياً أو تستهلك رصيداً. تابع فقط إن كنت تقصدها.</p>
          <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setConfirm(null)}>إلغاء</button><button className="btn-primary" onClick={() => run(true)}>أؤكد التنفيذ</button></div>
        </Dialog>
      )}
    </div>
  );
}
