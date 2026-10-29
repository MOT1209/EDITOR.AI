"use client";
// مكوّنات صغيرة مشتركة لمدير الإضافات: شارات، نافذة حوار قابلة للإغلاق بلوحة المفاتيح، حقول.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { EXEC_AR, LABEL_AR, PROV_AR, STATUS_AR, type Summary } from "./types";

const TONE: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  red: "bg-red-500/15 text-red-300 border-red-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  violet: "bg-brand/20 text-brand-glow border-brand/40",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  gray: "bg-bg-elev text-ink-soft border-line",
};

export function Badge({ tone = "gray", children, title }: { tone?: keyof typeof TONE; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

export function LabelBadge({ label }: { label: Summary["label"] }) {
  const tone = label === "builtin" ? "gray" : label === "experimental" ? "amber" : label === "imported" ? "cyan" : "violet";
  return <Badge tone={tone}>{LABEL_AR[label]}</Badge>;
}
export function StatusBadge({ status }: { status: string }) {
  const tone = status === "enabled" ? "green" : status === "disabled" ? "gray" : status === "needs_grant" || status === "unavailable" ? "amber" : "red";
  return <Badge tone={tone}>{STATUS_AR[status] ?? status}</Badge>;
}
export const ExecBadge = ({ type }: { type: string }) => <Badge tone="gray">{EXEC_AR[type] ?? type}</Badge>;
export function ProvBadge({ prov }: { prov?: string }) {
  if (!prov) return null;
  const tone = prov === "simulated" ? "red" : prov === "ai-model" ? "amber" : prov === "real-analysis" ? "green" : "cyan";
  return <Badge tone={tone}>{PROV_AR[prov] ?? prov}</Badge>;
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-md"} max-h-[92vh] flex flex-col bg-bg-panel border border-line rounded-2xl shadow-panel outline-none`}
      >
        <div className="h-12 shrink-0 border-b border-line flex items-center px-4 gap-2">
          <h2 className="text-sm font-semibold flex-1 truncate">{title}</h2>
          <button onClick={onClose} aria-label="إغلاق" className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export const inputCls = "w-full bg-bg-soft border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-brand/60";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-ink-soft font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block mt-1 text-[10px] text-ink-mute">{hint}</span>}
    </label>
  );
}

export function IssueList({ issues }: { issues: Array<{ level: string; message: string; code?: string }> }) {
  if (!issues.length) return <p className="text-xs text-emerald-300">✓ لا مشكلات</p>;
  return (
    <ul className="space-y-1">
      {issues.map((i, n) => (
        <li key={n} className={`text-xs rounded-md border px-2 py-1 ${i.level === "error" ? TONE.red : TONE.amber}`}>
          <b>{i.level === "error" ? "خطأ" : "تحذير"}</b>{i.code ? ` [${i.code}]` : ""}: {i.message}
        </li>
      ))}
    </ul>
  );
}

export const Json = ({ value }: { value: unknown }) => (
  <pre dir="ltr" className="text-[11px] leading-relaxed bg-bg border border-line rounded-lg p-2 overflow-auto max-h-72 whitespace-pre-wrap break-words text-left">{JSON.stringify(value, null, 2)}</pre>
);

export const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "—");
