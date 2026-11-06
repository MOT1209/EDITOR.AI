// قبول المرحلة 5 عبر معالجات HTTP الحقيقية: إنشاء → تفعيل → تنفيذ → فحص المخرجات → تعطيل → تحديث →
// تصدير → استيراد → حذف، مع إثبات فرض الصلاحيات والقدرات والاكتشاف على الخادم.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { GET as listGet, POST as listPost } from "@/app/api/extensions/route";
import { DELETE as itemDelete, GET as itemGet, POST as itemPost, PUT as itemPut } from "@/app/api/extensions/[kind]/[id]/route";
import { GET as exportGet } from "@/app/api/extensions/[kind]/[id]/export/route";
import { GET as catalogGet, POST as catalogPost } from "@/app/api/extensions/catalog/route";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "montage_ext_acc_"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  process.env.MONTAGE_WORKSPACE = path.join(tmp, `ws_${Math.random().toString(36).slice(2)}`);
  delete process.env.OPENCODE_API_KEY;
  delete process.env.MONTAGE_EXT_REQUIRE_SIGNED;
});

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (kind: string, id: string) => ({ params: Promise.resolve({ kind, id }) });
const j = async (r: Response) => ({ status: r.status, data: await r.json() });

const textIn = { type: "object", properties: { text: { type: "string", maxLength: 1000 } }, required: ["text"] };
const skillPkg = (version: string, extra: Record<string, unknown> = {}) => ({
  manifest: {
    kind: "skill", id: "word_counter", version, name: "عدّاد الكلمات", description: "يحسب كلمات النص (حساب محلي حتمي)", category: "text",
    author: "tester", permissions: [], capabilities: [], input: textIn,
    output: { type: "object", properties: { words: { type: "integer" }, characters: { type: "integer" } } },
    execution: { type: "native", entry: "text_stats" }, ...extra,
  },
  files: {},
});


/** منح صلاحيات عبر المصافحة الإلزامية (T-05): request_approval ثم grant مؤكَّد. */
async function grant(kind: "skills" | "tools", id: string, permissions: string[]) {
  await itemPost(req("/x", "POST", { action: "request_approval", for: "grant" }), ctx(kind, id));
  return itemPost(req("/x", "POST", { action: "grant", permissions, confirmed: true }), ctx(kind, id));
}

