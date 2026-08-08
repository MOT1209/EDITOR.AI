import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Span {
  start: number;
  end: number;
}

export class SmartTrimSkill extends BaseSkill {
  readonly name = "SmartTrimSkill";
  readonly description = "تحسين القص التلقائي بدمج المقاطع القصيرة وتنعيم الحواف.";
  readonly category: SkillCategory = "editing";
  readonly inputSpec = { keepSegments: "Span[]" };
  readonly outputSpec = { trimmed: "Span[]" };
  protected readonly defaultConfig = { minSegment: 0.8, mergeGap: 0.25 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const segs = (((input.keepSegments as Span[] | undefined) ?? [
      { start: 0, end: duration },
    ]) as Span[])
      .slice()
      .sort((a, b) => a.start - b.start);

    const mergeGap = this.cfg("mergeGap", 0.25);
    const minSeg = this.cfg("minSegment", 0.8);

    // دمج المقاطع المتقاربة.
    const merged: Span[] = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && s.start - last.end <= mergeGap) {
        last.end = Math.max(last.end, s.end);
      } else {
        merged.push({ ...s });
      }
    }
    // إسقاط المقاطع الأقصر من الحد الأدنى.
    const trimmed = merged.filter((s) => s.end - s.start >= minSeg);

    this.log("info", `الناتج: ${trimmed.length} مقطع بعد التحسين`);
    return { trimmed };
  }
}
