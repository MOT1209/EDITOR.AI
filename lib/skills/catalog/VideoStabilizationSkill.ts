import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class VideoStabilizationSkill extends BaseSkill {
  readonly name = "VideoStabilizationSkill";
  readonly description = "تثبيت اهتزاز الفيديو.";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { duration: "number", strength: "number 0..1" };
  readonly outputSpec = { stabilization: "{ enabled, strength, smoothing, cropMargin }" };
  protected readonly defaultConfig = { strength: 0.6, smoothing: 10 };

  protected async execute(_input: MediaDocument, _ctx: SkillContext) {
    const strength = this.cfg("strength", 0.6);
    const smoothing = this.cfg("smoothing", 10);
    // معامِلات قابلة للتمرير لـ ffmpeg vidstab أو لمحرك المعاينة.
    const stabilization = {
      enabled: true,
      strength,
      smoothing,
      cropMargin: +(0.02 + strength * 0.06).toFixed(3),
      filter: `vidstabdetect=shakiness=${Math.round(1 + strength * 9)} | vidstabtransform=smoothing=${smoothing}`,
    };
    this.log("info", `تثبيت بقوة ${strength}`);
    return { stabilization };
  }
}
