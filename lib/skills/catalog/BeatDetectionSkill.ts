import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class BeatDetectionSkill extends BaseSkill {
  readonly name = "BeatDetectionSkill";
  readonly description = "تحليل الإيقاع واستخراج النبضات (BPM/Beats).";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { duration: "number", bpm: "number?" };
  readonly outputSpec = { bpm: "number", beats: "number[]", editPoints: "EditPoint[]" };
  protected readonly defaultConfig = { endpoint: "/api/ai/music-sync", defaultBpm: 120 };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const bpm = (input.bpm as number) || this.cfg("defaultBpm", 120);
    const api = await this.callEndpoint<{
      bpm?: number;
      beats?: number[];
      editPoints?: Array<{ time: number; strength: number }>;
    }>(this.cfg("endpoint", "/api/ai/music-sync"), { bpm, duration }, ctx);

    if (api?.beats?.length) {
      this.log("info", `المصدر: API — ${api.beats.length} نبضة @ ${api.bpm} BPM`);
      return { bpm: api.bpm ?? bpm, beats: api.beats, editPoints: api.editPoints ?? [] };
    }

    const interval = 60 / bpm;
    const beats: number[] = [];
    for (let t = 0; t < duration; t += interval) beats.push(+t.toFixed(3));
    const editPoints = beats
      .map((time, i) => ({ time, strength: i % 4 === 0 ? 1 : 0.5 }))
      .filter((_, i) => i % 2 === 0);
    this.log("info", `المصدر: heuristic — ${beats.length} نبضة @ ${bpm} BPM`);
    return { bpm, beats, editPoints };
  }
}
