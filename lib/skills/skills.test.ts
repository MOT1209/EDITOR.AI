import { describe, it, expect } from "vitest";
import { buildSkillManager } from "./registry";

describe("skills system", () => {
  it("registers all skills and the three workflows", () => {
    const m = buildSkillManager();
    expect(m.list().length).toBeGreaterThanOrEqual(42);
    const wf = m.listWorkflows().map((w) => w.name).sort();
    expect(wf).toEqual(["content-from-idea", "default", "viral-shorts"]);
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
