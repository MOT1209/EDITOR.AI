import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class AudioEnhancementSkill extends BaseSkill {
  readonly name = "AudioEnhancementSkill";
  readonly description = "تحسين جودة الصوت (وضوح، توازن، ضغط).";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { audioBase64: "string (اختياري)" };
  readonly outputSpec = { audioEnhancement: "{ enabled, settings }" };
  protected readonly defaultConfig = { endpoint: "/api/ai/enhance" };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const audioBase64 = input.audioBase64;
    const api = await this.callEndpoint<{
      enhanced?: boolean;
      settings?: Record<string, unknown>;
    }>(this.cfg("endpoint", "/api/ai/enhance"), { audioBase64 }, ctx);

    if (api?.settings) {
      this.log("info", "المصدر: API");
      return {
        audioEnhancement: { enabled: api.enhanced ?? true, settings: api.settings },
      };
    }
    const settings = audioBase64
      ? { noiseReduction: 0.7, compression: 0.5, eq: "balanced", gain: 1.1 }
      : { noiseReduction: 0.5, compression: 0.4, eq: "bright", gain: 1.0 };
    this.log("info", "المصدر: heuristic");
    return { audioEnhancement: { enabled: !!audioBase64, settings } };
  }
}
