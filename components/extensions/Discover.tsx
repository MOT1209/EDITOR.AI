"use client";
// اكتشاف الإضافات: فهرس محلي لحزم جاهزة (تثبيت/تحديث بنقرة). التثبيت لا يفعّل ولا يمنح صلاحيات.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { api, errText, CAT_AR } from "./types";
import { Badge, ExecBadge, inputCls } from "./ui";

interface Entry {
  key: string; kind: "skill" | "tool"; id: string; name: string; description: string; category: string; tags: string[]; version: string;
  permissions: string[]; capabilities: string[]; executionType: string; valid: boolean; issues: string[];
  installed: boolean; installedVersion?: string; updateAvailable: boolean;
}

export function Discover({ onInstalled }: { onInstalled: (kind: "skill" | "tool", id: string) => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ entries: Entry[] }>("/api/extensions/catalog");
    if (r.ok) { setEntries(r.data.entries); setError(""); } else setError(errText(r.data as never));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (e: Entry, op: "install" | "update") => {
    setBusy(e.key); setNote("");
    const r = await api("/api/extensions/catalog", { method: "POST", body: { key: e.key, op } });
    setBusy(null);
    if (!r.ok) return setError(errText(r.data as never));
    setError(""); setNote(op === "install" ? `ثُبّتت «${e.name}» معطّلة — راجع صلاحياتها وفعّلها من القائمة.` : `حُدّثت «${e.name}» إلى ${e.version}.`);
    await load();
    if (op === "install") onInstalled(e.kind, e.id);
  };

  const shown = useMemo(() => (entries ?? []).filter((e) => (!kind || e.kind === kind) && (!cat || e.category === cat) && (!q || `${e.id} ${e.name} ${e.description} ${e.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [entries, q, cat, kind]);
  const cats = [...new Set((entries ?? []).map((e) => e.category))];

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]"><Search className="h-3.5 w-3.5 absolute top-2.5 start-2.5 text-ink-mute" /><input aria-label="بحث في الفهرس" placeholder="ابحث في الحزم الجاهزة…" className={`${inputCls} ps-8`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="النوع" className={`${inputCls} w-auto`} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">مهارات وأدوات</option><option value="skill">مهارات</option><option value="tool">أدوات MCP</option></select>
        <select aria-label="التصنيف" className={`${inputCls} w-auto`} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">كل التصنيفات</option>{cats.map((c) => <option key={c} value={c}>{CAT_AR[c] ?? c}</option>)}</select>
        <button className="btn-outline text-xs" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> تحديث الفهرس</button>
      </div>
      <p className="text-[11px] text-ink-mute">الفهرس محلي (حزم مرفقة بالتطبيق) — لا متجر بعيد ولا تنزيل شيفرة من الشبكة. كل تثبيت يمرّ بنفس التحقق والتكامل وسياسة التوقيع، ويُحفظ <b>معطّلاً</b> بلا صلاحيات ممنوحة.</p>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      {note && <p role="status" className="text-xs text-emerald-300">{note}</p>}
      {entries === null && !error && <p className="text-xs text-ink-mute">جارٍ التحميل…</p>}
      {entries && shown.length === 0 && <p className="text-xs text-ink-mute border border-dashed border-line rounded-lg p-3">لا حزم مطابقة.</p>}
      <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map((e) => (
          <li key={e.key} className="rounded-lg border border-line p-3 space-y-2 bg-bg-panel">
            <div className="flex items-center gap-1.5 flex-wrap"><span className="font-medium text-sm">{e.name}</span><span className="text-[10px] text-ink-mute" dir="ltr">v{e.version}</span><Badge>{e.kind === "skill" ? "مهارة" : "أداة"}</Badge><ExecBadge type={e.executionType} /></div>
            <p className="text-[11px] text-ink-soft line-clamp-3">{e.description}</p>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <Badge>{CAT_AR[e.category] ?? e.category}</Badge>
              {e.permissions.map((p) => <Badge key={p} tone="amber">{p}</Badge>)}
              {e.capabilities.map((c) => <Badge key={c} tone="green">{c}</Badge>)}
            </div>
            {!e.valid && <p className="text-[11px] text-red-300 flex gap-1"><ShieldAlert className="h-3.5 w-3.5 shrink-0" />غير صالحة: {e.issues.join("؛ ")}</p>}
            <div className="flex items-center gap-2">
              {e.installed ? <Badge tone="green">مثبّتة v{e.installedVersion}</Badge> : null}
              <div className="flex-1" />
              {!e.installed && <button className="btn-primary text-xs" disabled={!e.valid || busy === e.key} onClick={() => act(e, "install")}><Download className="h-3.5 w-3.5" /> تثبيت</button>}
              {e.installed && e.updateAvailable && <button className="btn-primary text-xs" disabled={busy === e.key} onClick={() => act(e, "update")}><RefreshCw className="h-3.5 w-3.5" /> تحديث إلى v{e.version}</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
