import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface RampPoint {
  time: number;
  rate: number; // معامل السرعة (1 = طبيعي، 0.5 = إبطاء، 1.5 = تسريع)
}

interface SpeedRamp {
  hookTime: number;
  slowBefore: number; // مدة الإبطاء قبل الـ Hook (ثوانٍ)
  slowRate: number;
  fastAfter: number; // مدة التسريع بعد الـ Hook (ثوانٍ)
  fastRate: number;
  points: RampPoint[];
}

/**
 * إبطاء قبل الـ Hook وتسريع بعده (Speed Ramp):
 * يختار أقوى Highlight (أو أول Hook) ويرسم منحنى سرعة حوله.
 * التدهور الأنيق: بلا Highlights يكتفي بمقطع واحد بلا تغيير (قائمة فارغة).
 */
export class SpeedRampSkill extends BaseSkill {
  readonly name = "SpeedRampSkill";
  readonly description = "إبطاء لحظي قبل اللحظات المميزة وتسريع بعدها (Speed Ramp).";
  readonly category: SkillCategory = "editing";
  readonly inputSpec = { highlights: "Highlight[]", duration: "number" };
  readonly outputSpec = { speedRamps: "SpeedRamp[]" };
  protected readonly defaultConfig = {
    slowBefore: 0.6,
    slowRate: 0.5,
    fastAfter: 0.4,
    fastRate: 1.6,
    minGap: 2.0, // الحد الأدنى بين لحظتين معالجتين
  };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const highlights =
      (input.highlights as Array<{ time: number; score: number }> | undefined) ?? [];
    const slowBefore = this.cfg("slowBefore", 0.6);
    const slowRate = this.cfg("slowRate", 0.5);
    const fastAfter = this.cfg("fastAfter", 0.4);
    const fastRate = this.cfg("fastRate", 1.6);
    const minGap = this.cfg("minGap", 2.0);

    const candidates = highlights
      .filter((h) => h.time >= 0.2 && h.time <= duration - 0.2)
      .slice()
      .sort((a, b) => b.score - a.score);

    const speedRamps: SpeedRamp[] = [];
    let lastTime = -Infinity;
    for (const h of candidates) {
      if (h.time - lastTime < minGap) continue;
      const t0 = Math.max(0, h.time - slowBefore);
      const t1 = h.time;
      const t2 = Math.min(duration, h.time + fastAfter);
      speedRamps.push({
        hookTime: +h.time.toFixed(2),
        slowBefore: +(h.time - t0).toFixed(2),
        slowRate,
        fastAfter: +(t2 - h.time).toFixed(2),
        fastRate,
        points: [
          { time: +t0.toFixed(2), rate: 1 },
          { time: +t1.toFixed(2), rate: slowRate },
          { time: +t2.toFixed(2), rate: fastRate },
        ],
      });
      lastTime = h.time;
    }

    this.log(
      "info",
      `أنشأ ${speedRamps.length} منحنى سرعة (إبطاء ×${slowRate} → تسريع ×${fastRate})`
    );
    return { speedRamps };
  }
}
