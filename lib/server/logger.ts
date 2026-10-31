// سجلات مهيكلة (JSON سطر لكل حدث) مع إخفاء الأسرار — تكتب إلى stderr دائماً
// (stdout محجوز لبروتوكول MCP عبر stdio). المستوى: MONTAGE_LOG_LEVEL=debug|info|warn|error|silent.

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const SECRET_KEY = /(key|token|secret|password|passwd|authorization|cookie|credential)/i;
// قيم تشبه مفاتيح مزوّدين (sk-..., hf_..., Bearer ...) تُخفى حتى لو جاءت في نص حر.
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/g;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]").slice(0, 2000);
  if (typeof value !== "object") return value;
  if (depth > 4) return "[depth]";
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const lv = (process.env.MONTAGE_LOG_LEVEL || "info").toLowerCase() as LogLevel | "silent";
  return ORDER[lv] ?? ORDER.info;
}

export function formatLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}, now = new Date()): string {
  return JSON.stringify({ ts: now.toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) });
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  process.stderr.write(formatLog(level, event, fields) + "\n");
}

export const logger = {
  debug: (e: string, f?: Record<string, unknown>) => log("debug", e, f),
  info: (e: string, f?: Record<string, unknown>) => log("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => log("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => log("error", e, f),
};
