"use client";
// لوحة تفاصيل إضافة مخصّصة: بيانات، تحقق، مخططات، صلاحيات، إعدادات، إصدارات، اختبار، سجل، تعريض MCP.
import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Pencil, Power, ShieldCheck, Trash2, ArrowRight } from "lucide-react";
import { api, errText, kindPath, PERM_AR, type Detail, type ExposureInfo, type Kind, type Meta } from "./types";
import { SchemaView } from "./SchemaView";
import { Tester } from "./Tester";
import { Badge, Dialog, ExecBadge, IssueList, Json, LabelBadge, ProvBadge, StatusBadge, fmtDate, inputCls } from "./ui";

export function DetailPanel({ kind, id, meta, exposure, onChanged, onEdit, onBack, onDeleted, onOpen }: {
  kind: Kind; id: string; meta: Meta; exposure?: ExposureInfo; onChanged: () => void; onEdit: (d: Detail) => void; onBack: () => void; onDeleted: () => void; onOpen: (id: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dlg, setDlg] = useState<"delete" | "enable" | "duplicate" | "config" | null>(null);
  const [dupId, setDupId] = useState("");
  const [cfgText, setCfgText] = useState("{}");
  const base = `/api/extensions/${kindPath(kind)}/${id}`;

  const load = useCallback(async () => {
    const r = await api<Detail>(base);
    if (r.ok) setD(r.data); else setMsg({ ok: false, text: errText(r.data as never) });
  }, [base]);
  useEffect(() => { setD(null); setMsg(null); load(); }, [load]);

  const act = async (body: Record<string, unknown>, okText: string, after?: () => void) => {
    const r = await api(base, { method: "POST", body });
    if (!r.ok) { setMsg({ ok: false, text: errText(r.data) }); return false; }
    setMsg({ ok: true, text: okText }); setDlg(null); await load(); onChanged(); after?.(); return true;
  };

  if (!d) return <div className="p-6 text-sm text-ink-mute">{msg ? msg.text : "جارٍ التحميل…"}</div>;
  const s = d.summary; const m = d.package.manifest;
  const missing = d.validation.requiredPermissions.filter((p) => !s.grants.includes(p));
  const exp = exposure?.exposed?.find((e) => e.id === id); const skip = exposure?.skipped?.find((e) => e.id === id);
  const tested = s.lastTest?.ok && s.lastTest.version === s.version;
  const deps = [...m.dependencies.skills.map((x) => `مهارة: ${x}`), ...m.dependencies.actions.map((x) => `إجراء: ${x}`), ...m.dependencies.native.map((x) => `أصلي: ${x}`)];

  return (
    <div className="p-4 space-y-5">
      <div>
        <button className="md:hidden btn-ghost text-xs mb-2" onClick={onBack}><ArrowRight className="h-3.5 w-3.5" /> القائمة</button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{m.name}</h2>
          <LabelBadge label={s.label} /><StatusBadge status={s.status} /><ExecBadge type={s.executionType} /><Badge tone="gray"><span dir="ltr">v{s.version}</span></Badge>
        </div>
        <p className="text-sm text-ink-soft mt-1">{m.description}</p>
        <p className="text-[11px] text-ink-mute mt-1">المعرّف <code dir="ltr" className="[unicode-bidi:isolate]">{m.id}</code> • يُكشف باسم <code dir="ltr" className="[unicode-bidi:isolate]">{s.runtimeName}</code> • المؤلف: {m.author || "—"} • آخر تحديث {fmtDate(s.updatedAt)}</p>
        {m.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{m.tags.map((t) => <Badge key={t}>#{t}</Badge>)}</div>}
      </div>

      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="إجراءات">
        {s.enabled ? <button className="btn-outline" onClick={() => act({ action: "disable" }, "عُطّلت")}><Power className="h-3.5 w-3.5" /> تعطيل</button>
          : <button className="btn-primary" onClick={() => (tested ? act({ action: "enable" }, "فُعّلت") : setDlg("enable"))}><Power className="h-3.5 w-3.5" /> تفعيل</button>}
        {missing.length > 0 && <button className="btn-outline" onClick={() => act({ action: "grant", permissions: m.permissions }, "مُنحت الصلاحيات المعلنة")}><ShieldCheck className="h-3.5 w-3.5" /> منح الصلاحيات المعلنة</button>}
        <button className="btn-outline" onClick={() => onEdit(d)}><Pencil className="h-3.5 w-3.5" /> تعديل (إصدار جديد)</button>
        <button className="btn-outline" onClick={() => { setDupId(`${id}_copy`); setDlg("duplicate"); }}><Copy className="h-3.5 w-3.5" /> تكرار</button>
        <button className="btn-outline" onClick={() => { setCfgText(JSON.stringify(d.state.config ?? {}, null, 2)); setDlg("config"); }}>الإعدادات</button>
        <a className="btn-outline" href={`${base}/export`} download><Download className="h-3.5 w-3.5" /> تصدير</a>
        <button className="btn-outline text-red-300" onClick={() => setDlg("delete")}><Trash2 className="h-3.5 w-3.5" /> حذف</button>
      </div>
      {msg && <p role="status" className={`text-xs rounded-md border p-2 ${msg.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-red-500/10 border-red-500/30 text-red-200"}`}>{msg.text}</p>}

      <section aria-labelledby="h-valid"><h3 id="h-valid" className="text-sm font-semibold mb-1.5">التحقق والتوافق</h3><IssueList issues={d.validation.issues} /><p className="text-[11px] text-ink-mute mt-1">يتطلب المنصة <code dir="ltr" className="[unicode-bidi:isolate]">{m.compat?.montage}</code> (المثبّتة <code dir="ltr" className="[unicode-bidi:isolate]">{meta.platformVersion}</code>)</p></section>

      <section aria-labelledby="h-perm"><h3 id="h-perm" className="text-sm font-semibold mb-1.5">الصلاحيات والتبعيات</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div><p className="text-ink-mute mb-1">الصلاحيات (معلنة ← ممنوحة)</p>{m.permissions.length === 0 ? <p className="text-ink-soft">لا تتطلب صلاحيات</p> : <ul className="space-y-1">{m.permissions.map((p) => <li key={p} className="flex items-center gap-1.5"><Badge tone={s.grants.includes(p) ? "green" : "amber"}>{s.grants.includes(p) ? "ممنوحة" : "غير ممنوحة"}</Badge>{PERM_AR[p] ?? p} <code className="text-ink-mute" dir="ltr">{p}</code></li>)}</ul>}</div>
          <div><p className="text-ink-mute mb-1">التبعيات</p>{deps.length === 0 ? <p className="text-ink-soft">لا تبعيات</p> : <ul className="list-disc ps-5 text-ink-soft">{deps.map((x) => <li key={x} dir="auto">{x}</li>)}</ul>}</div>
        </div>
        <p className="text-[11px] text-ink-mute mt-1">حدود: مهلة {m.limits.timeoutMs}ms • مخرجات ≤ {m.limits.maxOutputBytes} بايت</p>
      </section>

      <section aria-labelledby="h-schema"><h3 id="h-schema" className="text-sm font-semibold mb-1.5">المخططات</h3><div className="grid lg:grid-cols-2 gap-3"><SchemaView title="المدخلات" schema={m.input} /><SchemaView title="المخرجات المتوقعة" schema={m.output} /></div>
        {Object.keys(m.execution).length > 0 && <details className="mt-2"><summary className="text-xs text-ink-soft cursor-pointer">تعريف التنفيذ</summary><Json value={m.execution} /></details>}
        {Object.keys(d.package.files).map((f) => <details key={f} className="mt-1"><summary className="text-xs text-ink-soft cursor-pointer" dir="ltr">{f}</summary><pre className="text-[11px] bg-bg border border-line rounded-lg p-2 overflow-auto max-h-48 whitespace-pre-wrap">{d.package.files[f]}</pre></details>)}
      </section>

      {kind === "tool" && (
        <section aria-labelledby="h-mcp"><h3 id="h-mcp" className="text-sm font-semibold mb-1.5">التعريض لعملاء MCP</h3>
          <div className="text-xs space-y-1 rounded-lg border border-line p-3">
            {exp ? <p className="text-emerald-300">✓ مكشوفة الآن باسم <code dir="ltr" className="[unicode-bidi:isolate]">{exp.name}</code> (خطورة: {exp.risk})</p>
              : skip ? <p className="text-amber-200">لم تُكشف: {skip.reason}</p>
              : <p className="text-ink-soft">غير مكشوفة حالياً {s.enabled ? "(لم يلتقطها خادم MCP بعد)" : "(معطّلة)"}.</p>}
            <p className="text-ink-mute">{exposure?.present ? <>سجل التعرّض كتبه خادم MCP ({exposure.running ? <b className="text-emerald-300">يعمل الآن على هذا الجهاز</b> : <b className="text-amber-200">غير مُشغَّل حالياً — السجل قديم</b>}) في {fmtDate(exposure.updatedAt)}.</> : "لا سجل تعرّض بعد: لم يُشغَّل خادم MCP (pnpm mcp) على مساحة العمل هذه."}</p>
            <p className="text-ink-mute">يفحص الخادم السجل كل ~2 ثانية ويُرسل إشعار <code dir="ltr" className="[unicode-bidi:isolate]">tools/list_changed</code>؛ العملاء الداعمون له يحدّثون القائمة تلقائياً، وغيرهم يلزمهم إعادة الاتصال أو إعادة استدعاء <code dir="ltr" className="[unicode-bidi:isolate]">tools/list</code>. يمكن استدعاء <code dir="ltr" className="[unicode-bidi:isolate]">refresh_custom_tools</code> للتحديث الفوري.</p>
          </div>
        </section>
      )}

      <section aria-labelledby="h-test"><h3 id="h-test" className="text-sm font-semibold mb-1.5">الاختبار</h3>
        <p className="text-[11px] text-ink-mute mb-2">آخر اختبار: {s.lastTest ? <>{s.lastTest.ok ? "ناجح" : "فاشل"} على v{s.lastTest.version} — {fmtDate(s.lastTest.at)} <ProvBadge prov={s.lastTest.provenance} /></> : "لم يُجرَ"}</p>
        <Tester kind={kind} id={id} version={s.version} inputSchema={m.input} onDone={() => { load(); onChanged(); }} /></section>

      <section aria-labelledby="h-ver"><h3 id="h-ver" className="text-sm font-semibold mb-1.5">الإصدارات والرجوع</h3>
        <ul className="space-y-1">{[...d.versions].reverse().map((v) => (
          <li key={v.version} className="flex items-center gap-2 text-xs rounded-md bg-bg-soft px-2 py-1.5">
            <code dir="ltr" className="[unicode-bidi:isolate]">v{v.version}</code>{v.version === s.version && <Badge tone="green">الفعّال</Badge>}
            <span className="text-ink-mute flex-1 truncate">{fmtDate(v.savedAt)} {v.note ? `— ${v.note}` : ""}</span>
            {v.version !== s.version && <button className="btn-outline text-[11px] px-2 py-0.5" onClick={() => act({ action: "activate", version: v.version }, `فُعِّل الإصدار ${v.version} (عُطّلت الإضافة حتى تُختبر)`)}>تفعيل هذا الإصدار</button>}
          </li>))}</ul>
        <p className="text-[10px] text-ink-mute mt-1">تبديل الإصدار (أو الرجوع) يعطّل الإضافة ويمسح نتيجة الاختبار — أعد الاختبار قبل التفعيل.</p>
      </section>

      <section aria-labelledby="h-runs"><h3 id="h-runs" className="text-sm font-semibold mb-1.5">سجل التنفيذ</h3>
        {d.runs.length === 0 ? <p className="text-xs text-ink-mute">لا تنفيذات بعد</p> : (
          <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-[11px]"><thead className="bg-bg-soft text-ink-mute"><tr>{["الوقت", "النمط", "الإصدار", "النتيجة", "المدة", "المصدر", "الخطأ"].map((h) => <th key={h} className="text-start p-1.5">{h}</th>)}</tr></thead>
            <tbody>{d.runs.slice(0, 20).map((r, i) => <tr key={i} className="border-t border-line/60 align-top"><td className="p-1.5 whitespace-nowrap">{fmtDate(r.at)}</td><td className="p-1.5">{r.mode}</td><td className="p-1.5" dir="ltr">{r.version}</td><td className={`p-1.5 ${r.ok ? "text-emerald-300" : "text-red-300"}`}>{r.ok ? "نجح" : "فشل"}</td><td className="p-1.5">{r.durationMs}ms</td><td className="p-1.5"><ProvBadge prov={r.provenance} /></td><td className="p-1.5 text-ink-soft max-w-[240px] truncate" title={r.error}>{r.code ? `[${r.code}] ` : ""}{r.error ?? ""}</td></tr>)}</tbody></table></div>)}
      </section>

      {dlg === "delete" && <Dialog title="حذف الإضافة" onClose={() => setDlg(null)}><p className="text-sm mb-3">سيُحذف «{m.name}» بكل إصداراته وسجله نهائياً ولا يمكن التراجع.</p><div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setDlg(null)}>إلغاء</button><button className="btn-primary !bg-red-600" onClick={async () => { const r = await api(base, { method: "DELETE", body: { confirm: true } }); if (r.ok) { onChanged(); onDeleted(); } else setMsg({ ok: false, text: errText(r.data) }); }}>حذف نهائي</button></div></Dialog>}
      {dlg === "enable" && <Dialog title="تفعيل دون اختبار ناجح" onClose={() => setDlg(null)}><p className="text-sm mb-3">هذا الإصدار لم يُختبر بنجاح بعد. يُنصح بتشغيل اختبار أولاً. هل تريد التفعيل رغم ذلك؟</p><div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setDlg(null)}>إلغاء</button><button className="btn-primary" onClick={() => act({ action: "enable", acknowledgeUntested: true }, "فُعّلت دون اختبار")}>أؤكد التفعيل</button></div></Dialog>}
      {dlg === "duplicate" && <Dialog title="تكرار الإضافة" onClose={() => setDlg(null)}><label className="text-xs text-ink-soft block mb-1" htmlFor="dup">المعرّف الجديد</label><input id="dup" dir="ltr" className={inputCls} value={dupId} onChange={(e) => setDupId(e.target.value)} /><div className="flex justify-end gap-2 mt-3"><button className="btn-outline" onClick={() => setDlg(null)}>إلغاء</button><button className="btn-primary" onClick={() => act({ action: "duplicate", newId: dupId }, "تم التكرار", () => onOpen(dupId))}>تكرار</button></div></Dialog>}
      {dlg === "config" && <Dialog title="إعدادات الإضافة" onClose={() => setDlg(null)}><p className="text-[11px] text-ink-mute mb-1">تُدمج مع القيم الافتراضية في البيان وتُتحقق بمخطط الإعدادات.</p><SchemaView title="مخطط الإعدادات" schema={m.config.schema} /><textarea aria-label="JSON الإعدادات" dir="ltr" rows={6} className={`${inputCls} font-mono text-xs mt-2`} value={cfgText} onChange={(e) => setCfgText(e.target.value)} /><div className="flex justify-end gap-2 mt-3"><button className="btn-outline" onClick={() => setDlg(null)}>إلغاء</button><button className="btn-primary" onClick={() => { try { act({ action: "config", config: JSON.parse(cfgText) }, "حُفظت الإعدادات"); } catch { setMsg({ ok: false, text: "JSON غير صالح" }); } }}>حفظ</button></div></Dialog>}
    </div>
  );
}
