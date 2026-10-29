"use client";
// محرّر الإنشاء/التعديل: نموذج مرئي + محرّر متقدم (JSON كامل) مع تحقق حيّ عبر POST op:"validate".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, errText, CAT_AR, PERM_AR, type Kind, type Meta, type ObjectSchema, type Pkg } from "./types";
import { Field, IssueList, inputCls } from "./ui";
import { TEMPLATES } from "./templates";

type FieldRow = { name: string; type: string; required: boolean; description: string };
interface Form {
  id: string; name: string; description: string; category: string; tags: string; author: string; version: string; stability: string;
  permissions: string[]; execType: string; entry: string; instructions: string; stepsJson: string; action: string; argsJson: string;
  requiresApproval: boolean; fields: FieldRow[]; outputJson: string;
}

const EMPTY: Form = {
  id: "", name: "", description: "", category: "utility", tags: "", author: "", version: "1.0.0", stability: "experimental", permissions: [],
  execType: "native", entry: "", instructions: "", stepsJson: "[]", action: "", argsJson: "{}", requiresApproval: false, fields: [],
  outputJson: JSON.stringify({ type: "object", properties: {} }, null, 2),
};

function formFromPackage(p: { manifest: Record<string, any>; files: Record<string, string> }): Form {
  const m = p.manifest;
  const ex = m.execution ?? {};
  const req = new Set<string>(m.input?.required ?? []);
  return {
    id: m.id ?? "", name: m.name ?? "", description: m.description ?? "", category: m.category ?? "utility", tags: (m.tags ?? []).join(", "), author: m.author ?? "",
    version: m.version ?? "1.0.0", stability: m.stability ?? "experimental", permissions: m.permissions ?? [], execType: ex.type ?? "native", entry: ex.entry ?? "",
    instructions: p.files[ex.instructionsFile ?? "instructions.md"] ?? "", stepsJson: JSON.stringify(ex.steps ?? [], null, 2), action: ex.action ?? "",
    argsJson: JSON.stringify(ex.args ?? {}, null, 2), requiresApproval: !!m.requiresApproval,
    fields: Object.entries(m.input?.properties ?? {}).map(([name, f]) => ({ name, type: (f as { type: string }).type, required: req.has(name), description: (f as { description?: string }).description ?? "" })),
    outputJson: JSON.stringify(m.output ?? { type: "object", properties: {} }, null, 2),
  };
}

function packageFromForm(kind: Kind, f: Form): { pkg: { manifest: Record<string, unknown>; files: Record<string, string> }; error?: string } {
  const props: Record<string, unknown> = {};
  for (const r of f.fields) {
    if (!r.name) continue;
    props[r.name] = { type: r.type, ...(r.description ? { description: r.description } : {}), ...(r.type === "string" ? { maxLength: 2000 } : {}) };
  }
  const input: ObjectSchema = { type: "object", properties: props as ObjectSchema["properties"], ...(f.fields.some((r) => r.required && r.name) ? { required: f.fields.filter((r) => r.required && r.name).map((r) => r.name) } : {}) } as ObjectSchema;
  let output: unknown, steps: unknown, args: unknown;
  try { output = JSON.parse(f.outputJson || "{}"); } catch { return { pkg: { manifest: {}, files: {} }, error: "مخطط المخرجات ليس JSON صالحاً" }; }
  const files: Record<string, string> = {};
  let execution: Record<string, unknown>;
  const deps = { skills: [] as string[], actions: [] as string[], native: [] as string[] };
  if (kind === "skill") {
    if (f.execType === "prompt") { execution = { type: "prompt", instructionsFile: "instructions.md" }; files["instructions.md"] = f.instructions; }
    else if (f.execType === "workflow") {
      try { steps = JSON.parse(f.stepsJson); } catch { return { pkg: { manifest: {}, files: {} }, error: "خطوات المسار ليست JSON صالحاً" }; }
      execution = { type: "workflow", steps };
      for (const s of (steps as Array<{ use?: string }>) ?? []) {
        if (s.use?.startsWith("skill:")) deps.skills.push(s.use.slice(6));
        else if (s.use?.startsWith("action:")) deps.actions.push(s.use.slice(7));
      }
    } else { execution = { type: f.execType, entry: f.entry }; if (f.execType === "native" && f.entry) deps.native.push(f.entry); }
  } else if (f.execType === "executable") execution = { type: "executable", entry: f.entry };
  else {
    try { args = JSON.parse(f.argsJson || "{}"); } catch { return { pkg: { manifest: {}, files: {} }, error: "وسائط الإجراء ليست JSON صالحاً" }; }
    execution = { type: "declarative", action: f.action, args };
    if (f.action) deps.actions.push(f.action);
  }
  const manifest: Record<string, unknown> = {
    kind, id: f.id, version: f.version, name: f.name, description: f.description, category: f.category,
    tags: f.tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean), author: f.author, stability: f.stability, permissions: f.permissions,
    dependencies: { skills: [...new Set(deps.skills)], actions: [...new Set(deps.actions)], native: [...new Set(deps.native)] },
    input, output, execution, ...(kind === "tool" ? { requiresApproval: f.requiresApproval } : {}),
  };
  return { pkg: { manifest, files } };
}

