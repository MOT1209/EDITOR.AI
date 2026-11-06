/** لا مسارات قرص في الاستجابة (سياسة T-03): source_path ⇒ اسم الملف، وأي ظهور لجذر المشروع يُستبدل. */
export function scrub<T>(value: T): T {
  const cwd = process.cwd();
  const text = JSON.stringify(value, (k, v) => (k === "source_path" && typeof v === "string" ? v.split(/[/\\]/).pop() : v));
  return JSON.parse(cwd ? text.split(cwd).join(".").split(cwd.replace(/\\/g, "\\\\")).join(".") : text) as T;
}

