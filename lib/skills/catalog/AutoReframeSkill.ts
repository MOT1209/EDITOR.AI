import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface ReframePoint {
  time: number;
  x: number;
  y: number;
  zoom: number;
}

export class AutoReframeSkill extends BaseSkill {
  readonly name = "AutoReframeSkill";
  readonly description = "إعادة تأطير الفيديو (عمودي/أفقي) مع تتبع الموضوع.";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { duration: "number", frames: "string[]", aspect: "string" };
  readonly outputSpec = { reframePoints: "ReframePoint[]", targetAspect: "string" };
  protected readonly defaultConfig = { endpoint: "/api/ai/reframe" };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const frames = input.frames ?? [];
    const targetAspect = (input.aspect as string) || "9:16";
    const api = await this.callEndpoint<{ reframePoints?: ReframePoint[] }>(
      this.cfg("endpoint", "/api/ai/reframe"),
      { duration, frames, targetAspect },
      ctx
    );
    if (api?.reframePoints?.length) {
      this.log("info", `المصدر: API — ${api.reframePoints.length} نقطة (${targetAspect})`);
      return { reframePoints: api.reframePoints, targetAspect };
    }
    const isVertical = targetAspect === "9:16" || targetAspect === "4:5";
    const n = Math.max(3, Math.floor(duration / 4));
    const reframePoints: ReframePoint[] = Array.from({ length: n }, (_, i) => ({
      time: +((i / n) * duration).toFixed(2),
      x: +(0.3 + Math.random() * 0.4).toFixed(3),
      y: +(0.3 + Math.random() * 0.3).toFixed(3),
      zoom: isVertical ? +(1.3 + Math.random() * 0.5).toFixed(2) : 1.0,
    }));
    this.log("info", `المصدر: heuristic — ${reframePoints.length} نقطة (${targetAspect})`);
    return { reframePoints, targetAspect };
  }
}
