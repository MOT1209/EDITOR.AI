import {
  ISkill,
  LogLevel,
  MediaDocument,
  SkillCategory,
  SkillContext,
  SkillDescriptor,
  SkillLogEntry,
  SkillResult,
  SkillStatus,
} from "./types";

/**
 * الأساس المشترك لكل Skill: يدير الحالة (Status)، السجلات (Logs)،
 * الإعدادات (Configuration)، التوقيت، الإلغاء، وتغليف الأخطاء.
 * الـ Skill الفعلية تنفّذ `execute()` فقط.
 */
export abstract class BaseSkill<I = MediaDocument, O = Record<string, unknown>>
  implements ISkill<I, O>
{
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: SkillCategory;

  readonly inputSpec: Record<string, string> = {};
  readonly outputSpec: Record<string, string> = {};

  /** الإعدادات الافتراضية — تُدمج مع أي override عبر configure(). */
  protected readonly defaultConfig: Record<string, unknown> = {};

  config: Record<string, unknown> = {};
  status: SkillStatus = "idle";
  readonly logs: SkillLogEntry[] = [];

  protected aborted = false;
  private configInitialized = false;

  configure(patch: Record<string, unknown>): void {
    this.ensureConfig();
    this.config = { ...this.config, ...patch };
  }

  protected ensureConfig(): void {
    if (!this.configInitialized) {
      this.config = { ...this.defaultConfig, ...this.config };
      this.configInitialized = true;
    }
  }

  protected log(level: LogLevel, message: string, data?: unknown): void {
    this.logs.push({ timestamp: Date.now(), level, message, data });
  }

  /** قيمة إعداد مع نوع افتراضي آمن. */
  protected cfg<T>(key: string, fallback: T): T {
    this.ensureConfig();
    const v = this.config[key];
    return (v === undefined ? fallback : v) as T;
  }

  stop(): void {
    this.aborted = true;
    if (this.status === "running") this.status = "stopped";
  }

  reset(): void {
    this.aborted = false;
    this.status = "idle";
    this.logs.length = 0;
  }

  describe(): SkillDescriptor {
    this.ensureConfig();
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      inputSpec: this.inputSpec,
      outputSpec: this.outputSpec,
      config: this.config,
      status: this.status,
    };
  }

  async run(input: I, ctx: SkillContext): Promise<SkillResult<O>> {
    this.ensureConfig();
    this.aborted = false;
    this.logs.length = 0;
    const startedAt = Date.now();
    this.status = "running";
    this.log("info", `بدء تشغيل ${this.name}`);

    try {
      this.checkAbort();
      const output = await this.execute(input, ctx);
      if (this.aborted) {
        this.status = "stopped";
        this.log("warn", `أُوقف ${this.name}`);
        return this.buildResult(false, startedAt, undefined, "stopped");
      }
      this.status = "completed";
      this.log("info", `اكتمل ${this.name}`);
      return this.buildResult(true, startedAt, output);
    } catch (err) {
      this.status = this.aborted ? "stopped" : "failed";
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `فشل ${this.name}: ${message}`);
      return this.buildResult(false, startedAt, undefined, message);
    }
  }

  protected checkAbort(): void {
    if (this.aborted) throw new Error("أُوقف التنفيذ");
  }

  private buildResult(
    ok: boolean,
    startedAt: number,
    output?: O,
    error?: string
  ): SkillResult<O> {
    return {
      skill: this.name,
      ok,
      status: this.status,
      output,
      error,
      startedAt,
      durationMs: Date.now() - startedAt,
      logs: [...this.logs],
    };
  }

  /**
   * تفويض اختياري لـ API route موجود (مثل /api/ai/scenes).
   * يُستخدم عند توفّر `apiBaseUrl` في الإعدادات؛ وإلا تُستخدم منطقية محلية.
   * يرجع null عند الفشل ليسقط التنفيذ لخطة بديلة (fallback).
   */
  protected async callEndpoint<T>(
    path: string,
    body: unknown,
    ctx: SkillContext
  ): Promise<T | null> {
    const base =
      (this.config.apiBaseUrl as string | undefined) ??
      (ctx.config.apiBaseUrl as string | undefined) ??
      "";
    if (typeof fetch !== "function") return null;
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** المنطق الفعلي للـ Skill — تنفّذه كل Skill على حدة. */
  protected abstract execute(input: I, ctx: SkillContext): Promise<O>;
}
