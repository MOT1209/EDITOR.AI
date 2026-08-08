import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class AutoColorGradingSkill extends BaseSkill {
  readonly name = "AutoColorGradingSkill";
  readonly description = "تحسين الألوان وإضافة Look سينمائي تلقائي.";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { quality: "{ brightness, contrast, saturation }", look: "string" };
  readonly outputSpec = { colorGrade: "{ look, lut, params }" };
  protected readonly defaultConfig = { look: "cinematic", intensity: 0.7 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const look = this.cfg("look", "cinematic");
    const intensity = this.cfg("intensity", 0.7);
    const q =
      (input.quality as
        | { brightness?: number; contrast?: number; saturation?: number }
        | undefined) ?? {};

    const looks: Record<string, Record<string, number>> = {
      cinematic: { contrast: 0.18, saturation: 0.1, temperature: -0.05, shadows: -0.08 },
      warm: { contrast: 0.08, saturation: 0.15, temperature: 0.12, shadows: 0.02 },
      vibrant: { contrast: 0.12, saturation: 0.28, temperature: 0.0, shadows: 0.0 },
      clean: { contrast: 0.05, saturation: 0.05, temperature: 0.0, shadows: 0.0 },
    };
    const base = looks[look] ?? looks.cinematic;
    const params = Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, +(v * intensity).toFixed(3)])
    );
    const colorGrade = {
      look,
      lut: `${look}.cube`,
      params,
      autoBalanced: q.brightness !== undefined,
    };
    this.log("info", `تدرّج لوني: ${look} (${intensity})`);
    return { colorGrade };
  }
}
