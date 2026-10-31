import { describe, it, expect } from "vitest";
import { buildSkillManager } from "./registry";

describe("skills system", () => {
  it("registers all skills and the three workflows", () => {
    const m = buildSkillManager();
    expect(m.list().length).toBeGreaterThanOrEqual(43);
    const wf = m.listWorkflows().map((w) => w.name).sort();
    expect(wf).toEqual(["content-from-idea", "default", "viral-shorts"]);
  });

  it("runs UpscaleSkill with heuristic fallback (no API key)", async () => {
    const m = buildSkillManager();
    const r = await m.runSkill("UpscaleSkill", { duration: 10, width: 640, height: 360, scale: 2 });
    expect(r.ok).toBe(true);
    const plan = (r.output as { upscale?: { targetWidth?: number; scale?: number } }).upscale;
    expect(plan?.scale).toBe(2);
    expect(plan?.targetWidth).toBe(1280);
  });

  it("runs a single skill and reports a result", async () => {
    const m = buildSkillManager();
    const r = await m.runSkill("ScriptWriterSkill", {
      duration: 60,
      topic: "الذكاء الاصطناعي",
    });
    expect(r.ok).toBe(true);
    expect((r.output as { script?: unknown }).script).toBeTruthy();
  });

  it("runs content-from-idea end to end with graceful degradation (no API key)", async () => {
    const m = buildSkillManager();
    const res = await m.runWorkflow("content-from-idea", {
      duration: 60,
      topic: "استكشاف الفضاء",
    });
    expect(res.ok).toBe(true);
    const doc = res.document as Record<string, unknown>;
    expect(doc.script).toBeTruthy();
    expect(Array.isArray(doc.storyboard)).toBe(true);
    expect((doc.storyboard as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(doc.titles)).toBe(true);
  });

  it("exposes a descriptor catalog", () => {
    const m = buildSkillManager();
    const cat = m.catalog();
    expect(cat.every((d) => d.name && d.category)).toBe(true);
  });
});

import { SKILL_DOMAINS, domainOf } from "./domains";
import { QualityControlSkill } from "./catalog/QualityControlSkill";

describe("skill domains (Phase 5 taxonomy)", () => {
  const names = buildSkillManager().list().map((s) => s.name);
  it("each of the 8 required domains has at least one registered skill", () => {
    for (const id of ["video-analysis", "video-editing", "audio-processing", "subtitles", "visual-effects", "color-correction", "export-optimization", "quality-control"] as const) {
      const registered = SKILL_DOMAINS[id].skills.filter((n) => names.includes(n));
      expect(registered.length, id).toBeGreaterThan(0);
    }
  });
  it("every registered skill belongs to exactly one domain and every mapped name exists", () => {
    for (const n of names.filter((x) => !x.startsWith("ext_"))) expect(domainOf(n), n).not.toBeNull();
    for (const d of Object.values(SKILL_DOMAINS)) for (const n of d.skills) expect(names, n).toContain(n);
    const all = Object.values(SKILL_DOMAINS).flatMap((d) => d.skills);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("QualityControlSkill (computed, no invented results)", () => {
  it("flags overlapping/too-fast captions and heavy silence; skips what it cannot check", async () => {
    const m = buildSkillManager();
    const r = await m.runSkill("QualityControlSkill", { duration: 20, captions: [{ start: 0, end: 2, text: "x".repeat(60) }, { start: 1.5, end: 3, text: "ok" }], silences: [{ start: 0, end: 12 }] });
    const qc = (r.output as { qc: { passed: boolean; checks: { id: string; status: string }[] } }).qc;
    const by = Object.fromEntries(qc.checks.map((c) => [c.id, c.status]));
    expect(by.captions).toBe("fail");
    expect(by.silence).toBe("warn");
    expect(by.aspect).toBe("skipped");
    expect(qc.passed).toBe(false);
  });
  it("a clean document passes; an empty one is never reported as passing", async () => {
    const m = buildSkillManager();
    const ok = (await m.runSkill("QualityControlSkill", { duration: 20, captions: [{ start: 0, end: 3, text: "مرحبا بكم" }], silences: [], platform: "tiktok", aspect: "9:16" })).output as { qc: { passed: boolean } };
    expect(ok.qc.passed).toBe(true);
    const bad = (await m.runSkill("QualityControlSkill", { duration: 0 })).output as { qc: { passed: boolean } };
    expect(bad.qc.passed).toBe(false);
  });
});
