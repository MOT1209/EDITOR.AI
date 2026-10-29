// ====================================================================
// مخططات مدخلات/مخرجات الإضافات: مجموعة فرعية صغيرة ومحدودة من JSON Schema.
// لا $ref ولا pattern (تفادي ReDoS) ولا مخططات عودية؛ العمق والحجم محدودان.
// المخطط نفسه بيانات خالصة — لا يحمل تنفيذاً. يُحوَّل إلى Zod لـ MCP ويُتحقق به عند كل استدعاء.
// ====================================================================
import { z } from "zod";

export const SCHEMA_LIMITS = { maxProps: 30, maxEnum: 50, maxDepth: 3, maxString: 20_000, maxArray: 200 } as const;

export type FieldType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface FieldSchema {
  type: FieldType;
  description?: string;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minLength?: number;
  items?: FieldSchema;
  maxItems?: number;
  properties?: Record<string, FieldSchema>;
  required?: string[];
  default?: unknown;
}

export interface ObjectSchema extends FieldSchema {
  type: "object";
  properties: Record<string, FieldSchema>;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/;
const ALLOWED_KEYS = new Set(["type", "description", "enum", "minimum", "maximum", "maxLength", "minLength", "items", "maxItems", "properties", "required", "default", "additionalProperties", "title"]);

/** يتحقق من بنية المخطط نفسه ويعيد قائمة المشكلات (فارغة = سليم). */
export function lintSchema(schema: unknown, path = "$", depth = 0): string[] {
  const issues: string[] = [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [`${path}: المخطط يجب أن يكون كائناً`];
  const s = schema as Record<string, unknown>;
  for (const k of Object.keys(s)) {
    if (!ALLOWED_KEYS.has(k)) issues.push(`${path}: مفتاح غير مدعوم «${k}»`);
  }
  if (depth > SCHEMA_LIMITS.maxDepth) return [...issues, `${path}: عمق المخطط يتجاوز ${SCHEMA_LIMITS.maxDepth}`];
  const type = s.type;
  if (!["string", "number", "integer", "boolean", "array", "object"].includes(String(type))) {
    return [...issues, `${path}: type غير صالح`];
  }
  if (s.enum !== undefined) {
    if (!Array.isArray(s.enum) || s.enum.length === 0 || s.enum.length > SCHEMA_LIMITS.maxEnum || !s.enum.every((v) => typeof v === "string" || typeof v === "number")) {
      issues.push(`${path}: enum غير صالح (قيم نصية/رقمية، حتى ${SCHEMA_LIMITS.maxEnum})`);
    }
  }
  for (const k of ["minimum", "maximum", "maxLength", "minLength", "maxItems"] as const) {
    if (s[k] !== undefined && (typeof s[k] !== "number" || !Number.isFinite(s[k] as number))) issues.push(`${path}.${k}: يجب أن يكون رقماً`);
  }
  if (type === "array") {
    if (!s.items) issues.push(`${path}: array يتطلب items`);
    else issues.push(...lintSchema(s.items, `${path}[]`, depth + 1));
  }
  if (type === "object") {
    const props = s.properties;
    if (props !== undefined) {
      if (!props || typeof props !== "object" || Array.isArray(props)) issues.push(`${path}.properties: كائن مطلوب`);
      else {
        const keys = Object.keys(props);
        if (keys.length > SCHEMA_LIMITS.maxProps) issues.push(`${path}: أكثر من ${SCHEMA_LIMITS.maxProps} خاصية`);
        for (const key of keys) {
          if (!KEY_RE.test(key)) issues.push(`${path}.${key}: اسم خاصية غير صالح`);
          else issues.push(...lintSchema((props as Record<string, unknown>)[key], `${path}.${key}`, depth + 1));
        }
      }
    }
    if (s.required !== undefined) {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      if (!Array.isArray(s.required) || !s.required.every((r) => typeof r === "string" && r in props)) issues.push(`${path}.required: يجب أن يسرد خصائص معرّفة`);
    }
  }
  return issues;
}

function fieldToZod(f: FieldSchema): z.ZodType {
  let t: z.ZodType;
  switch (f.type) {
    case "string": {
      if (f.enum && f.enum.length && f.enum.every((v) => typeof v === "string")) {
        t = z.enum(f.enum as [string, ...string[]]);
      } else {
        let s = z.string().max(Math.min(f.maxLength ?? 2000, SCHEMA_LIMITS.maxString));
        if (f.minLength) s = s.min(f.minLength);
        t = s;
      }
      break;
    }
    case "number":
    case "integer": {
      let n = f.type === "integer" ? z.number().int() : z.number();
      if (f.minimum !== undefined) n = n.min(f.minimum);
      if (f.maximum !== undefined) n = n.max(f.maximum);
      t = f.enum && f.enum.length && f.enum.every((v) => typeof v === "number")
        ? z.union(f.enum.map((v) => z.literal(v as number)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>])
        : n;
      break;
    }
    case "boolean":
      t = z.boolean();
      break;
    case "array":
      t = z.array(fieldToZod(f.items as FieldSchema)).max(Math.min(f.maxItems ?? SCHEMA_LIMITS.maxArray, SCHEMA_LIMITS.maxArray));
      break;
    default:
      t = objectToZod(f as ObjectSchema);
  }
  if (f.description) t = t.describe(f.description);
  return t;
}

/** كائن Zod صارم (يرفض الحقول غير المعرّفة) — يُمرَّر لـ MCP كمخطط مدخلات كامل. */
export function objectToZod(s: ObjectSchema): z.ZodObject {
  const shape = objectShape(s);
  return z.object(shape).strict();
}

/** شكل Zod لخصائص الكائن (يُمرَّر مباشرة لـ registerTool.inputSchema). */
export function objectShape(s: ObjectSchema): z.ZodRawShape {
  const req = new Set(s.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [k, f] of Object.entries(s.properties ?? {})) {
    let t = fieldToZod(f);
    if (f.default !== undefined) t = (t as z.ZodType).default(f.default as never);
    else if (!req.has(k)) t = t.optional();
    shape[k] = t;
  }
  return shape;
}

export interface ValidationOutcome {
  ok: boolean;
  value?: Record<string, unknown>;
  errors: string[];
}

/** يتحقق من قيمة مقابل المخطط (صارم: يرفض الحقول غير المعرّفة). */
export function validateAgainst(schema: ObjectSchema, value: unknown): ValidationOutcome {
  const parsed = objectToZod(schema).safeParse(value ?? {});
  if (parsed.success) return { ok: true, value: parsed.data as Record<string, unknown>, errors: [] };
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).slice(0, 20) };
}

export const EMPTY_OBJECT_SCHEMA: ObjectSchema = { type: "object", properties: {} };
