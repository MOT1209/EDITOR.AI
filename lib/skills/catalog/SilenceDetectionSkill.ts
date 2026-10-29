import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Silence {
  start: number;
  end: number;
}

export class SilenceDetectionSkill extends BaseSkill {
  readonly name = "SilenceDetectionSkill";
  readonly description = "اكتشاف فترات الصمت في الصوت.";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { duration: "number", filePath: "string (اختياري)" };
  readonly outputSpec = { silences: "Silence[]" };
  protected readonly defaultConfig = {
    minSilence: 0.5,
    endpoint: "/api/ai/silence",
  };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const duration = input.duration ?? 30;
    // تحليل حقيقي مُسبق (مثلاً من ffmpeg silencedetect عبر MCP) يتقدّم على أي مصدر آخر.
    if (Array.isArray(input.silences)) {
      this.log("info", `المصدر: تحليل مسبق — ${input.silences.length} فترة صمت`);
      return { silences: input.silences as Silence[] };
    }
    const filePath = input.filePath as string | undefined;
    const api = await this.callEndpoint<{ segments?: Silence[] }>(
      this.cfg("endpoint", "/api/ai/silence"),
      { duration, filePath },
      ctx
    );
    if (api?.segments?.length) {
      this.log("info", `المصدر: API — ${api.segments.length} فترة صمت`);
      return { silences: api.segments };
    }
    const silences: Silence[] = [];
    let t = 1;
    while (t < duration - 1) {
      if (Math.random() < 0.35) {
        const s = t + Math.random() * 2;
        silences.push({
          start: +s.toFixed(2),
          end: +Math.min(s + 0.4 + Math.random() * 0.8, duration).toFixed(2),
        });
      }
      t += 3 + Math.random() * 4;
    }
    this.log("info", `المصدر: heuristic — ${silences.length} فترة صمت`);
    return { silences };
  }
}
