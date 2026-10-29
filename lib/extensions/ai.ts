// استدعاء نموذج المحادثة لمهارات prompt — عبر ضابط التكلفة، ومن دون أي مخرج مُختلق.
import { EngineError } from "@/lib/engine/errors";
import { getChatModel, getOpencodeBaseUrl } from "@/lib/server/api-keys";
import { guardCost, recordSpend } from "@/lib/server/cost-guard";

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

/** بلا مفتاح ⇒ DEPENDENCY_MISSING (لا نتيجة بديلة مُختلقة). التجاوز للسقف ⇒ LIMIT_EXCEEDED. */
export async function callChat(req: ChatRequest): Promise<{ text: string; model: string; estimateUsd: number }> {
  const key = req.apiKey || process.env.OPENCODE_API_KEY;
  if (!key) {
    throw new EngineError("DEPENDENCY_MISSING", "OPENCODE_API_KEY غير مضبوط — لا يمكن تشغيل مهارة تعتمد على نموذج", "اضبط المفتاح في إعدادات API أو بيئة الخادم. لن تُعاد نتيجة بديلة مُختلقة.");
  }
  const guard = guardCost("chat", { chars: req.system.length + req.user.length + req.maxTokens * 4 });
  if (!guard.allowed) throw new EngineError("LIMIT_EXCEEDED", guard.reason ?? "تجاوز سقف التكلفة");
  const model = getChatModel();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
  const onAbort = () => ctl.abort();
  req.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`${getOpencodeBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        response_format: { type: "json_object" },
      }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new EngineError("EXECUTION_FAILED", `فشل مزوّد النموذج (HTTP ${res.status})`);
    recordSpend(guard.estimateUsd);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { text: data.choices?.[0]?.message?.content ?? "", model, estimateUsd: guard.estimateUsd };
  } catch (e) {
    if (e instanceof EngineError) throw e;
    if (ctl.signal.aborted) throw new EngineError(req.signal?.aborted ? "CANCELLED" : "TIMEOUT", "انتهت مهلة/أُلغي استدعاء النموذج");
    throw new EngineError("EXECUTION_FAILED", `تعذّر الوصول لمزوّد النموذج: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onAbort);
  }
}
