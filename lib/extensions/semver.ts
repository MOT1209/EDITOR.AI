// مقارنة إصدارات مبسّطة (major.minor.patch) ونطاقات من الشكل ">=0.2.0 <1.0.0" — بلا اعتماديات.
const V_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export function isSemver(v: string): boolean {
  return V_RE.test(v);
}

export function parseSemver(v: string): [number, number, number] {
  const m = V_RE.exec(v);
  if (!m) throw new Error(`إصدار غير صالح: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** يتحقق أن الإصدار يحقق كل مقارنات النطاق (مفصولة بمسافات؛ العوامل: >= > <= < =). */
export function satisfiesRange(version: string, range: string): boolean {
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => {
    const m = /^(>=|<=|>|<|=)?(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(p);
    if (!m) throw new Error(`نطاق إصدار غير صالح: ${p}`);
    const c = compareSemver(version, m[2]);
    switch (m[1] ?? "=") {
      case ">=": return c >= 0;
      case ">": return c > 0;
      case "<=": return c <= 0;
      case "<": return c < 0;
      default: return c === 0;
    }
  });
}

export function isValidRange(range: string): boolean {
  try {
    satisfiesRange("0.0.0", range);
    return true;
  } catch {
    return false;
  }
}
