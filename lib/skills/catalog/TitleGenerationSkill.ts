import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class TitleGenerationSkill extends BaseSkill {
  readonly name = "TitleGenerationSkill";
  readonly description = "إنشاء عناوين جذّابة للفيديو.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { transcript: "{ text }", topic: "string?" };
  readonly outputSpec = { titles: "string[]" };
  protected readonly defaultConfig = { count: 5 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const transcript = input.transcript as { text?: string } | undefined;
    const topic =
      (input.topic as string) ||
      (transcript?.text ? transcript.text.split(/\s+/).slice(0, 5).join(" ") : "موضوع الفيديو");

    const patterns = [
      `${topic} | كل ما تحتاج معرفته`,
      `أفضل طريقة لـ ${topic}`,
      `${topic} في دقيقة!`,
      `لماذا الجميع يتحدث عن ${topic}؟`,
      `${topic}: الدليل الكامل`,
      `5 أشياء عن ${topic} ستفاجئك`,
    ];
    const titles = patterns.slice(0, this.cfg("count", 5));
    this.log("info", `تم توليد ${titles.length} عنوان`);
    return { titles };
  }
}