describe("Phase 5 acceptance: full skill lifecycle through the HTTP API", () => {
  it("create → test → enable → execute → inspect → disable → update → versions → export → import → delete", async () => {
    // إنشاء
    let r = await j(await listPost(req("/api/extensions", "POST", { op: "create", kind: "skill", package: skillPkg("1.0.0") })));
    expect(r.status).toBe(201);
    expect(r.data.summary).toMatchObject({ id: "word_counter", status: "disabled", version: "1.0.0" });

    // تظهر في «المثبّتة»
    const list = await j(await listGet(req("/api/extensions?kind=skills")));
    expect(list.data.items.map((i: { id: string }) => i.id)).toContain("word_counter");

    // التشغيل وهي معطّلة مرفوض (run) — والاختبار مسموح
    r = await j(await itemPost(req("/api/extensions/skills/word_counter", "POST", { action: "run", input: { text: "مرحبا بكم في المحرر" } }), ctx("skills", "word_counter")));
    expect(r.status).toBe(409);
    r = await j(await itemPost(req("/api/extensions/skills/word_counter", "POST", { action: "test", input: { text: "مرحبا بكم في المحرر" } }), ctx("skills", "word_counter")));
    expect(r.data.ok).toBe(true);

    // تفعيل بعد اختبار ناجح
    r = await j(await itemPost(req("/x", "POST", { action: "enable" }), ctx("skills", "word_counter")));
    expect(r.data.status).toBe("enabled");

    // تنفيذ وفحص المخرجات + المصدر الصادق + السجل
    r = await j(await itemPost(req("/x", "POST", { action: "run", input: { text: "واحد اثنان ثلاثة" } }), ctx("skills", "word_counter")));
    expect(r.data).toMatchObject({ ok: true, output: { words: 3 }, provenance: "computed", simulated: false });
    const detail = await j(await itemGet(req("/x"), ctx("skills", "word_counter")));
    expect(detail.data.runs.length).toBeGreaterThanOrEqual(2);
    expect(detail.data.runs[0]).toMatchObject({ ok: true, version: "1.0.0" });

    // تعطيل
    r = await j(await itemPost(req("/x", "POST", { action: "disable" }), ctx("skills", "word_counter")));
    expect(r.data.status).toBe("disabled");

    // تحديث: الإصدارات المحفوظة غير قابلة للتعديل — محتوى مختلف بنفس الإصدار مرفوض
    expect((await j(await itemPut(req("/x", "PUT", { package: skillPkg("1.0.0", { description: "محتوى مختلف بنفس الإصدار" }) }), ctx("skills", "word_counter")))).status).toBeGreaterThanOrEqual(400);
    r = await j(await itemPut(req("/x", "PUT", { package: skillPkg("1.1.0", { description: "نسخة محدّثة" }), note: "تحسين" }), ctx("skills", "word_counter")));
    expect(r.status).toBe(200);
    expect(r.data.summary.versions).toEqual(expect.arrayContaining(["1.0.0", "1.1.0"]));
    expect(r.data.summary.version).toBe("1.1.0");

    // تبديل الإصدار (تراجع) يعطّل ويُلغي الاختبار
    r = await j(await itemPost(req("/x", "POST", { action: "activate", version: "1.0.0" }), ctx("skills", "word_counter")));
    expect(r.data).toMatchObject({ version: "1.0.0", enabled: false });

    // تصدير ثم حذف ثم استيراد الحزمة المصدَّرة (نفس البيان + بصمة سلامة)
    const exp = await exportGet(req("/x"), ctx("skills", "word_counter"));
    expect(exp.headers.get("content-disposition")).toContain("word_counter");
    const pkg = JSON.parse(await exp.text());
    expect(pkg).toMatchObject({ format: "montage-extension", kind: "skill" });
    expect(pkg.manifest.integrity.digest).toMatch(/^[a-f0-9]{64}$/);

    expect((await j(await itemDelete(req("/x", "DELETE", {}), ctx("skills", "word_counter")))).status).toBe(403); // بلا confirm
    expect((await j(await itemDelete(req("/x", "DELETE", { confirm: true }), ctx("skills", "word_counter")))).data.ok).toBe(true);
    expect((await j(await itemGet(req("/x"), ctx("skills", "word_counter")))).status).toBe(404);

    r = await j(await listPost(req("/api/extensions", "POST", { op: "import", kind: "skill", package: pkg })));
    expect(r.status).toBe(201);
    expect(r.data.summary).toMatchObject({ origin: "imported", status: "disabled" }); // يُستورد معطّلاً
    // حزمة معدّلة بعد التصدير تُرفض (تكامل)
    const tampered = JSON.parse(JSON.stringify(pkg));
    tampered.manifest.id = "word_counter_two";
    tampered.manifest.name = "مُعدَّلة";
    expect((await j(await listPost(req("/api/extensions", "POST", { op: "import", kind: "skill", package: tampered })))).status).toBe(400);
  });

  it("permissions are enforced server-side: declaring is not enough, the owner must grant", async () => {
    const pkg = {
      manifest: {
        kind: "tool", id: "probe_tool", version: "1.0.0", name: "فحص", description: "يفحص وسائط مشروع", category: "analysis", permissions: ["media.read"], capabilities: ["ffmpeg"],
        dependencies: { actions: ["media.probe"] },
        input: { type: "object", properties: { projectId: { type: "string", maxLength: 80 } }, required: ["projectId"] }, output: { type: "object", properties: {} },
        execution: { type: "declarative", action: "media.probe", args: { projectId: "{{input.projectId}}" } },
      },
      files: {},
    };
    expect((await j(await listPost(req("/api/extensions", "POST", { op: "create", kind: "tool", package: pkg })))).status).toBe(201);
    // اختبار بلا منح ⇒ يفشل بصلاحية
    let r = await j(await itemPost(req("/x", "POST", { action: "test", input: { projectId: "nope" } }), ctx("tools", "probe_tool")));
    expect(r.data.ok).toBe(false);
    expect(r.data.error.message).toMatch(/media\.read|صلاح/);
    // لا يمكن تفعيلها بلا منح
    r = await j(await itemPost(req("/x", "POST", { action: "enable", acknowledgeUntested: true }), ctx("tools", "probe_tool")));
    expect(r.status).toBe(403);
    // منح صلاحية لم تُعلَن/لا يحتاجها مرفوض
    r = await j(await grant("tools", "probe_tool", ["exec.external"]));
    expect(r.status).toBeGreaterThanOrEqual(400);
    // بعد المنح الصحيح تتجاوز بوابة الصلاحيات (وتفشل لاحقاً بمشروع غير موجود — لا بصلاحية)
    await grant("tools", "probe_tool", ["media.read"]);
    r = await j(await itemPost(req("/x", "POST", { action: "test", input: { projectId: "nope" } }), ctx("tools", "probe_tool")));
    expect(r.data.ok).toBe(false);
    expect(r.data.error.message).not.toMatch(/صلاح/);
  });

  it("required capabilities are enforced: missing host capability fails clearly instead of faking a result", async () => {
    const pkg = {
      manifest: {
        kind: "skill", id: "needs_chat", version: "1.0.0", name: "يحتاج نموذجاً", description: "مهارة تعليمات تتطلب مفتاح نموذج", category: "text", permissions: ["ai.invoke"], capabilities: ["ai.chat"],
        input: { type: "object", properties: { topic: { type: "string", maxLength: 100 } }, required: ["topic"] }, output: { type: "object", properties: { out: { type: "string" } } },
        execution: { type: "prompt", instructionsFile: "instructions.md" },
      },
      files: { "instructions.md": "اكتب عنواناً قصيراً." },
    };
    expect((await j(await listPost(req("/api/extensions", "POST", { op: "create", kind: "skill", package: pkg })))).status).toBe(201);
    await grant("skills", "needs_chat", ["ai.invoke"]);
    const r = await j(await itemPost(req("/x", "POST", { action: "test", input: { topic: "x" } }), ctx("skills", "needs_chat")));
    expect(r.data.ok).toBe(false);
    expect(r.data.error.code).toBe("DEPENDENCY_MISSING");
    expect(r.data.error.message).toContain("ai.chat");
  });

  it("capability declaration is validated (unknown capability rejected)", async () => {
    const r = await j(await listPost(req("/api/extensions", "POST", { op: "validate", kind: "skill", package: skillPkg("1.0.0", { capabilities: ["teleport"] }) })));
    expect(r.data.ok).toBe(false);
  });
});

