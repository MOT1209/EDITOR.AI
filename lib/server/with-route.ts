// معالجة أخطاء مسارات /api موحّدة (T-27): استجابة JSON عربية متسقة، تسجيل مهيكل، ولا مسارات قرص في أي رسالة.
//
// - EngineError ⇒ رسالته ورمزه وتلميحه بحالة HTTP من ENGINE_HTTP_STATUS.
// - أي خطأ آخر ⇒ 500 برمز INTERNAL ورسالة منقّحة (بلا مسارات قرص، ≤200 حرف)؛ الرسالة الكاملة في سجل الخادم فقط.
// - الاستعمال: `catch (e) { return routeError("ai.script", e); }` داخل المعالج، أو غلاف
//   `export const POST = withRoute("export", handler)` للمسارات بلا try/catch.
import { NextResponse, type NextRequest } from "next/server";
import { isEngineError, type EngineErrorCode } from "@/lib/engine/errors";
import { logger } from "@/lib/server/logger";

export const ENGINE_HTTP_STATUS: Partial<Record<EngineErrorCode, number>> = {
  NOT_FOUND: 404, INVALID_INPUT: 400, OUT_OF_RANGE: 400, FORBIDDEN_PATH: 403, UNSUPPORTED: 409, CONFLICT: 409,
  DEPENDENCY_MISSING: 424, EXECUTION_FAILED: 500, TIMEOUT: 504, CANCELLED: 499, APPROVAL_DENIED: 403, LIMIT_EXCEEDED: 413,
};

// مسار مطلق (POSIX أو Windows) من جزأين فأكثر. لا يطابق: نصاً عربياً بشرطة (ملفات/صور)، أرقاماً (1/2)، تواريخ، ولا
// ما يلي «:/» أو «//» (عناوين URL) — فلا تُشوَّه نصوص عادية.
const PATH_RE = /(?<![\w؀-ۿ/:.])(?:[A-Za-z]:\\(?:[^\\\s'"]+\\)*[^\\\s'"]*|\/(?:[\w.@+~-]+\/)+[\w.@+~-]*)/g;

/** يزيل مسارات القرص من نص خطأ (رسائل ffmpeg/ENOENT تتضمنها) ويقصّه. */
export function sanitizeErrorMessage(message: string, max = 300): string {
  return message.replace(PATH_RE, "[مسار]").replace(/\s+/g, " ").trim().slice(0, max);
}

export function routeError(route: string, e: unknown): NextResponse {
  if (isEngineError(e)) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(e.message, 600), code: e.code, ...(e.hint ? { hint: sanitizeErrorMessage(e.hint, 400) } : {}) },
      { status: ENGINE_HTTP_STATUS[e.code] ?? 500 }
    );
  }
  const raw = e instanceof Error ? e.message : String(e);
  logger.error("route.error", { route, message: raw });
  return NextResponse.json({ error: `خطأ غير متوقع: ${sanitizeErrorMessage(raw, 200) || "؟"}`, code: "INTERNAL" }, { status: 500 });
}

/** يغلّف معالجاً: أي استثناء غير ملتقَط ⇒ routeError (JSON متسق بدل 500 فارغ من Next). */
export function withRoute<A extends unknown[]>(
  route: string,
  handler: (req: NextRequest, ...rest: A) => Promise<Response> | Response
): (req: NextRequest, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      return routeError(route, e);
    }
  };
}
