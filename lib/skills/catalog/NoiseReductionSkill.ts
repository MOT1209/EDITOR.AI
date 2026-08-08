import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class NoiseReductionSkill extends BaseSkill {
  readonly name = "NoiseReductionSkill";
  readonly description = "إزالة الضوضاء من الصوت.";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { amount: "number 0..1", noiseFloorDb: "number" };
  readonly outputSpec = { noiseReduction: "{ enabled, amount, filter }" };
  protected readonly defaultConfig = { amount: 0.6, noiseFloorDb: -28 };

  protected async execute(_input: MediaDocument, _ctx: SkillContext) {
    const amount = this.cfg("amount", 0.6);
    const floor = this.cfg("noiseFloorDb", -28);
    const noiseReduction = {
      enabled: true,
      amount,
      noiseFloorDb: floor,
      // afftdn = denoise filter في ffmpeg.
      filter: `afftdn=nr=${Math.round(amount * 30)}:nf=${floor}`,
    };
    this.log("info", `تقليل ضوضاء بنسبة ${Math.round(amount * 100)}%`);
    return { noiseReduction };
  }
}
