// ====================================================================
// ربط سجل الأدوات المخصّصة بخادم MCP (SDK الرسمي) — تسجيل ديناميكي بلا تعديل server.ts لكل أداة.
//
// - تُكشف فقط الأدوات: مفعّلة + صالحة + متوافقة + منحت صلاحياتها (+ التنفيذ الخارجي ممكّن للمنفّذات).
// - الاسم المكشوف دائماً ext_<id>: لا يصطدم بأداة مدمجة ولا يُكتب فوق أداة أخرى.
// - كل استدعاء يُعاد فيه تحميل الحزمة والتحقق من الحالة والمدخلات والصلاحيات (لا تخزين مؤقت للتفويض).
// - تغيّر السجل (من واجهة الإدارة أو أي عملية) يُكتشف بفحص دوري خفيف ⇒ إضافة/إزالة/تحديث الأداة
//   في الخادم المتصل ⇒ SDK يرسل notifications/tools/list_changed تلقائياً.
// - سجل التعرّض الفعلي يُكتب في <workspace>/extensions/mcp-exposure.json (تقرأه الواجهة).
// ====================================================================
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EngineError, isEngineError } from "@/lib/engine/errors";
import { auditLog, workspaceRoot, writeJsonAtomic } from "@/lib/engine/store";
import { externalEnabled } from "@/lib/extensions/external";
import { runtimeName, type ToolManifest } from "@/lib/extensions/manifest";
import { objectToZod } from "@/lib/extensions/schema";
import { runExtension, listExtensions } from "@/lib/extensions/service";
import { listStates, readVersion, registryRev } from "@/lib/extensions/store";
import { getAction } from "@/lib/extensions/actions";
import { validatePackage } from "@/lib/extensions/validate";
import path from "path";
import { requireApproval, type Approver } from "./approval";
import { fail, ok } from "./results";

export interface Exposure {
  updatedAt: string;
  pid: number;
  exposed: Array<{ name: string; id: string; version: string; risk: string }>;
  skipped: Array<{ id: string; reason: string }>;
}

export interface CustomToolsControl {
  /** يُوفّق الأدوات المسجّلة مع السجل الدائم الآن. */
  sync(): Promise<Exposure>;
  exposure(): Exposure;
  dispose(): void;
}

const OUT = {
  tool: z.string(),
  version: z.string(),
  provenance: z.enum(["simulated", "real-analysis", "computed", "ai-model"]),
  result: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  durationMs: z.number(),
};

export function exposureFile(): string {
  return path.join(workspaceRoot(), "extensions", "mcp-exposure.json");
}

