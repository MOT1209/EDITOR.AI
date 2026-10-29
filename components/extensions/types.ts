// أنواع واجهة مدير الإضافات + مساعد استدعاء API (يعكس lib/extensions/service.ts).
import { authHeaders } from "@/lib/api-config";

export type Kind = "skill" | "tool";
export const kindPath = (k: Kind) => (k === "skill" ? "skills" : "tools");

export interface Issue { level: "error" | "warn"; code: string; message: string }
export interface RunRecord { at: string; version: string; mode: string; ok: boolean; durationMs: number; provenance?: string; code?: string; error?: string; logs?: string[] }
export interface TestRecord { version: string; ok: boolean; at: string; durationMs: number; provenance?: string; error?: string }

export interface Summary {
  id: string; kind: Kind; runtimeName: string; name: string; description: string; category: string; tags: string[]; author: string;
  version: string; stability: string; origin: string; label: "builtin" | "user" | "imported" | "experimental"; executionType: string;
  status: "enabled" | "disabled" | "needs_grant" | "invalid" | "incompatible" | "unavailable"; enabled: boolean;
  permissions: string[]; grants: string[]; versions: string[]; lastRun?: RunRecord; lastTest?: TestRecord; issues: Issue[]; updatedAt: string;
}

export interface FieldSchema { type: string; description?: string; enum?: Array<string | number>; minimum?: number; maximum?: number; maxLength?: number; items?: FieldSchema; properties?: Record<string, FieldSchema>; required?: string[]; default?: unknown }
export interface ObjectSchema extends FieldSchema { type: "object"; properties: Record<string, FieldSchema> }

export interface Manifest {
  kind: Kind; id: string; version: string; name: string; description: string; category: string; tags: string[]; author: string; stability: string;
  permissions: string[]; dependencies: { skills: string[]; actions: string[]; native: string[] };
  config: { schema: ObjectSchema; defaults: Record<string, unknown> }; limits: { timeoutMs: number; maxOutputBytes: number };
  input: ObjectSchema; output: ObjectSchema; execution: Record<string, unknown> & { type: string }; requiresApproval?: boolean;
  integrity?: { digest: string }; compat?: { formatVersion: number; montage: string };
}
export interface Pkg { format: string; formatVersion: number; kind: Kind; manifest: Manifest; files: Record<string, string> }

export interface VersionEntry { version: string; savedAt: string; digest: string; note?: string }
export interface Detail {
  summary: Summary; package: Pkg; validation: { ok: boolean; issues: Issue[]; requiredPermissions: string[] };
  runs: RunRecord[]; versions: VersionEntry[]; state: { config: Record<string, unknown> };
}

export interface BuiltinSkill { id: string; name: string; description: string; category: string; inputSpec: Record<string, string>; outputSpec: Record<string, string> }
export interface BuiltinTool { name: string; title?: string; description?: string; readOnly: boolean; destructive: boolean; inputSchema: unknown; outputSchema?: unknown }
export interface ExposureInfo { running: boolean; present: boolean; updatedAt?: string; exposed?: Array<{ name: string; id: string; version: string; risk: string }>; skipped?: Array<{ id: string; reason: string }> }
export interface ActionInfo { id: string; title: string; description: string; permissions: string[]; risk: string; input: ObjectSchema }
export interface NativeInfo { id: string; description: string; permissions: string[]; provenance: string }
export interface Meta { platformVersion: string; permissions: string[]; categories: string[]; externalEnabled: boolean; actions: ActionInfo[]; native: NativeInfo[] }

export interface ListResponse { kind: Kind; items: Summary[]; meta: Meta; builtins: Array<BuiltinSkill & Record<string, unknown>> | BuiltinTool[]; exposure?: ExposureInfo }

export interface ApiResult<T = any> { ok: boolean; status: number; data: T }

export async function api<T = any>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: `تعذّر الاتصال بالخادم: ${(e as Error).message}` } as T };
  }
}

export const errText = (d: { error?: string; hint?: string }) => `${d.error ?? "خطأ غير معروف"}${d.hint ? ` — ${d.hint}` : ""}`;

export const LABEL_AR: Record<string, string> = { builtin: "مدمجة", user: "من إنشائي", imported: "مستوردة", experimental: "تجريبية" };
export const STATUS_AR: Record<string, string> = { enabled: "مفعّلة", disabled: "معطّلة", needs_grant: "تحتاج صلاحيات", invalid: "غير صالحة", incompatible: "غير متوافقة", unavailable: "غير متاحة" };
export const EXEC_AR: Record<string, string> = { prompt: "تعليمات/نموذج", workflow: "مسار عمل", native: "TypeScript أصلي", external: "خارجي مقيَّد", declarative: "إعلانية", executable: "برنامج خارجي" };
export const PERM_AR: Record<string, string> = {
  "project.read": "قراءة المشاريع", "project.write": "تعديل المشاريع", "render.export": "تصدير الفيديو", "media.read": "تحليل الوسائط", "skills.run": "تشغيل مهارات مدمجة",
  "ai.invoke": "استدعاء نموذج (مدفوع)", "exec.external": "برنامج خارجي",
};
export const CAT_AR: Record<string, string> = { analysis: "تحليل", editing: "تحرير", audio: "صوت", visual: "صورة", text: "نص", generation: "توليد", export: "تصدير", utility: "أدوات" };
export const PROV_AR: Record<string, string> = { "real-analysis": "تحليل حقيقي", computed: "حساب", "ai-model": "نموذج ذكاء اصطناعي", simulated: "محاكاة" };
