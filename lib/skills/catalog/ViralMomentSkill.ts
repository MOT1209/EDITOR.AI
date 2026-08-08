import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Highlight {
  start: number;
  end: number;
  score: number;
  reason?: string;
}
interface ViralMoment {
  start: number;
  end: number;
  viralScore: number;
  reason: string;
}

export class ViralMomentSkill extends BaseSkill {
  readonly name = "ViralMomentSkill";
  readonly description = "اكتشاف المقاطع القابلة للانتشار (Viral).";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { highlights: "Highlight[]", faces: "Face[]" };
  readonly outputSpec = { viralMoments: "ViralMoment[]" };
  protected readonly defaultConfig = { top: 3, idealLen: 4 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const highlights = (input.highlights as Highlight[] | undefined) ?? [];
    const faces = (input.faces as Array<{ start: number; end: number }> | undefined) ?? [];
    const idealLen = this.cfg("idealLen", 4);
    const top = this.cfg("top", 3);

    const scored: ViralMoment[] = highlights.map((h) => {
      const len = h.end - h.start;
      // قِصَر المقطع + وجود وجه + قوة المشهد = أعلى احتمال انتشار.
      const lenScore = 1 - Math.min(1, Math.abs(len - idealLen) / idealLen);
      const hasFace = faces.some((f) => f.start < h.end && f.end > h.start) ? 0.2 : 0;
      const viralScore = +(h.score * 0.6 + lenScore * 0.2 + hasFace).toFixed(3);
      return {
        start: h.start,
        end: h.end,
        viralScore,
        reason: hasFace ? "لقطة بوجه + ذروة" : "ذروة محتوى",
      };
    });

    const viralMoments = scored
      .sort((a, b) => b.viralScore - a.viralScore)
      .slice(0, top);
    this.log("info", `أفضل ${viralMoments.length} مقطع قابل للانتشار`);
    return { viralMoments };
  }
}
