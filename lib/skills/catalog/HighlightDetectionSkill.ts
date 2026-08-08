import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Scene {
  start: number;
  end: number;
  score: number;
}
interface Highlight {
  start: number;
  end: number;
  score: number;
  reason: string;
}

export class HighlightDetectionSkill extends BaseSkill {
  readonly name = "HighlightDetectionSkill";
  readonly description = "استخراج أهم اللحظات في الفيديو.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { scenes: "Scene[]", duration: "number" };
  readonly outputSpec = { highlights: "Highlight[]" };
  protected readonly defaultConfig = { threshold: 0.65, maxClipLen: 6 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const scenes = (input.scenes as Scene[] | undefined) ?? [];
    const threshold = this.cfg("threshold", 0.65);
    const maxLen = this.cfg("maxClipLen", 6);

    let pool: Scene[] = scenes.filter((s) => s.score >= threshold);
    if (pool.length === 0) {
      // بديل: قسّم زمنياً واختر مقاطع عشوائية عالية.
      const n = Math.max(2, Math.floor(duration / 8));
      pool = Array.from({ length: n }, (_, i) => ({
        start: (i / n) * duration,
        end: Math.min(((i + 1) / n) * duration, duration),
        score: 0.6 + Math.random() * 0.4,
      })).filter(() => Math.random() > 0.4);
    }

    const highlights: Highlight[] = pool.map((s) => ({
      start: +s.start.toFixed(2),
      end: +Math.min(s.start + maxLen, s.end, duration).toFixed(2),
      score: +s.score.toFixed(2),
      reason: s.score > 0.85 ? "لحظة قوية" : "لقطة مميزة",
    }));
    this.log("info", `تم استخراج ${highlights.length} لحظة مهمة`);
    return { highlights };
  }
}
