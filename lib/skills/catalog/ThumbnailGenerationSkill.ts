import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Highlight {
  start: number;
  score: number;
}

export class ThumbnailGenerationSkill extends BaseSkill {
  readonly name = "ThumbnailGenerationSkill";
  readonly description = "إنشاء صورة مصغّرة جذابة (Thumbnail).";
  readonly category: SkillCategory = "generation";
  readonly inputSpec = { highlights: "Highlight[]", titles: "string[]" };
  readonly outputSpec = { thumbnail: "{ frameTime, overlayText, style }" };
  protected readonly defaultConfig = { overlayMaxChars: 28 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const highlights = (input.highlights as Highlight[] | undefined) ?? [];
    // اختر الإطار الأعلى تقييماً كأفضل لقطة للغلاف.
    const best = highlights
      .slice()
      .sort((a, b) => b.score - a.score)[0];
    const frameTime = +(best?.start ?? duration * 0.3).toFixed(2);

    const titles = (input.titles as string[] | undefined) ?? [];
    const maxChars = this.cfg("overlayMaxChars", 28);
    const overlayText = (titles[0] ?? "شاهد حتى النهاية").slice(0, maxChars);

    const thumbnail = {
      frameTime,
      overlayText,
      style: { fontSize: 72, color: "#ffffff", stroke: "#000000", position: "center" },
    };
    this.log("info", `صورة مصغّرة عند ${frameTime}ث`);
    return { thumbnail };
  }
}
