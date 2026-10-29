// اختبارات نظام الإضافات: مخطط، بيان، تحقق، دورة حياة، تنفيذ، أمان. مساحة عمل مؤقتة لكل تشغيل.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { compareSemver, satisfiesRange } from "./semver";
import { lintSchema, validateAgainst, type ObjectSchema } from "./schema";
import { parsePackage, parseManifest, verifyIntegrity, withIntegrity, type ExtensionPackage, type Manifest } from "./manifest";
import { resolveArgs } from "./template";
import { validatePackage } from "./validate";
import * as svc from "./service";
import { createProject } from "@/lib/engine/store";
import { buildExtendedSkillManager } from "./skills-bridge";
import { skillProvenance } from "@/lib/skills/provenance";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "montage_ext_test_"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  process.env.MONTAGE_WORKSPACE = path.join(tmp, `ws_${Math.random().toString(36).slice(2)}`);
  delete process.env.OPENCODE_API_KEY;
  delete process.env.MONTAGE_EXT_EXTERNAL;
  delete process.env.MONTAGE_EXT_ALLOWLIST;
});

const textInput: ObjectSchema = { type: "object", properties: { text: { type: "string", maxLength: 1000 } }, required: ["text"] };

function nativeSkill(over: Record<string, unknown> = {}): { manifest: unknown; files: Record<string, string> } {
  return {
    manifest: {
      kind: "skill", id: "word_stats", version: "1.0.0", name: "إحصاءات الكلمات", description: "يحسب كلمات النص", category: "text",
      tags: ["نص"], author: "me", permissions: [], input: textInput,
      output: { type: "object", properties: { words: { type: "integer" }, characters: { type: "integer" }, estimatedSpeechSeconds: { type: "number" } } },
      execution: { type: "native", entry: "text_stats" }, ...over,
    },
    files: {},
  };
}

function listTool(over: Record<string, unknown> = {}) {
  return {
    manifest: {
      kind: "tool", id: "my_projects", version: "1.0.0", name: "مشاريعي", description: "يعرض المشاريع", category: "utility",
      permissions: ["project.read"], dependencies: { actions: ["project.list"] }, execution: { type: "declarative", action: "project.list", args: {} }, ...over,
    },
    files: {},
  };
}

