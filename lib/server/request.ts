// قراءة جسم JSON بحدّ حجم + تحقق مخطط zod. يرجع إما بيانات صالحة أو استجابة خطأ جاهزة.
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

export const DEFAULT_MAX_JSON_BYTES = 1_000_000;

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseJsonBody<T>(
  req: NextRequest,
  schema: ZodType<T>,
  opts: { maxBytes?: number } = {}
): Promise<ParsedBody<T>> {
  const max = opts.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) {
    return { ok: false, response: NextResponse.json({ error: "الطلب أكبر من الحد المسموح", code: "LIMIT_EXCEEDED" }, { status: 413 }) };
  }
  const text = await req.text().catch(() => "");
  if (text.length > max) {
    return { ok: false, response: NextResponse.json({ error: "الطلب أكبر من الحد المسموح", code: "LIMIT_EXCEEDED" }, { status: 413 }) };
  }
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: NextResponse.json({ error: "جسم الطلب ليس JSON صالحاً", code: "INVALID_INPUT" }, { status: 400 }) };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const details = r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(الجذر)"}: ${i.message}`);
    return { ok: false, response: NextResponse.json({ error: "مدخلات غير صالحة", code: "INVALID_INPUT", details }, { status: 400 }) };
  }
  return { ok: true, data: r.data };
}
