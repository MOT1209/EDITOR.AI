// نتائج أدوات MCP الموحّدة (نجاح مهيكل / خطأ قابل للتصرف) — مشتركة بين الأدوات المدمجة والمخصّصة.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok<T extends Record<string, unknown>>(data: T, summary?: string): CallToolResult {
  const text = (summary ? summary + "\n" : "") + JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: text.length > 60_000 ? text.slice(0, 60_000) + "\n…(مقتطع)" : text }], structuredContent: data };
}

/**
 * نتيجة خطأ: بلا structuredContent عمداً — عملاء MCP يتحققون من structuredContent
 * مقابل outputSchema (مخطط النجاح) حتى مع isError، فيرفضون أي كائن خطأ.
 * السطر الأخير من النص JSON قابل للقراءة آلياً: {"error":{code,message,hint}}.
 */
export function fail(code: string, message: string, hint?: string): CallToolResult {
  const error = { code, message, ...(hint ? { hint } : {}) };
  return {
    isError: true,
    content: [{ type: "text", text: `[${code}] ${message}${hint ? `\nتلميح: ${hint}` : ""}\n${JSON.stringify({ error })}` }],
  };
}

/** يستخرج كائن الخطأ من نتيجة أداة فاشلة (للعملاء والاختبارات). */
export function parseToolError(text: string): { code: string; message: string; hint?: string } | null {
  const last = text.trim().split("\n").pop() ?? "";
  try {
    return (JSON.parse(last) as { error: { code: string; message: string; hint?: string } }).error ?? null;
  } catch {
    return null;
  }
}

