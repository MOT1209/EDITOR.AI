import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export interface UpscalePlan {
  enabled: boolean;
  scale: number; // معامل رفع الدقة (2 = ضعف)
  model: string; // نموذج التحسين (real-esrgan افتراضياً)
  targetWidth?: number;
  targetHeight?: number;
}

/**
 * تحسين/رفع دقة الفيديو (Upscale) — ينتج خطة تحسين يستهلكها الرندر/التصدير.
 * يفوّض اختيارياً إلى /api/ai/enhance عند توفّره، وإلا يبني خطة محلية حتمية
 * (تدهور أنيق — مبدأ المشروع #1).
 */
export class UpscaleSkill extends BaseSkill {
  readonly name = "UpscaleSkill";
  readonly description = "رفع دقة الفيديو وتحسين وضوحه (Upscale).";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { width: "number?", height: "number?", scale: "number?" };
  readonly outputSpec = { upscale: "{ enabled, scale, model, targetWidth?, targetHeight? }" };
  protected readonly defaultConfig = {
    scale: 2,
    model: "real-esrgan",
    endpoint: "/api/ai/enhance",
  };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const scale = Math.max(1, Math.min(4, (input.scale as number) ?? this.cfg("scale", 2)));
    const model = this.cfg("model", "real-esrgan");

    const api = await this.callEndpoint<{ upscale?: Partial<UpscalePlan> }>(
      this.cfg("endpoint", "/api/ai/enhance"),
      { kind: "upscale", scale, width: input.width, height: input.height },
      ctx
    );

    const plan: UpscalePlan = {
      enabled: true,
      scale: api?.upscale?.scale ?? scale,
      model: api?.upscale?.model ?? model,
      targetWidth:
        api?.upscale?.targetWidth ??
        (typeof input.width === "number" ? Math.round(input.width * scale) : undefined),
      targetHeight:
        api?.upscale?.targetHeight ??
        (typeof input.height === "number" ? Math.round(input.height * scale) : undefined),
    };

    this.log(
      "info",
      `${api?.upscale ? "API" : "heuristic"}: تحسين ×${plan.scale} (${plan.model})`
    );
    return { upscale: plan };
  }
}
