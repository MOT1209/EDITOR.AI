"use client";
// معاينة مخطط: جدول حقول مقروء + JSON خام قابل للطي.
import { Json } from "./ui";
import type { FieldSchema } from "./types";

function constraint(f: FieldSchema): string {
  const c: string[] = [];
  if (f.enum) c.push(`قيم: ${f.enum.join(" | ")}`);
  if (f.minimum !== undefined) c.push(`≥ ${f.minimum}`);
  if (f.maximum !== undefined) c.push(`≤ ${f.maximum}`);
  if (f.maxLength !== undefined) c.push(`طول ≤ ${f.maxLength}`);
  if (f.default !== undefined) c.push(`افتراضي: ${JSON.stringify(f.default)}`);
  return c.join("، ");
}

export function SchemaView({ schema, title }: { schema?: FieldSchema; title: string }) {
  const props = Object.entries(schema?.properties ?? {});
  const req = new Set(schema?.required ?? []);
  return (
    <div>
      <h4 className="text-xs font-semibold text-ink-soft mb-1">{title}</h4>
      {props.length === 0 ? (
        <p className="text-[11px] text-ink-mute">بلا حقول معرّفة</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[11px]">
            <thead className="bg-bg-soft text-ink-mute"><tr><th className="text-start p-1.5">الحقل</th><th className="text-start p-1.5">النوع</th><th className="text-start p-1.5">مطلوب</th><th className="text-start p-1.5">تفاصيل</th></tr></thead>
            <tbody>
              {props.map(([k, f]) => (
                <tr key={k} className="border-t border-line/60">
                  <td className="p-1.5 font-mono" dir="ltr">{k}</td>
                  <td className="p-1.5 font-mono" dir="ltr">{f.type}{f.items ? `<${f.items.type}>` : ""}</td>
                  <td className="p-1.5">{req.has(k) ? "نعم" : "لا"}</td>
                  <td className="p-1.5 text-ink-soft">{[f.description, constraint(f)].filter(Boolean).join(" — ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="mt-1"><summary className="text-[10px] text-ink-mute cursor-pointer">JSON</summary><Json value={schema} /></details>
    </div>
  );
}

/** قيم تجريبية من مخطط المدخلات لتعبئة المختبِر. */
export function sampleFromSchema(schema?: FieldSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema?.properties ?? {})) {
    if (f.default !== undefined) out[k] = f.default;
    else if (f.enum?.length) out[k] = f.enum[0];
    else if (f.type === "string") out[k] = /id$/i.test(k) ? "" : "نص تجريبي";
    else if (f.type === "number" || f.type === "integer") out[k] = f.minimum ?? 1;
    else if (f.type === "boolean") out[k] = false;
    else if (f.type === "array") out[k] = [];
    else out[k] = {};
  }
  return out;
}