describe("semver + schema", () => {
  it("compares versions and ranges", () => {
    expect(compareSemver("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(satisfiesRange("0.2.0", ">=0.2.0 <1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.0", ">=0.2.0 <1.0.0")).toBe(false);
  });
  it("rejects unsupported/unsafe schema keys and validates strictly", () => {
    expect(lintSchema({ type: "object", properties: { a: { type: "string", pattern: ".*" } } }).join()).toMatch(/pattern/);
    expect(lintSchema({ type: "object", properties: { "bad key": { type: "string" } } }).join()).toMatch(/اسم خاصية/);
    expect(validateAgainst(textInput, { text: "x" }).ok).toBe(true);
    expect(validateAgainst(textInput, { text: "x", extra: 1 }).ok).toBe(false); // حقل غير معرّف
    expect(validateAgainst(textInput, {}).ok).toBe(false);
  });
  it("template resolution never reaches prototypes", () => {
    const r = resolveArgs({ a: "{{input.x}}", b: "{{input.__proto__.polluted}}", c: "n={{input.n}}" }, { input: { x: 5, n: 2 }, steps: [] });
    expect(r).toEqual({ a: 5, c: "n=2" });
  });
});

describe("manifest + integrity", () => {
  it("parses a package, signs it and detects tampering", () => {
    const p = parsePackage({ format: "montage-extension", formatVersion: 1, kind: "skill", ...nativeSkill() });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const signed = withIntegrity(p.pkg.manifest, p.pkg.files);
    expect(verifyIntegrity(signed, p.pkg.files)).toBe("ok");
    expect(verifyIntegrity({ ...signed, name: "other" } as Manifest, p.pkg.files)).toBe("mismatch");
  });
  it("rejects bad ids, unknown format versions and path-like file names", () => {
    expect(parseManifest({ ...(nativeSkill().manifest as object), id: "../evil" }).ok).toBe(false);
    expect(parsePackage({ format: "montage-extension", formatVersion: 9, kind: "skill", ...nativeSkill() }).ok).toBe(false);
    expect(parsePackage({ format: "montage-extension", formatVersion: 1, kind: "skill", ...nativeSkill(), files: { "../x.md": "a" } }).ok).toBe(false);
  });
});

describe("validation gates", () => {
  const mk = (raw: { manifest: unknown; files: Record<string, string> }): ExtensionPackage => {
    const r = parsePackage({ format: "montage-extension", formatVersion: 1, kind: (raw.manifest as { kind: string }).kind, ...raw });
    if (!r.ok) throw new Error(r.errors.join());
    return r.pkg;
  };
  it("rejects unknown actions, undeclared permissions and bad references", async () => {
    const unknown = await validatePackage(mk(listTool({ execution: { type: "declarative", action: "shell.exec", args: {} } })));
    expect(unknown.ok).toBe(false);
    expect(unknown.issues.map((i) => i.message).join()).toMatch(/إجراء غير معروف/);
    const noPerm = await validatePackage(mk(listTool({ permissions: [] })));
    expect(noPerm.ok).toBe(false);
    expect(noPerm.issues.map((i) => i.message).join()).toMatch(/غير معلنة/);
    const badRef = await validatePackage(mk(listTool({
      permissions: ["media.read"], dependencies: { actions: ["analysis.silence"] },
      execution: { type: "declarative", action: "analysis.silence", args: { projectId: "{{input.nope}}" } },
    })));
    expect(badRef.issues.map((i) => i.message).join()).toMatch(/غير معرّف في input/);
  });
  it("rejects action args that are not part of the action schema (no free-form ffmpeg args)", async () => {
    const r = await validatePackage(mk(listTool({
      permissions: ["media.read"], dependencies: { actions: ["media.probe"] },
      input: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      execution: { type: "declarative", action: "media.probe", args: { projectId: "{{input.projectId}}", ffmpegArgs: "-f lavfi" } },
    })));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join()).toMatch(/ffmpegArgs/);
  });
  it("flags incompatible platform ranges and missing native entries", async () => {
    const inc = await validatePackage(mk(nativeSkill({ compat: { formatVersion: 1, montage: ">=9.0.0" } })));
    expect(inc.issues.some((i) => i.code === "COMPAT" && i.level === "error")).toBe(true);
    const miss = await validatePackage(mk(nativeSkill({ execution: { type: "native", entry: "nonexistent_entry" } })));
    expect(miss.issues.some((i) => i.code === "DEPENDENCY" && i.level === "error")).toBe(true);
  });
});

describe("lifecycle (store + service)", () => {
  it("creates disabled, refuses duplicates, requires grants/tests to enable, versions and rolls back", async () => {
    const created = await svc.saveExtension(nativeSkill(), { kind: "skill", origin: "user", update: false });
    expect(created.summary.enabled).toBe(false);
    expect(created.summary.label).toBe("experimental"); // stability الافتراضي experimental
    await expect(svc.saveExtension(nativeSkill(), { kind: "skill", origin: "imported", update: false })).rejects.toMatchObject({ code: "CONFLICT" });

    // لم تُختبر بعد
    await expect(svc.setEnabled("skill", "word_stats", true)).rejects.toMatchObject({ code: "CONFLICT" });
    const t = await svc.runExtension("skill", "word_stats", { text: "واحد اثنان ثلاثة" }, { mode: "test" });
    expect(t.ok).toBe(true);
    expect(t.output).toMatchObject({ words: 3 });
    expect(t.provenance).toBe("computed");
    const on = await svc.setEnabled("skill", "word_stats", true);
    expect(on.status).toBe("enabled");

    // إصدار جديد يجب أن يكون أعلى، والفعّال يبقى حتى التبديل
    await expect(svc.saveExtension(nativeSkill(), { kind: "skill", origin: "user", update: true })).resolves.toBeTruthy(); // نفس المحتوى: لا تغيير
    await expect(svc.saveExtension(nativeSkill({ name: "تغيير" }), { kind: "skill", origin: "user", update: true })).rejects.toMatchObject({ code: "CONFLICT" });
    const v2 = await svc.saveExtension(nativeSkill({ version: "1.1.0", name: "نسخة 2" }), { kind: "skill", origin: "user", update: true });
    expect(v2.summary.version).toBe("1.0.0");
    expect(v2.summary.versions).toEqual(["1.0.0", "1.1.0"]);
    const act = await svc.activateVersion("skill", "word_stats", "1.1.0");
    expect(act.version).toBe("1.1.0");
    expect(act.enabled).toBe(false); // التبديل يعطّل حتى إعادة الاختبار
    const back = await svc.activateVersion("skill", "word_stats", "1.0.0");
    expect(back.name).toBe("إحصاءات الكلمات");

    const exp = await svc.exportExtension("skill", "word_stats");
    expect(verifyIntegrity(exp.manifest, exp.files)).toBe("ok");
    const dup = await svc.duplicateExtension("skill", "word_stats", "word_stats_copy");
    expect(dup.label).toBe("experimental");
    await svc.deleteExtension("skill", "word_stats_copy");
    expect((await svc.listExtensions("skill")).map((e) => e.id)).toEqual(["word_stats"]);
  });

  it("rejects path-like version strings (no traversal through export/activate)", async () => {
    await svc.saveExtension(nativeSkill(), { kind: "skill", origin: "user", update: false });
    await expect(svc.exportExtension("skill", "word_stats", "../../audit")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(svc.activateVersion("skill", "word_stats", "../x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.getExtensionDetail("skill", "../../etc")).rejects.toBeTruthy();
  });

  it("filters by query/tag/label and only grants declared permissions", async () => {
    await svc.saveExtension(listTool(), { kind: "tool", origin: "imported", update: false });
    expect((await svc.listExtensions("tool", { label: "experimental" })).length).toBe(1);
    expect((await svc.listExtensions("tool", { q: "مشاريعي" })).length).toBe(1);
    expect((await svc.listExtensions("tool", { q: "zzz" })).length).toBe(0);
    await expect(svc.grantPermissions("tool", "my_projects", ["project.write"])).rejects.toMatchObject({ code: "FORBIDDEN_PATH" });
    await expect(svc.runExtension("tool", "my_projects", {}, { mode: "run" })).rejects.toMatchObject({ code: "UNSUPPORTED" }); // معطّلة
    const denied = await svc.runExtension("tool", "my_projects", {}, { mode: "test" });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe("APPROVAL_DENIED"); // لم تُمنح project.read
    await svc.grantPermissions("tool", "my_projects", ["project.read"]);
    const good = await svc.runExtension("tool", "my_projects", {}, { mode: "test" });
    expect(good.ok).toBe(true);
    expect(good.provenance).toBe("computed");
  });
});

describe("execution honesty and safety", () => {
  it("prompt skills never fabricate output without a model key", async () => {
    await svc.saveExtension({
      manifest: {
        kind: "skill", id: "tagline", version: "1.0.0", name: "شعار", description: "يقترح شعاراً", category: "text", permissions: ["ai.invoke"],
        input: { type: "object", properties: { topic: { type: "string", maxLength: 200 } }, required: ["topic"] },
        output: { type: "object", properties: { tagline: { type: "string" } }, required: ["tagline"] },
        execution: { type: "prompt" },
      },
      files: { "instructions.md": "اكتب شعاراً قصيراً." },
    }, { kind: "skill", origin: "user", update: false });
    await svc.grantPermissions("skill", "tagline", ["ai.invoke"]);
    const r = await svc.runExtension("skill", "tagline", { topic: "قهوة" }, { mode: "test" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("DEPENDENCY_MISSING");
    expect(r.output).toBeUndefined();
  });

  it("write actions need approval; denial leaves the project untouched", async () => {
    const proj = await createProject({ name: "t", aspect: "16:9" });
    await svc.saveExtension(listTool({
      id: "add_title", name: "عنوان", permissions: ["project.write"], dependencies: { actions: ["timeline.add_text"] },
      input: { type: "object", properties: { projectId: { type: "string", maxLength: 80 }, text: { type: "string", maxLength: 100 } }, required: ["projectId", "text"] },
      execution: { type: "declarative", action: "timeline.add_text", args: { projectId: "{{input.projectId}}", text: "{{input.text}}", start: 0, end: 1 } },
    }), { kind: "tool", origin: "user", update: false });
    await svc.grantPermissions("tool", "add_title", ["project.write"]);
    const noChannel = await svc.runExtension("tool", "add_title", { projectId: proj.id, text: "مرحبا" }, { mode: "test" });
    expect(noChannel.error?.code).toBe("APPROVAL_DENIED");
    const denied = await svc.runExtension("tool", "add_title", { projectId: proj.id, text: "مرحبا" }, { mode: "test", approve: async () => { throw Object.assign(new Error("no"), { code: "APPROVAL_DENIED" }); } });
    expect(denied.ok).toBe(false);
    const { getProject } = await import("@/lib/engine/store");
    expect((await getProject(proj.id)).textOverlays.length).toBe(0);
  });

  it("external execution is disabled by default and cannot be enabled by a package alone", async () => {
    const r = await svc.saveExtension({
      manifest: {
        kind: "skill", id: "ext_tool", version: "1.0.0", name: "خارجي", description: "برنامج خارجي", category: "utility", permissions: ["exec.external"],
        input: textInput, execution: { type: "external", entry: "my_script" },
      },
      files: {},
    }, { kind: "skill", origin: "imported", update: false });
    expect(r.validation.issues.some((i) => i.code === "EXTERNAL")).toBe(true);
    await svc.grantPermissions("skill", "ext_tool", ["exec.external"]);
    const run = await svc.runExtension("skill", "ext_tool", { text: "x" }, { mode: "test", approve: async () => {} });
    expect(run.ok).toBe(false);
    expect(run.error?.code).toBe("UNSUPPORTED");
  });

  it("enabled custom skills join the existing SkillManager under ext_ names with declared provenance", async () => {
    await svc.saveExtension(nativeSkill(), { kind: "skill", origin: "user", update: false });
    await svc.runExtension("skill", "word_stats", { text: "a b" }, { mode: "test" });
    await svc.setEnabled("skill", "word_stats", true);
    const { manager } = await buildExtendedSkillManager();
    expect(manager.has("ext_word_stats")).toBe(true);
    expect(manager.has("SceneDetectionSkill")).toBe(true);
    const res = await manager.runSkill("ext_word_stats", { duration: 5, text: "ثلاث كلمات هنا" });
    expect(res.ok).toBe(true);
    expect(skillProvenance("ext_word_stats", res.logs)).toBe("computed");
    expect((res.output as Record<string, { words: number }>).ext_word_stats.words).toBe(3);
  });
});

describe("resource limits", () => {
  it("caps concurrency per extension and global, and the per-minute rate; slots are released", async () => {
    const { registerNativeEntry } = await import("./native");
    const { resetLimits } = await import("./limits");
    let gate: () => void = () => {};
    const open = new Promise<void>((r) => (gate = r));
    registerNativeEntry({ id: "slow_test", description: "بطيء", permissions: [], provenance: "computed", run: async () => (await open, { ok: 1 }) });
    resetLimits();
    process.env.MONTAGE_EXT_MAX_PER_EXT = "2";
    process.env.MONTAGE_EXT_RATE_PER_MIN = "5";
    await svc.saveExtension(nativeSkill({ id: "slow_one", execution: { type: "native", entry: "slow_test" }, output: { type: "object", properties: {} } }), { kind: "skill", origin: "user", update: false });
    const run = () => svc.runExtension("skill", "slow_one", { text: "a" }, { mode: "test" });
    const a = run(), b = run();
    await new Promise((r) => setTimeout(r, 30));
    const c = await run();
    expect(c.ok).toBe(false);
    expect(c.error?.code).toBe("LIMIT_EXCEEDED");
    gate();
    expect((await a).ok && (await b).ok).toBe(true);
    expect((await run()).ok).toBe(true); // الخانات أُفرجت
    // المعدّل: 3 تشغيلات ناجحة حتى الآن + 1 مرفوض لا يُحتسب ⇒ بقي 2 ثم يُرفض السادس
    await run(); await run();
    expect((await run()).error?.code).toBe("LIMIT_EXCEEDED");
    delete process.env.MONTAGE_EXT_MAX_PER_EXT;
    delete process.env.MONTAGE_EXT_RATE_PER_MIN;
    resetLimits();
  });
});
