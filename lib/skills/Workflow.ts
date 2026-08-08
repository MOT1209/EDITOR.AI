import type { SkillManager } from "./SkillManager";
import { MediaDocument, SkillLogEntry, SkillResult } from "./types";

export interface WorkflowStep {
  /** اسم الـ Skill المُسجّلة. */
  skill: string;
  /** عند true لا يوقف فشلُها الـ Workflow (تُتجاوز). */
  optional?: boolean;
  /** إعدادات تُمرَّر للـ Skill قبل تشغيلها. */
  config?: Record<string, unknown>;
}

export interface WorkflowRunOptions {
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface WorkflowResult {
  workflow: string;
  ok: boolean;
  document: MediaDocument;
  steps: SkillResult[];
  errors: string[];
  logs: SkillLogEntry[];
  durationMs: number;
}

/**
 * Workflow = سلسلة خطوات مرتّبة من Skills.
 * قابل للتعديل بالكامل (إضافة/حذف/إدراج خطوات) دون لمس النواة.
 */
export class Workflow {
  readonly steps: WorkflowStep[];

  constructor(
    public readonly name: string,
    public readonly description: string,
    steps: Array<WorkflowStep | string> = []
  ) {
    this.steps = steps.map((s) => (typeof s === "string" ? { skill: s } : s));
  }

  /** إضافة خطوة في النهاية أو عند موضع محدد. */
  addStep(step: WorkflowStep | string, atIndex?: number): this {
    const s = typeof step === "string" ? { skill: step } : step;
    if (atIndex === undefined || atIndex >= this.steps.length) this.steps.push(s);
    else this.steps.splice(Math.max(0, atIndex), 0, s);
    return this;
  }

  /** إدراج خطوة بعد Skill معيّنة بالاسم. */
  insertAfter(afterSkill: string, step: WorkflowStep | string): this {
    const idx = this.steps.findIndex((s) => s.skill === afterSkill);
    return this.addStep(step, idx === -1 ? this.steps.length : idx + 1);
  }

  /** حذف خطوة بالاسم. */
  removeStep(skill: string): this {
    const idx = this.steps.findIndex((s) => s.skill === skill);
    if (idx !== -1) this.steps.splice(idx, 1);
    return this;
  }

  list(): string[] {
    return this.steps.map((s) => s.skill);
  }

  /** تنفيذ الـ Workflow بالترتيب مع مشاركة المستند بين الخطوات. */
  async run(
    manager: SkillManager,
    doc: MediaDocument,
    opts: WorkflowRunOptions = {}
  ): Promise<WorkflowResult> {
    const startedAt = Date.now();
    const logs: SkillLogEntry[] = [];
    const ctx = manager.createContext(doc, {
      config: opts.config,
      signal: opts.signal,
      logSink: logs,
    });

    const steps: SkillResult[] = [];
    const errors: string[] = [];

    for (const step of this.steps) {
      if (opts.signal?.aborted) {
        errors.push("أُلغي الـ Workflow");
        break;
      }
      if (!manager.has(step.skill)) {
        errors.push(`Skill غير مُسجّلة: ${step.skill}`);
        if (!step.optional) break;
        continue;
      }
      if (step.config) manager.get(step.skill)!.configure(step.config);

      ctx.log("info", `▶ تشغيل خطوة: ${step.skill}`);
      const res = await manager.runSkill(step.skill, ctx.shared, ctx);
      steps.push(res);

      if (res.ok && res.output) {
        // دمج الناتج في المستند المشترك وتسجيله باسم الـ Skill.
        Object.assign(ctx.shared, res.output);
        ctx.results[step.skill] = res.output;
      }

      if (!res.ok) {
        errors.push(`${step.skill}: ${res.error ?? "خطأ غير معروف"}`);
        if (!step.optional) {
          ctx.log("error", `توقّف الـ Workflow عند ${step.skill}`);
          break;
        }
      }
    }

    return {
      workflow: this.name,
      ok: errors.length === 0,
      document: ctx.shared,
      steps,
      errors,
      logs,
      durationMs: Date.now() - startedAt,
    };
  }
}
