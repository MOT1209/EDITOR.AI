import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Moment {
  start: number;
  end: number;
  viralScore?: number;
  score?: number;
}
interface Short {
  id: string;
  start: number;
  end: number;
  aspect: string;
  score: number;
}

export class ShortsGenerationSkill extends BaseSkill {
  readonly name = "ShortsGenerationSkill";
  readonly description = "إنشاء مقاطع Shorts/Reels تلقائياً من أفضل اللحظات.";
  readonly category: SkillCategory = "generation";
  readonly inputSpec = { viralMoments: "Moment[]", highlights: "Moment[]" };
  readonly outputSpec = { shorts: "Short[]" };
  protected readonly defaultConfig = { aspect: "9:16", minLen: 5, maxLen: 60, count: 3 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const source =
      (input.viralMoments as Moment[] | undefined) ??
      (input.highlights as Moment[] | undefined) ??
      [];
    const aspect = this.cfg("aspect", "9:16");
    const minLen = this.cfg("minLen", 5);
    const maxLen = this.cfg("maxLen", 60);

    const shorts: Short[] = source
      .slice(0, this.cfg("count", 3))
      .map((m, i) => {
        const len = Math.min(Math.max(m.end - m.start, minLen), maxLen);
        return {
          id: `short_${i + 1}`,
          start: +m.start.toFixed(2),
          end: +(m.start + len).toFixed(2),
          aspect,
          score: +(m.viralScore ?? m.score ?? 0.6).toFixed(2),
        };
      });
    this.log("info", `تم إنشاء ${shorts.length} مقطع Shorts (${aspect})`);
    return { shorts };
  }
}
