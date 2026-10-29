// خطأ محرّك مُصنّف: رمز ثابت (للوكلاء/الاختبارات) + رسالة عربية + تلميح لما يجب فعله.
export type EngineErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "OUT_OF_RANGE"
  | "FORBIDDEN_PATH"
  | "UNSUPPORTED"
  | "CONFLICT"
  | "DEPENDENCY_MISSING"
  | "EXECUTION_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "APPROVAL_DENIED"
  | "LIMIT_EXCEEDED"
  | "NOTHING_TO_UNDO";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly hint?: string
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export function isEngineError(e: unknown): e is EngineError {
  return e instanceof EngineError;
}
