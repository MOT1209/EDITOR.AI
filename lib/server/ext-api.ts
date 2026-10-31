// أدوات مشتركة لمسارات /api/extensions: تحليل النوع، حدود الجسم، تحويل الأخطاء، موافقة الواجهة.
import { NextRequest, NextResponse } from "next/server";
import { isEngineError, type EngineErrorCode } from "@/lib/engine/errors";
import { EngineError } from "@/lib/engine/errors";
import type { ExtensionKind } from "@/lib/extensions/manifest";
import type { ApproveFn } from "@/lib/extensions/runtime";
import { getOpencodeKey } from "@/lib/server/api-keys";
import { consumeApproval, requestApproval } from "@/lib/server/approvals";

export const MAX_BODY_BYTES = 600_000;

const STATUS: Partial<Record<EngineErrorCode, number>> = {
  NOT_FOUND: 404, INVALID_INPUT: 400, OUT_OF_RANGE: 400, FORBIDDEN_PATH: 403, UNSUPPORTED: 409, CONFLICT: 409,
  DEPENDENCY_MISSING: 424, EXECUTION_FAILED: 500, TIMEOUT: 504, CANCELLED: 499, APPROVAL_DENIED: 403, LIMIT_EXCEEDED: 413,
};

export function parseKind(v: string): ExtensionKind {
  if (v === "skills" || v === "skill") return "skill";
  if (v === "tools" || v === "tool") return "tool";
  throw new EngineError("INVALID_INPUT", "kind يجب أن يكون skills أو tools");
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new EngineError("LIMIT_EXCEEDED", "الطلب أكبر من الحد المسموح");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("x");
    return v as Record<string, unknown>;
  } catch {
    throw new EngineError("INVALID_INPUT", "جسم الطلب يجب أن يكون كائن JSON");
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (isEngineError(e)) return NextResponse.json({ error: e.message, code: e.code, hint: e.hint }, { status: STATUS[e.code] ?? 500 });
  return NextResponse.json({ error: `خطأ غير متوقع: ${(e as Error).message?.slice(0, 200) ?? "؟"}`, code: "INTERNAL" }, { status: 500 });
}

/**
 * الواجهة تؤكد صراحة قبل التنفيذ الكاتب/المكلف/الخارجي. التأكيد لا يُقبل من العميل وحده:
 * يجب أن يكون الخادم قد سجّل موافقة معلّقة لنفس (النطاق، الإجراء) في محاولة سابقة غير مؤكَّدة،
 * وتُستهلك لمرة واحدة (lib/server/approvals.ts).
 */
export function uiApprover(confirmed: boolean, scope = ""): ApproveFn {
  return async ({ action, summary }) => {
    const key = `${scope}:${action}`;
    if (confirmed && consumeApproval(key)) return;
    requestApproval(key);
    throw new EngineError("APPROVAL_DENIED", `العملية «${action}» تتطلب تأكيد المستخدم: ${summary}`, "أكّد التنفيذ في نافذة التأكيد.");
  };
}

/**
 * موافقة صريحة لعملية حساسة (منح صلاحيات/حذف) — T-05: لا يكفي confirm:true من العميل؛ يجب أن يكون الخادم قد
 * سجّل طلب موافقة (action:"request_approval" عند فتح نافذة التأكيد) لنفس (النطاق، العملية)، وتُستهلك لمرة واحدة.
 */
export function requireSensitiveApproval(scope: string, op: "grant" | "delete", confirmed: boolean): void {
  const key = `${scope}:op:${op}`;
  if (confirmed && consumeApproval(key)) return;
  requestApproval(key);
  throw new EngineError("APPROVAL_DENIED", `العملية «${op}» تتطلب تأكيداً صريحاً من نافذة التأكيد`, "افتح نافذة التأكيد ثم أكّد.");
}

export function requestSensitiveApproval(scope: string, op: "grant" | "delete"): void {
  requestApproval(`${scope}:op:${op}`);
}

export const apiKeyOf = (req: NextRequest) => getOpencodeKey(req);
