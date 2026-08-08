import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class ColorCorrectionSkill extends BaseSkill {
  readonly name = "ColorCorrectionSkill";
  readonly description = "تصحيح الألوان (توازن أبيض، تعريض، تباين).";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { quality: "{ brightness, contrast, saturation, sharpness }" };
  readonly outputSpec = { colorCorrection: "{ exposure, contrast, whiteBalance, saturation }" };
  protected readonly defaultConfig = { target: 0.6 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const target = this.cfg("target", 0.6);
    const q =
      (input.quality as
        | {
            brightness?: number;
            contrast?: number;
            saturation?: number;
            sharpness?: number;
          }
        | undefined) ?? {};

    // صحّح كل قناة باتجاه القيمة المستهدفة.
    const adjust = (cur?: number) =>
      cur === undefined ? 0 : +(target - cur).toFixed(3);

    const colorCorrection = {
      exposure: adjust(q.brightness),
      contrast: adjust(q.contrast),
      saturation: adjust(q.saturation),
      sharpen: q.sharpness !== undefined && q.sharpness < 0.5 ? 0.3 : 0,
      whiteBalance: "auto",
    };
    this.log("info", "تم تصحيح الألوان نحو القيم المرجعية");
    return { colorCorrection };
  }
}
