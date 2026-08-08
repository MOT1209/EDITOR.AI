import {
  ISkill,
  LogLevel,
  MediaDocument,
  SkillContext,
  SkillDescriptor,
  SkillLogEntry,
  SkillResult,
} from "./types";
import { Workflow, WorkflowResult, WorkflowRunOptions } from "./Workflow";

export interface SkillMetrics {
  skill: string;
  runs: number;
  failures: number;
  totalMs: number;
  avgMs: number;
  lastDurationMs: number;
  lastStatus: string;
}

export interface ManagerErrorEntry {
  timestamp: number;
  skill: string;
  message: string;
}

interface ContextOptions {
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  logSink?: SkillLogEntry[];
}

/**
 * Skill Manager — مسؤول عن:
 * تسجيل Skills، تشغيلها، إيقافها، ترتيب الـ Workflow،
 * مشاركة البيانات، مراقبة الأداء، وتسجيل الأخطاء.
 * إضافة/حذف Skills يتم عبر register/unregister فقط — بلا تعديل للنواة.
 */
export class SkillManager {
  private readonly skills = new Map<string, ISkill>();
  private readonly metrics = new Map<string, SkillMetrics>();
  private readonly workflows = new Map<string, Workflow>();
  private readonly running = new Set<string>();
  readonly errorLog: ManagerErrorEntry[] = [];

  // ---- تسجيل Skills ----
  register(skill: ISkill): this {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill مُسجّلة مسبقاً: ${skill.name}`);
    }
    this.skills.set(skill.name, skill);
    this.metrics.set(skill.name, {
      skill: skill.name,
      runs: 0,
      failures: 0,
      totalMs: 0,
      avgMs: 0,
      lastDurationMs: 0,
      lastStatus: "idle",
    });
    return this;
  }

  registerAll(skills: ISkill[]): this {
    skills.forEach((s) => this.register(s));
    return this;
  }

  unregister(name: string): boolean {
    this.metrics.delete(name);
    return this.skills.delete(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  get(name: string): ISkill | undefined {
    return this.skills.get(name);
  }

  list(): ISkill[] {
    return [...this.skills.values()];
  }

  /** فهرس وصفي لكل Skills (للعرض في الواجهة أو API). */
  catalog(): SkillDescriptor[] {
    return this.list().map((s) => s.describe());
  }

  // ---- Workflows ----
  registerWorkflow(wf: Workflow): this {
    this.workflows.set(wf.name, wf);
    return this;
  }

  getWorkflow(name: string): Workflow | undefined {
    return this.workflows.get(name);
  }

  listWorkflows(): Workflow[] {
    return [...this.workflows.values()];
  }

  // ---- سياق التنفيذ ومشاركة البيانات ----
  createContext(doc: MediaDocument, opts: ContextOptions = {}): SkillContext {
    const shared = doc;
    const results: Record<string, unknown> = {};
    const sink = opts.logSink;
    return {
      shared,
      results,
      config: opts.config ?? {},
      signal: opts.signal,
      get: <T = unknown>(key: string) => shared[key] as T | undefined,
      set: (key: string, value: unknown) => {
        shared[key] = value;
      },
      log: (level: LogLevel, message: string, data?: unknown) => {
        if (sink) sink.push({ timestamp: Date.now(), level, message, data });
      },
    };
  }

  // ---- تشغيل Skill مفردة ----
  async runSkill(
    name: string,
    input: MediaDocument,
    ctx?: SkillContext
  ): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill غير موجودة: ${name}`);
    const context = ctx ?? this.createContext(input);

    this.running.add(name);
    let res: SkillResult;
    try {
      res = await skill.run(input, context);
    } finally {
      this.running.delete(name);
    }

    // ---- مراقبة الأداء ----
    const m = this.metrics.get(name);
    if (m) {
      m.runs += 1;
      m.totalMs += res.durationMs;
      m.avgMs = Math.round(m.totalMs / m.runs);
      m.lastDurationMs = res.durationMs;
      m.lastStatus = res.status;
      if (!res.ok) {
        m.failures += 1;
        this.errorLog.push({
          timestamp: Date.now(),
          skill: name,
          message: res.error ?? "خطأ غير معروف",
        });
      }
    }
    return res;
  }

  // ---- تشغيل Workflow ----
  async runWorkflow(
    workflow: string | Workflow,
    doc: MediaDocument,
    opts?: WorkflowRunOptions
  ): Promise<WorkflowResult> {
    const wf =
      typeof workflow === "string" ? this.workflows.get(workflow) : workflow;
    if (!wf) throw new Error(`Workflow غير موجود: ${String(workflow)}`);
    return wf.run(this, doc, opts);
  }

  // ---- إيقاف ----
  stopSkill(name: string): void {
    this.skills.get(name)?.stop();
  }

  stopAll(): void {
    this.running.forEach((n) => this.skills.get(n)?.stop());
  }

  // ---- مقاييس الأداء والأخطاء ----
  getMetrics(name: string): SkillMetrics | undefined {
    return this.metrics.get(name);
  }

  allMetrics(): SkillMetrics[] {
    return [...this.metrics.values()];
  }

  clearErrors(): void {
    this.errorLog.length = 0;
  }
}