export function attachCustomTools(server: McpServer, approver: Approver, opts: { pollMs?: number } = {}): CustomToolsControl {
  const registered = new Map<string, { rt: RegisteredTool; version: string; digest: string }>();
  let current: Exposure = { updatedAt: new Date().toISOString(), pid: process.pid, exposed: [], skipped: [] };
  let lastRev = -1;
  let syncing: Promise<Exposure> | null = null;

  async function doSync(): Promise<Exposure> {
    const exposed: Exposure["exposed"] = [];
    const skipped: Exposure["skipped"] = [];
    const wanted = new Set<string>();
    for (const st of await listStates("tool")) {
      if (!st.enabled) continue;
      try {
        const pkg = await readVersion("tool", st.id, st.activeVersion);
        const m = pkg.manifest as ToolManifest;
        const report = await validatePackage(pkg);
        if (!report.ok) { skipped.push({ id: st.id, reason: report.issues.find((i) => i.level === "error")?.message ?? "غير صالحة" }); continue; }
        const missing = report.requiredPermissions.filter((p) => !st.grants.includes(p));
        if (missing.length) { skipped.push({ id: st.id, reason: `صلاحيات غير ممنوحة: ${missing.join(", ")}` }); continue; }
        if (m.execution.type === "executable" && !externalEnabled()) { skipped.push({ id: st.id, reason: "التنفيذ الخارجي معطّل على الخادم" }); continue; }
        const name = runtimeName(st.id);
        const digest = st.versions.find((v) => v.version === st.activeVersion)?.digest ?? "";
        const risk = m.execution.type === "declarative" ? (getAction(m.execution.action)?.risk ?? "read") : "costly";
        wanted.add(name);
        const prev = registered.get(name);
        if (prev && prev.version === st.activeVersion && prev.digest === digest) {
          exposed.push({ name, id: st.id, version: st.activeVersion, risk });
          continue;
        }
        prev?.rt.remove();
        registered.delete(name);
        const readOnly = m.execution.type === "declarative" && risk === "read" && !m.requiresApproval;
        let rt: RegisteredTool;
        try {
          rt = server.registerTool(
            name,
            {
              title: `${m.name} (مخصّصة)`,
              description: `${m.description}\n[أداة مخصّصة ${st.id}@${st.activeVersion} — ${m.execution.type}]`,
              inputSchema: objectToZod(m.input), // صارم: الحقول غير المعرّفة تُرفض (لا تُهمل بصمت)
              outputSchema: OUT,
              annotations: { readOnlyHint: readOnly, destructiveHint: risk === "write", idempotentHint: false, openWorldHint: m.execution.type === "executable" },
            },
            (async (args: Record<string, unknown>, extra: { signal: AbortSignal }) => callCustom(st.id, args, extra.signal)) as never
          );
        } catch (e) {
          skipped.push({ id: st.id, reason: `تعذّر التسجيل: ${(e as Error).message}` });
          continue;
        }
        registered.set(name, { rt, version: st.activeVersion, digest });
        exposed.push({ name, id: st.id, version: st.activeVersion, risk });
      } catch (e) {
        skipped.push({ id: st.id, reason: (e as Error).message });
      }
    }
    // إزالة ما لم يعد مطلوباً (حُذف/عُطّل/أصبح غير صالح).
    for (const [name, r] of registered) {
      if (!wanted.has(name)) {
        r.rt.remove();
        registered.delete(name);
      }
    }
    current = { updatedAt: new Date().toISOString(), pid: process.pid, exposed, skipped };
    await writeJsonAtomic(exposureFile(), current).catch(() => {});
    return current;
  }

  async function callCustom(id: string, args: Record<string, unknown>, signal: AbortSignal) {
    const started = Date.now();
    const name = runtimeName(id);
    try {
      const res = await runExtension("tool", id, args, { mode: "mcp", signal, approve: (r) => requireApproval(approver, r) });
      await auditLog({ tool: name, ok: res.ok, code: res.error?.code, ms: Date.now() - started, custom: true });
      if (!res.ok) return fail(res.error!.code, res.error!.message, res.error!.hint);
      return ok({ tool: name, version: res.version, provenance: res.provenance ?? "computed", result: res.output ?? {}, warnings: res.warnings, durationMs: res.durationMs });
    } catch (e) {
      const code = isEngineError(e) ? e.code : "INTERNAL";
      await auditLog({ tool: name, ok: false, code, ms: Date.now() - started, custom: true });
      if (isEngineError(e)) return fail(e.code, e.message, e.hint);
      return fail("INTERNAL", `خطأ غير متوقع: ${(e as Error).message?.slice(0, 300)}`);
    }
  }

  const sync = (): Promise<Exposure> => {
    syncing ??= doSync().finally(() => { syncing = null; });
    return syncing;
  };

  // أدوات مدمجة وصفية (تُسجَّل مرة واحدة)
  server.registerTool(
    "list_custom_tools",
    {
      title: "الأدوات المخصّصة",
      description: "الأدوات المخصّصة في السجل وحالتها، وما يُكشف فعلاً لعملاء MCP الآن (exposed) وما تم تخطيه ولماذا (skipped).",
      inputSchema: {},
      outputSchema: {
        exposed: z.array(z.object({ name: z.string(), id: z.string(), version: z.string(), risk: z.string() })),
        skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
        registry: z.array(z.object({ id: z.string(), name: z.string(), version: z.string(), status: z.string(), label: z.string(), executionType: z.string() })),
        note: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (async () => {
      const exp = await sync();
      const registry = (await listExtensions("tool")).map((e) => ({ id: e.id, name: e.name, version: e.version, status: e.status, label: e.label, executionType: e.executionType }));
      return ok({ exposed: exp.exposed, skipped: exp.skipped, registry, note: "العملاء الداعمون لـ listChanged يحدّثون القائمة تلقائياً؛ غيرهم يعيدون الاتصال أو يستدعون tools/list." });
    }) as never
  );
  server.registerTool(
    "refresh_custom_tools",
    {
      title: "تحديث الأدوات المخصّصة",
      description: "يوفّق قائمة الأدوات المخصّصة مع السجل فوراً (دون انتظار الفحص الدوري) ويُرسل إشعار تغيّر القائمة.",
      inputSchema: {},
      outputSchema: { exposed: z.number(), skipped: z.number() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (async () => {
      const exp = await sync();
      return ok({ exposed: exp.exposed.length, skipped: exp.skipped.length });
    }) as never
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  const pollMs = opts.pollMs ?? 2000;
  if (pollMs > 0) {
    timer = setInterval(async () => {
      try {
        const rev = await registryRev();
        if (rev !== lastRev) {
          lastRev = rev;
          await sync();
        }
      } catch {
        /* الفحص الدوري لا يُسقط الخادم */
      }
    }, pollMs);
    timer.unref?.();
  }
  void sync().then(async () => { lastRev = await registryRev(); }).catch(() => {});

  return {
    sync,
    exposure: () => current,
    dispose: () => timer && clearInterval(timer),
  };
}

export { EngineError };
