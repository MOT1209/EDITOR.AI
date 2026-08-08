import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Span {
  start: number;
  end: number;
}

export class AutoCutSkill extends BaseSkill {
  readonly name = "AutoCutSkill";
  readonly description = "حذف الأجزاء غير المهمة (الصمت الطويل) تلقائياً.";
  readonly category: SkillCategory = "editing";
  readonly inputSpec = { duration: "number", silences: "Silence[]" };
  readonly outputSpec = { cuts: "Span[]", keepSegments: "Span[]" };
  protected readonly defaultConfig = { minCut: 0.6, padding: 0.1 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const silences = ((input.silences as Span[] | undefined) ?? []).slice();
    const minCut = this.cfg("minCut", 0.6);
    const pad = this.cfg("padding", 0.1);

    // نقص فقط فترات الصمت الأطول من العتبة.
    const cuts: Span[] = silences
      .filter((s) => s.end - s.start >= minCut)
      .map((s) => ({
        start: +(s.start + pad).toFixed(2),
        end: +Math.max(s.start + pad, s.end - pad).toFixed(2),
      }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);

    // المقاطع المُبقاة = ما بين القصّات.
    const keepSegments: Span[] = [];
    let cursor = 0;
    for (const c of cuts) {
      if (c.start > cursor) {
        keepSegments.push({ start: +cursor.toFixed(2), end: +c.start.toFixed(2) });
      }
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < duration) {
      keepSegments.push({ start: +cursor.toFixed(2), end: +duration.toFixed(2) });
    }

    const removed = cuts.reduce((a, c) => a + (c.end - c.start), 0);
    this.log("info", `حذف ${cuts.length} مقطع (${removed.toFixed(1)}ث)`);
    return { cuts, keepSegments };
  }
}
