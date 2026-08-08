import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class BackgroundRemovalSkill extends BaseSkill {
  readonly name = "BackgroundRemovalSkill";
  readonly description = "إزالة الخلفية / فصل الموضوع عنها.";
  readonly category: SkillCategory = "visual";
  readonly inputSpec = { mode: "'remove'|'blur'|'replace'", replacement: "string?" };
  readonly outputSpec = { backgroundRemoval: "{ enabled, mode, model }" };
  protected readonly defaultConfig = { mode: "remove", model: "u2net" };

  protected async execute(_input: MediaDocument, _ctx: SkillContext) {
    const mode = this.cfg("mode", "remove");
    const model = this.cfg("model", "u2net");
    const backgroundRemoval = {
      enabled: true,
      mode,
      model,
      replacement: this.cfg<string | null>("replacement", null),
      featherPx: 3,
    };
    this.log("info", `إزالة خلفية — وضع: ${mode}`);
    return { backgroundRemoval };
  }
}