describe("Phase 5 discovery (local catalog)", () => {
  it("lists bundled packs with install state; install is disabled with no grants; update only when newer", async () => {
    let r = await j(await catalogGet());
    const entry = r.data.entries.find((e: { id: string }) => e.id === "render_preflight");
    expect(entry).toMatchObject({ kind: "tool", installed: false, valid: true });
    expect(entry.capabilities).toContain("ffmpeg");

    r = await j(await catalogPost(req("/api/extensions/catalog", "POST", { key: entry.key, op: "install" })));
    expect(r.status).toBe(201);
    expect(r.data.summary).toMatchObject({ id: "render_preflight", enabled: false, grants: [] });

    expect((await j(await catalogPost(req("/api/extensions/catalog", "POST", { key: entry.key, op: "install" })))).status).toBe(409); // مثبّتة
    expect((await j(await catalogPost(req("/api/extensions/catalog", "POST", { key: entry.key, op: "update" })))).status).toBe(409); // لا أحدث
    expect((await j(await catalogPost(req("/api/extensions/catalog", "POST", { key: "../../etc/passwd", op: "install" })))).status).toBe(400); // لا اجتياز مسار
    expect((await j(await catalogPost(req("/api/extensions/catalog", "POST", { key: "nope.json", op: "install" })))).status).toBe(404);

    const after = await j(await catalogGet());
    expect(after.data.entries.find((e: { id: string }) => e.id === "render_preflight")).toMatchObject({ installed: true, updateAvailable: false });
  });
});
