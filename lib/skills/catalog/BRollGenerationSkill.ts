import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface DetectedObject {
  label: string;
}
interface BRollSuggestion {
  time: number;
  keyword: string;
  duration: number;
}

export class BRollGenerationSkill extends BaseSkill {
  readonly name = "BRollGenerationSkill";
  readonly description = "اقتراح وإضافة لقطات داعمة (B-Roll).";
  readonly category: SkillCategory = "generation";
  readonly inputSpec = { objects: "DetectedObject[]", highlights: "Highlight[]" };
  readonly outputSpec = { bRoll: "BRollSuggestion[]" };
  protected readonly defaultConfig = { clipLen: 2.5, perMinute: 4 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const objects = (input.objects as DetectedObject[] | undefined) ?? [];
    const highlights =
      (input.highlights as Array<{ start: number }> | undefined) ?? [];
    const clipLen = this.cfg("clipLen", 2.5);
    const perMinute = this.cfg("perMinute", 4);

    const keywords =
      objects.length > 0
        ? [...new Set(objects.map((o) => o.label))]
        : ["لقطة عامة", "طبيعة", "مدينة", "تقنية"];

    const count = Math.max(1, Math.round((duration / 60) * perMinute));
    const bRoll: BRollSuggestion[] = Array.from({ length: count }, (_, i) => ({
      time: +(highlights[i]?.start ?? (i / count) * duration).toFixed(2),
      keyword: keywords[i % keywords.length],
      duration: clipLen,
    }));
    this.log("info", `تم اقتراح ${bRoll.length} لقطة B-Roll`);
    return { bRoll };
  }
}
