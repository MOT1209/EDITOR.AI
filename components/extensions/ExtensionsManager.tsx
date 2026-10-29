"use client";
// مدير الإضافات: مهارات + أدوات MCP — قائمة/فلاتر/تفاصيل/إنشاء/استيراد.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Blocks, Plus, Search, Upload } from "lucide-react";
import { api, errText, kindPath, CAT_AR, STATUS_AR, LABEL_AR, type BuiltinSkill, type BuiltinTool, type Detail, type Kind, type ListResponse, type Pkg } from "./types";
import { DetailPanel } from "./DetailPanel";
import { Editor } from "./Editor";
import { SchemaView } from "./SchemaView";
import { Badge, Dialog, ExecBadge, IssueList, Json, LabelBadge, StatusBadge, inputCls } from "./ui";

type Sel = { type: "custom"; id: string } | { type: "builtin"; id: string } | null;

export default function ExtensionsManager() {
  const [kind, setKind] = useState<Kind>("skill");
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [f, setF] = useState({ category: "", tag: "", label: "", status: "" });
  const [sel, setSel] = useState<Sel>(null);
  const [editor, setEditor] = useState<null | { editing: boolean; initial?: Pkg }>(null);
  const [importState, setImportState] = useState<null | { issues: Array<{ level: string; message: string }>; text?: string; update: boolean; raw?: unknown }>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ kind: kindPath(kind) });
    if (q) sp.set("q", q);
    for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v);
    const r = await api<ListResponse>(`/api/extensions?${sp}`);
    if (r.ok) { setData(r.data); setError(""); } else setError(errText(r.data as never));
  }, [kind, q, f]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setSel(null); setQ(""); setF({ category: "", tag: "", label: "", status: "" }); }, [kind]);

  const tags = useMemo(() => [...new Set((data?.items ?? []).flatMap((i) => i.tags))].sort(), [data]);
  const builtins = (data?.builtins ?? []) as Array<BuiltinSkill & BuiltinTool & { name: string }>;
  const shownBuiltins = builtins.filter((b) => (!q || `${b.name} ${b.description}`.toLowerCase().includes(q.toLowerCase())) && (!f.category || (b as { category?: string }).category === f.category) && !f.label && !f.status && !f.tag);

  const onFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const v = await api("/api/extensions", { method: "POST", body: { op: "validate", kind, package: raw } });
      setImportState({ issues: v.data.issues ?? [], update: false, raw });
    } catch {
      setImportState({ issues: [{ level: "error", message: "الملف ليس JSON صالحاً" }], update: false });
    }
  };
  const doImport = async () => {
    if (!importState?.raw) return;
    const r = await api("/api/extensions", { method: "POST", body: { op: "import", kind, package: importState.raw, update: importState.update } });
    if (!r.ok) return setImportState({ ...importState, issues: [{ level: "error", message: errText(r.data) }] });
    setImportState(null); await load(); setSel({ type: "custom", id: r.data.summary.id });
  };

  const exposure = data?.exposure;
  const showDetail = sel !== null;
  const tabBtn = (k: Kind, label: string) => (
    <button role="tab" id={`tab-${k}`} aria-selected={kind === k} aria-controls="panel-main" onClick={() => setKind(k)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${kind === k ? "border-brand text-ink" : "border-transparent text-ink-mute hover:text-ink-soft"}`}>{label}</button>
  );

  return (
    <div className="h-screen flex flex-col bg-bg text-ink" dir="rtl">
      <header className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 min-h-14 border-b border-line bg-bg-panel">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"><ArrowLeft size={16} /> المحرّر</Link>
        <span className="text-line">|</span>
        <h1 className="font-bold flex items-center gap-2"><Blocks size={18} className="text-brand-glow" /> مدير الإضافات</h1>
        <div className="flex-1" />
        <button className="btn-outline text-xs" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> استيراد</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="ملف حزمة للاستيراد" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ""; }} />
        <button className="btn-primary text-xs" onClick={() => setEditor({ editing: false })}><Plus className="h-3.5 w-3.5" /> {kind === "skill" ? "مهارة جديدة" : "أداة جديدة"}</button>
      </header>
      <div role="tablist" aria-label="نوع الإضافة" className="shrink-0 flex px-4 border-b border-line bg-bg-panel">{tabBtn("skill", "المهارات")}{tabBtn("tool", "أدوات MCP")}</div>

      <main id="panel-main" role="tabpanel" aria-labelledby={`tab-${kind}`} className="flex-1 min-h-0 grid md:grid-cols-[360px_1fr]">
        <aside className={`${showDetail ? "hidden md:flex" : "flex"} flex-col min-h-0 border-e border-line`}>
          <div className="p-3 space-y-2 border-b border-line shrink-0">
            <div className="relative"><Search className="h-3.5 w-3.5 absolute top-2.5 start-2.5 text-ink-mute" /><input aria-label="بحث" placeholder="بحث بالاسم أو الوصف أو الوسم…" className={`${inputCls} ps-8`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-1.5">
              <select aria-label="التصنيف" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">كل التصنيفات</option>{(data?.meta.categories ?? []).map((c) => <option key={c} value={c}>{CAT_AR[c] ?? c}</option>)}</select>
              <select aria-label="الوسم" className={inputCls} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}><option value="">كل الوسوم</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
              <select aria-label="النوع" className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}><option value="">كل الأنواع</option>{["user", "imported", "experimental"].map((l) => <option key={l} value={l}>{LABEL_AR[l]}</option>)}</select>
              <select aria-label="الحالة" className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">كل الحالات</option>{Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-4">
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            {kind === "tool" && exposure && (
              <div className="rounded-lg border border-line p-2.5 text-[11px] space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-xs">المكشوف لعملاء MCP {exposure.present ? <Badge tone={exposure.running ? "green" : "amber"}>{exposure.running ? "الخادم يعمل" : "الخادم متوقف"}</Badge> : <Badge>لا سجل</Badge>}</div>
                {exposure.exposed && exposure.exposed.length > 0 ? exposure.exposed.map((e) => <div key={e.name} dir="ltr" className="font-mono text-emerald-300">{e.name}@{e.version}</div>) : <p className="text-ink-mute">لا أدوات مخصّصة مكشوفة</p>}
                {exposure.skipped?.map((s) => <p key={s.id} className="text-amber-200">تخطّي {s.id}: {s.reason}</p>)}
              </div>
            )}
            <section aria-label="الإضافات المخصّصة">
              <h3 className="text-xs font-semibold text-ink-soft mb-1.5">المخصّصة ({data?.items.length ?? 0})</h3>
              {data && data.items.length === 0 && <p className="text-xs text-ink-mute border border-dashed border-line rounded-lg p-3">لا إضافات مخصّصة{q || Object.values(f).some(Boolean) ? " تطابق الفلاتر" : " بعد. أنشئ واحدة أو ابدأ من قالب."}</p>}
              <ul className="space-y-1.5">{data?.items.map((e) => (
                <li key={e.id}><button onClick={() => setSel({ type: "custom", id: e.id })} aria-current={sel?.type === "custom" && sel.id === e.id}
                  className={`w-full text-start rounded-lg border p-2.5 hover:bg-bg-soft ${sel?.type === "custom" && sel.id === e.id ? "border-brand bg-bg-soft" : "border-line"}`}>
                  <div className="flex items-center gap-1.5 flex-wrap"><span className="text-sm font-medium">{e.name}</span><span className="text-[10px] text-ink-mute" dir="ltr">v{e.version}</span></div>
                  <div className="flex flex-wrap gap-1 mt-1"><LabelBadge label={e.label} /><StatusBadge status={e.status} /><ExecBadge type={e.executionType} /></div>
                  <p className="text-[11px] text-ink-mute mt-1 line-clamp-2">{e.description}</p>
                </button></li>))}</ul>
            </section>
            <section aria-label="المدمجة">
              <h3 className="text-xs font-semibold text-ink-soft mb-1.5">المدمجة — للقراءة فقط ({shownBuiltins.length})</h3>
              <ul className="space-y-1">{shownBuiltins.map((b) => (
                <li key={b.name}><button onClick={() => setSel({ type: "builtin", id: b.name })} className={`w-full text-start rounded-md border px-2.5 py-1.5 text-xs hover:bg-bg-soft ${sel?.type === "builtin" && sel.id === b.name ? "border-brand bg-bg-soft" : "border-line/60"}`}>
                  <div className="flex items-center gap-1.5"><span className="font-mono truncate" dir="ltr">{b.name}</span><LabelBadge label="builtin" />{kind === "tool" && b.readOnly && <Badge tone="green">قراءة</Badge>}{kind === "tool" && b.destructive && <Badge tone="red">يعدّل</Badge>}</div>
                </button></li>))}</ul>
            </section>
          </div>
        </aside>

        <section className={`${showDetail ? "block" : "hidden md:block"} min-h-0 overflow-auto`} aria-label="التفاصيل">
          {sel?.type === "custom" && data ? (
            <DetailPanel key={`${kind}-${sel.id}`} kind={kind} id={sel.id} meta={data.meta} exposure={exposure} onChanged={load}
              onEdit={(d: Detail) => setEditor({ editing: true, initial: d.package })} onBack={() => setSel(null)} onDeleted={() => { setSel(null); load(); }} onOpen={(id) => { load(); setSel({ type: "custom", id }); }} />
          ) : sel?.type === "builtin" ? (
            <BuiltinDetail kind={kind} item={builtins.find((b) => b.name === sel.id)} onBack={() => setSel(null)} />
          ) : (
            <div className="h-full grid place-items-center p-8 text-center text-sm text-ink-mute">
              <div className="max-w-sm space-y-2"><Blocks className="h-10 w-10 mx-auto text-brand-glow/60" /><p>اختر إضافة من القائمة، أو أنشئ واحدة جديدة.</p>
                <p className="text-xs">{kind === "skill" ? "المهارات المخصّصة تعمل داخل إطار lib/skills نفسه باسم ext_<id>." : "الأدوات المخصّصة تُكشف لعملاء MCP باسم ext_<id> بعد التفعيل ومنح الصلاحيات."}</p>
                {data && <p className="text-[11px]">التنفيذ الخارجي: {data.meta.externalEnabled ? "مفعّل" : "معطّل (الافتراضي الآمن)"}</p>}</div>
            </div>
          )}
        </section>
      </main>

      {editor && data && (
        <Dialog wide title={editor.editing ? "تعديل — إصدار جديد" : kind === "skill" ? "مهارة جديدة" : "أداة جديدة"} onClose={() => setEditor(null)}>
          <Editor kind={kind} meta={data.meta} initial={editor.initial} editing={editor.editing} onCancel={() => setEditor(null)} onSaved={(id) => { setEditor(null); load(); setSel({ type: "custom", id }); }} />
        </Dialog>
      )}
      {importState && (
        <Dialog title="استيراد حزمة" onClose={() => setImportState(null)}>
          <p className="text-xs text-ink-soft mb-2">الحزمة المستوردة تُحفظ <b>معطّلة</b> بلا صلاحيات ممنوحة، ولا تُفعَّل قبل مراجعتك واختبارك لها.</p>
          <IssueList issues={importState.issues} />
          <label className="flex items-center gap-2 text-xs mt-3"><input type="checkbox" checked={importState.update} onChange={(e) => setImportState({ ...importState, update: e.target.checked })} /> إن وُجد المعرّف: احفظها كإصدار جديد (يجب أن يكون أعلى)</label>
          <div className="flex justify-end gap-2 mt-3"><button className="btn-outline" onClick={() => setImportState(null)}>إلغاء</button><button className="btn-primary" disabled={!importState.raw || importState.issues.some((i) => i.level === "error")} onClick={doImport}>استيراد</button></div>
        </Dialog>
      )}
    </div>
  );
}

function BuiltinDetail({ kind, item, onBack }: { kind: Kind; item?: BuiltinSkill & BuiltinTool & { name: string }; onBack: () => void }) {
  if (!item) return null;
  return (
    <div className="p-4 space-y-4">
      <button className="md:hidden btn-ghost text-xs" onClick={onBack}>← القائمة</button>
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold" dir="ltr">{item.name}</h2><LabelBadge label="builtin" /><Badge>للقراءة فقط</Badge></div>
      <p className="text-sm text-ink-soft whitespace-pre-line">{item.description}</p>
      {kind === "skill" ? (
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {(["inputSpec", "outputSpec"] as const).map((k) => (
            <div key={k}><h4 className="font-semibold text-ink-soft mb-1">{k === "inputSpec" ? "المدخلات" : "المخرجات"}</h4><Json value={item[k]} /></div>))}
        </div>
      ) : (
        <div className="space-y-3">
          <SchemaView title="مخطط المدخلات" schema={item.inputSchema as never} />
          {item.outputSchema ? <SchemaView title="مخطط المخرجات" schema={item.outputSchema as never} /> : null}
        </div>
      )}
      <p className="text-[11px] text-ink-mute">الإضافات المخصّصة لا تستطيع تعديل هذه العناصر أو الكتابة فوقها؛ أسماؤها المخصّصة تبدأ دائماً بـ <code dir="ltr">ext_</code>.</p>
    </div>
  );
}