export function Editor({ kind, meta, initial, editing, onSaved, onCancel }: {
  kind: Kind; meta: Meta; initial?: Pkg | { manifest: Record<string, unknown>; files: Record<string, string> }; editing?: boolean;
  onSaved: (id: string) => void; onCancel: () => void;
}) {
  const [tab, setTab] = useState<"form" | "json">(editing ? "json" : "form");
  const [form, setForm] = useState<Form>(() => (initial ? formFromPackage(initial as never) : EMPTY));
  const [text, setText] = useState(() => (initial ? JSON.stringify({ manifest: { ...(initial.manifest as object), integrity: undefined }, files: initial.files }, null, 2) : ""));
  const [report, setReport] = useState<{ ok: boolean; issues: Array<{ level: string; message: string; code?: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const currentPkg = useCallback((): { pkg?: unknown; error?: string } => {
    if (tab === "form") { const r = packageFromForm(kind, form); return r.error ? { error: r.error } : { pkg: r.pkg }; }
    try { return { pkg: JSON.parse(text) }; } catch { return { error: "JSON غير صالح" }; }
  }, [tab, form, text, kind]);

  // تحقق حيّ (مؤجَّل 500ms)
  const seq = useRef(0);
  useEffect(() => {
    const cur = currentPkg();
    if (cur.error) { setReport({ ok: false, issues: [{ level: "error", message: cur.error }] }); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await api("/api/extensions", { method: "POST", body: { op: "validate", kind, package: cur.pkg } });
      if (n === seq.current && r.ok) setReport(r.data);
    }, 500);
    return () => clearTimeout(t);
  }, [currentPkg, kind]);

  const toJson = () => { const r = packageFromForm(kind, form); if (r.error) return setErr(r.error); setText(JSON.stringify(r.pkg, null, 2)); setErr(""); setTab("json"); };
  const toForm = () => {
    try { setForm(formFromPackage(JSON.parse(text))); setErr(""); setTab("form"); } catch { setErr("تعذّر قراءة JSON — أصلحه أولاً"); }
  };
  const loadTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setForm(formFromPackage(t.pkg as never));
    setText(JSON.stringify(t.pkg, null, 2));
  };

  const save = async () => {
    const cur = currentPkg();
    if (cur.error) return setErr(cur.error);
    setBusy(true); setErr("");
    const id = (cur.pkg as { manifest?: { id?: string } }).manifest?.id ?? "";
    const r = editing
      ? await api(`/api/extensions/${kind === "skill" ? "skills" : "tools"}/${id}`, { method: "PUT", body: { package: cur.pkg } })
      : await api("/api/extensions", { method: "POST", body: { op: "create", kind, package: cur.pkg } });
    setBusy(false);
    if (!r.ok) return setErr(errText(r.data));
    onSaved(id);
  };

  const togglePerm = (p: string) => set("permissions", form.permissions.includes(p) ? form.permissions.filter((x) => x !== p) : [...form.permissions, p]);
  const templates = useMemo(() => TEMPLATES.filter((t) => t.kind === kind), [kind]);
  const execTypes = kind === "skill" ? ["native", "prompt", "workflow", "external"] : ["declarative", "executable"];
  const execLabels: Record<string, string> = { native: "أصلي (TypeScript مسجّل)", prompt: "تعليمات لنموذج", workflow: "مسار عمل", external: "خارجي مقيَّد", declarative: "إعلانية (إجراء معتمد)", executable: "برنامج خارجي مقيَّد" };
  const action = meta.actions.find((a) => a.id === form.action);

  return (
    <div className="space-y-3">
      {editing && <p className="text-xs rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 p-2">التعديل يحفظ <b>إصداراً جديداً</b>: ارفع رقم <code dir="ltr">version</code> فوق كل الإصدارات المحفوظة (الإصدارات المحفوظة غير قابلة للتعديل). الإصدار الجديد لا يُفعَّل تلقائياً إن كانت الإضافة مفعّلة.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="طريقة التحرير" className="flex rounded-lg border border-line overflow-hidden text-xs">
          <button role="tab" aria-selected={tab === "form"} onClick={tab === "json" ? toForm : undefined} className={`px-3 py-1.5 ${tab === "form" ? "bg-brand text-white" : "bg-bg-soft text-ink-soft"}`}>نموذج مرئي</button>
          <button role="tab" aria-selected={tab === "json"} onClick={tab === "form" ? toJson : undefined} className={`px-3 py-1.5 ${tab === "json" ? "bg-brand text-white" : "bg-bg-soft text-ink-soft"}`}>متقدّم (JSON)</button>
        </div>
        {!editing && (
          <select aria-label="قالب بداية" defaultValue="" onChange={(e) => e.target.value && loadTemplate(e.target.value)} className={`${inputCls} !w-auto`}>
            <option value="">ابدأ من قالب…</option>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        )}
      </div>

      {tab === "form" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="المعرّف (id)" hint="snake_case صغيرة، 3–48 حرفاً. يُكشف باسم ext_<id>."><input dir="ltr" disabled={editing} className={inputCls} value={form.id} onChange={(e) => set("id", e.target.value)} /></Field>
          <Field label="الاسم"><input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="الوصف"><textarea rows={2} className={inputCls} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field></div>
          <Field label="التصنيف"><select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>{meta.categories.map((c) => <option key={c} value={c}>{CAT_AR[c] ?? c}</option>)}</select></Field>
          <Field label="الوسوم (مفصولة بفاصلة)"><input className={inputCls} value={form.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
          <Field label="المؤلف"><input className={inputCls} value={form.author} onChange={(e) => set("author", e.target.value)} /></Field>
          <Field label="الإصدار"><input dir="ltr" className={inputCls} value={form.version} onChange={(e) => set("version", e.target.value)} /></Field>
          <Field label="الاستقرار"><select className={inputCls} value={form.stability} onChange={(e) => set("stability", e.target.value)}><option value="experimental">تجريبية</option><option value="stable">مستقرة</option></select></Field>
          <Field label="نوع التنفيذ"><select className={inputCls} value={form.execType} onChange={(e) => set("execType", e.target.value)}>{execTypes.map((t) => <option key={t} value={t}>{execLabels[t]}</option>)}</select></Field>

          <div className="sm:col-span-2 space-y-2 rounded-lg border border-line p-3">
            {form.execType === "native" && (
              <Field label="الإدخال الأصلي المسجّل" hint="تُسجَّل الإدخالات في كود التطبيق فقط — لا تحميل شيفرة من الحزمة.">
                <select className={inputCls} value={form.entry} onChange={(e) => set("entry", e.target.value)}><option value="">— اختر —</option>{meta.native.map((n) => <option key={n.id} value={n.id}>{n.id} — {n.description}</option>)}</select>
              </Field>
            )}
            {(form.execType === "external" || form.execType === "executable") && (
              <Field label="اسم الإدخال في قائمة سماح المالك" hint={meta.externalEnabled ? "التنفيذ الخارجي مفعّل على الخادم." : "⚠ التنفيذ الخارجي معطّل على الخادم (MONTAGE_EXT_EXTERNAL) — لن تعمل الإضافة حتى يفعّله المالك."}>
                <input dir="ltr" className={inputCls} value={form.entry} onChange={(e) => set("entry", e.target.value)} />
              </Field>
            )}
            {form.execType === "prompt" && (
              <Field label="التعليمات (instructions.md)" hint="تُرسل لنموذج المحادثة. الناتج يُوسم «نموذج ذكاء اصطناعي» — لا تحليل وسائط.">
                <textarea rows={6} className={inputCls} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
              </Field>
            )}
            {form.execType === "workflow" && (
              <Field label="الخطوات (JSON)" hint='مثال: [{"use":"action:project.list","with":{}}, {"use":"skill:SilenceDetectionSkill","with":{"projectId":"{{input.projectId}}"}}]'>
                <textarea dir="ltr" rows={6} className={`${inputCls} font-mono text-xs`} value={form.stepsJson} onChange={(e) => set("stepsJson", e.target.value)} />
              </Field>
            )}
            {form.execType === "declarative" && (
              <>
                <Field label="الإجراء المعتمد">
                  <select className={inputCls} value={form.action} onChange={(e) => set("action", e.target.value)}><option value="">— اختر —</option>{meta.actions.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.title} [{a.risk}]</option>)}</select>
                </Field>
                {action && <p className="text-[11px] text-ink-soft">{action.description} • صلاحيات: {action.permissions.map((p) => PERM_AR[p] ?? p).join("، ") || "—"} • الحقول: <span dir="ltr">{Object.keys(action.input.properties).join(", ") || "—"}</span></p>}
                <Field label="وسائط الإجراء (JSON)" hint='قيم ثابتة أو مراجع مثل "{{input.projectId}}" — لا غير.'><textarea dir="ltr" rows={4} className={`${inputCls} font-mono text-xs`} value={form.argsJson} onChange={(e) => set("argsJson", e.target.value)} /></Field>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} /> اطلب موافقة عند كل استدعاء (حتى للقراءة)</label>
              </>
            )}
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-ink-soft">حقول المدخلات</span>
              <button type="button" className="btn-outline text-xs px-2 py-1" onClick={() => set("fields", [...form.fields, { name: "", type: "string", required: false, description: "" }])}><Plus className="h-3 w-3" /> حقل</button>
            </div>
            {form.fields.length === 0 && <p className="text-[11px] text-ink-mute">لا حقول — الإضافة لا تأخذ مدخلات.</p>}
            <div className="space-y-1.5">
              {form.fields.map((r, i) => {
                const upd = (patch: Partial<FieldRow>) => set("fields", form.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="grid grid-cols-[1fr_90px_auto_auto] sm:grid-cols-[140px_100px_1fr_auto_auto] gap-1.5 items-center">
                    <input aria-label="اسم الحقل" dir="ltr" placeholder="name" className={inputCls} value={r.name} onChange={(e) => upd({ name: e.target.value })} />
                    <select aria-label="النوع" className={inputCls} value={r.type} onChange={(e) => upd({ type: e.target.value })}>{["string", "number", "integer", "boolean"].map((t) => <option key={t}>{t}</option>)}</select>
                    <input aria-label="وصف الحقل" placeholder="وصف" className={`${inputCls} col-span-4 sm:col-span-1 order-last sm:order-none`} value={r.description} onChange={(e) => upd({ description: e.target.value })} />
                    <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={r.required} onChange={(e) => upd({ required: e.target.checked })} /> مطلوب</label>
                    <button type="button" aria-label="حذف الحقل" className="btn-ghost p-1" onClick={() => set("fields", form.fields.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2"><Field label="مخطط المخرجات (JSON)" hint="اختياري. الحقول غير المعرّفة تُحذف من المخرجات ويُتحقق من الباقي."><textarea dir="ltr" rows={4} className={`${inputCls} font-mono text-xs`} value={form.outputJson} onChange={(e) => set("outputJson", e.target.value)} /></Field></div>
          <fieldset className="sm:col-span-2 rounded-lg border border-line p-3">
            <legend className="text-xs text-ink-soft px-1">الصلاحيات المعلنة (يمنحها المالك لاحقاً)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {meta.permissions.map((p) => <label key={p} className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={form.permissions.includes(p)} onChange={() => togglePerm(p)} /> {PERM_AR[p] ?? p} <code className="text-ink-mute" dir="ltr">{p}</code></label>)}
            </div>
          </fieldset>
        </div>
      ) : (
        <Field label="الحزمة الكاملة: { manifest, files }" hint="هذا هو مصدر الحقيقة — بصمة السلامة (integrity) تُحسب تلقائياً عند الحفظ.">
          <textarea dir="ltr" aria-label="JSON الحزمة" rows={20} spellCheck={false} className={`${inputCls} font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}

      <div aria-live="polite">
        <h4 className="text-xs font-semibold text-ink-soft mb-1">التحقق الحيّ</h4>
        {report ? <IssueList issues={report.issues} /> : <p className="text-xs text-ink-mute">…</p>}
      </div>
      {err && <p role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md p-2">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-outline" onClick={onCancel}>إلغاء</button>
        <button className="btn-primary" disabled={busy || (report !== null && !report.ok)} onClick={save}>{busy ? "…" : editing ? "حفظ إصدار جديد" : "إنشاء (معطّلة)"}</button>
      </div>
    </div>
  );
}
