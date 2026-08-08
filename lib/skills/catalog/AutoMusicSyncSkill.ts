import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Span {
  start: number;
  end: number;
}

export class AutoMusicSyncSkill extends BaseSkill {
  readonly name = "AutoMusicSyncSkill";
  readonly description = "مزامنة القصّات مع نبضات الموسيقى.";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { beats: "number[]", keepSegments: "Span[]" };
  readonly outputSpec = { musicSync: "{ snappedCuts: number[] }" };
  protected readonly defaultConfig = { snapWindow: 0.25 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const beats = ((input.beats as number[] | undefined) ?? []).slice().sort((a, b) => a - b);
    const segments =
      (input.trimmed as Span[] | undefined) ??
      (input.keepSegments as Span[] | undefined) ??
      [];
    const win = this.cfg("snapWindow", 0.25);

    const nearestBeat = (t: number): number => {
      if (beats.length === 0) return t;
      let best = beats[0];
      for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
      return Math.abs(best - t) <= win ? best : t;
    };

    // اجذب حدود المقاطع لأقرب نبضة ضمن النافذة.
    const snappedCuts = segments.map((s) => +nearestBeat(s.start).toFixed(3));
    this.log("info", `تمت مزامنة ${snappedCuts.length} قصّة مع الإيقاع`);
    return { musicSync: { snappedCuts, beatsUsed: beats.length } };
  }
}
