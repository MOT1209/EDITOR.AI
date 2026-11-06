// حلّ قوالب الوسائط: {{input.x}} و{{steps.N.a.b}} فقط — بحث مسار منقّط، بلا تعبيرات ولا شيفرة.
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const REF_RE = /\{\{\s*([A-Za-z0-9_.]{1,120})\s*\}\}/g;
const WHOLE_RE = /^\{\{\s*([A-Za-z0-9_.]{1,120})\s*\}\}$/;

export interface TemplateScope {
  input: Record<string, unknown>;
  steps: unknown[];
}

function lookup(ref: string, scope: TemplateScope): unknown {
  const parts = ref.split(".");
  let cur: unknown;
  if (parts[0] === "input") cur = scope.input;
  else if (parts[0] === "steps") {
    const idx = Number(parts[1]);
    if (!Number.isInteger(idx) || idx < 0 || idx >= scope.steps.length) return undefined;
    cur = scope.steps[idx];
    parts.splice(1, 1);
  } else return undefined;
  for (const p of parts.slice(1)) {
    if (FORBIDDEN.has(p) || cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** يحلّ خريطة وسائط؛ مرجع كامل يحتفظ بنوع القيمة، ومرجع مدمج في نص يُحوَّل إلى نص. غير المحلول يُحذف. */
export function resolveArgs(args: Record<string, string | number | boolean | null>, scope: TemplateScope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "string") {
      out[k] = v;
      continue;
    }
    const whole = WHOLE_RE.exec(v);
    if (whole) {
      const val = lookup(whole[1], scope);
      if (val !== undefined) out[k] = val;
      continue;
    }
    out[k] = v.replace(REF_RE, (_m, r: string) => {
      const val = lookup(r, scope);
      return typeof val === "string" || typeof val === "number" || typeof val === "boolean" ? String(val) : "";
    });
  }
  return out;
}

/** المراجع المستخدمة في خريطة وسائط (للفحص الساكن). */
export function refsOf(args: Record<string, string | number | boolean | null>): string[] {
  const refs: string[] = [];
  for (const v of Object.values(args)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(REF_RE)) refs.push(m[1]);
  }
  return refs;
}

/** هل القيمة مرجع كامل لمدخل (يُحسب كمقدَّم للحقل)؟ */
export function wholeRef(v: unknown): string | null {
  return typeof v === "string" ? (WHOLE_RE.exec(v)?.[1] ?? null) : null;
}
