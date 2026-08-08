import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Span {
  start: number;
  end: number;
}
interface SfxCue {
  time: number;
  effect: string;
}

export class SoundEffectsSkill extends BaseSkill {
  readonly name = "SoundEffectsSkill";
  readonly description = "إضافة مؤثرات صوتية عند نقاط القص والانتقالات.";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { keepSegments: "Span[]", highlights: "Highlight[]" };
  readonly outputSpec = { soundEffects: "SfxCue[]" };
  protected readonly defaultConfig = { transition: "whoosh", impact: "pop" };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const segments =
      (input.trimmed as Span[] | undefined) ??
      (input.keepSegments as Span[] | undefined) ??
      [];
    const highlights = (input.highlights as Span[] | undefined) ?? [];

    const cues: SfxCue[] = [];
    // مؤثر انتقال عند بداية كل مقطع (عدا الأول).
    segments.slice(1).forEach((s) =>
      cues.push({ time: +s.start.toFixed(2), effect: this.cfg("transition", "whoosh") })
    );
    // مؤثر تأكيد عند بداية كل لحظة مهمة.
    highlights.forEach((h) =>
      cues.push({ time: +h.start.toFixed(2), effect: this.cfg("impact", "pop") })
    );
    cues.sort((a, b) => a.time - b.time);
    this.log("info", `تمت إضافة ${cues.length} مؤثر صوتي`);
    return { soundEffects: cues };
  }
}
