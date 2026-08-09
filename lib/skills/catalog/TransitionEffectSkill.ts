import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export type TransitionKind = "cut" | "fade" | "crossfade" | "dip-to-black";

interface Span {
  start: number;
  end: number;
}

interface Transition {
  from: number; // نهاية المقطع السابق
  to: number; // بداية المقطع التالي
  duration: number; // مدة الانتقال (ثوانٍ)
  kind: TransitionKind;
  reason: string;
}

/**
 * انتقالات بين مقاطع القص: يقترح انتقالاً عند كل حد بين مقطعين مُبقَين.
 * - حد هادئ (فجوة كلام/صمت قبله) → crossfade ناعم.
 * - لحظة Hook/توهج بعد الحد → dip-to-black لشد الانتباه.
 * - غير ذلك → cut مباشر (افتراضي أنظف).
 */
export class TransitionEffectSkill extends BaseSkill {
  readonly name = "TransitionEffectSkill";
  readonly description = "اقتراح انتقالات سينمائية (Fade/Crossfade/Dip) بين المقاطع.";
  readonly category: SkillCategory = "editing";
  readonly inputSpec = {
    keepSegments: "Span[]",
    duration: "number",
    highlights: "Highlight[]?",
  };
  readonly outputSpec = { transitions: "Transition[]" };
  protected readonly defaultConfig = {
    maxDuration: 0.5,
    dipDuration: 0.4,
    hookLookahead: 1.2,
  };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const segments =
      ((input.keepSegments as Span[] | undefined) ?? []).slice() ??
      [{ start: 0, end: input.duration ?? 30 }];
    const maxDur = this.cfg("maxDuration", 0.5);
    const dipDur = this.cfg("dipDuration", 0.4);
    const lookahead = this.cfg("hookLookahead", 1.2);
    const highlights =
      (input.highlights as Array<{ time: number; score: number }> | undefined) ?? [];

    const transitions: Transition[] = [];
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const next = segments[i];
      const boundary = (prev.end + next.start) / 2;
      const hookNearby = highlights.some(
        (h) => h.time >= next.start && h.time <= next.start + lookahead
      );
      const gap = next.start - prev.end; // فجوة بين المقاطع (ثوانٍ)
      const calmGap = gap >= 0.35; // فجوة صمت/كلام قبل الحد

      let kind: TransitionKind;
      let duration: number;
      let reason: string;
      if (hookNearby) {
        kind = "dip-to-black";
        duration = Math.min(dipDur, Math.max(0.2, (next.end - next.start) / 4));
        reason = "لحظة Hook بعد الحد — توقف أسود يشد الانتباه";
      } else if (calmGap) {
        kind = "crossfade";
        duration = Math.min(maxDur, gap * 0.5);
        reason = "فجوة هادئة — دمج ناعم بين المقطعين";
      } else {
        kind = "cut";
        duration = 0;
        reason = "إيقاع متصل — قص مباشر أنظف";
      }
      transitions.push({
        from: +boundary.toFixed(2),
        to: +boundary.toFixed(2),
        duration: +duration.toFixed(2),
        kind,
        reason,
      });
    }

    this.log("info", `اقترح ${transitions.length} انتقالاً (${transitions.filter((t) => t.kind !== "cut").length} غير مباشر)`);
    return { transitions };
  }
}
