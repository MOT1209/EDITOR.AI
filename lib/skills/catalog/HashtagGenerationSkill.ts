import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface DetectedObject {
  label: string;
}

export class HashtagGenerationSkill extends BaseSkill {
  readonly name = "HashtagGenerationSkill";
  readonly description = "إنشاء هاشتاغات مناسبة للمحتوى.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { objects: "DetectedObject[]", topic: "string?" };
  readonly outputSpec = { hashtags: "string[]" };
  protected readonly defaultConfig = { count: 10 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const objects = (input.objects as DetectedObject[] | undefined) ?? [];
    const fromObjects = [...new Set(objects.map((o) => o.label))].map(
      (l) => `#${l.replace(/\s+/g, "_")}`
    );
    const evergreen = [
      "#shorts",
      "#reels",
      "#viral",
      "#fyp",
      "#trending",
      "#explore",
      "#مونتاج",
      "#تصميم",
    ];
    const hashtags = [...new Set([...fromObjects, ...evergreen])].slice(
      0,
      this.cfg("count", 10)
    );
    this.log("info", `تم توليد ${hashtags.length} هاشتاغ`);
    return { hashtags };
  }
}
