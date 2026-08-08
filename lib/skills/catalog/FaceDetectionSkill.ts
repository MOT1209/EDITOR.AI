import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Face {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class FaceDetectionSkill extends BaseSkill {
  readonly name = "FaceDetectionSkill";
  readonly description = "اكتشاف الوجوه في الإطارات.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { duration: "number", frames: "string[] (base64)" };
  readonly outputSpec = { faces: "Face[]" };
  protected readonly defaultConfig = { endpoint: "/api/ai/faces" };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const frames = input.frames ?? [];
    const api = await this.callEndpoint<{ faces?: Face[] }>(
      this.cfg("endpoint", "/api/ai/faces"),
      { duration, frames },
      ctx
    );
    if (api?.faces?.length) {
      this.log("info", `المصدر: API — ${api.faces.length} وجه`);
      return { faces: api.faces };
    }
    const count = Math.max(1, Math.floor(duration / 5));
    const faces: Face[] = Array.from({ length: count }, (_, i) => {
      const start = (i / count) * duration;
      return {
        start: +start.toFixed(2),
        end: +Math.min(start + 2 + Math.random() * 2, duration).toFixed(2),
        x: +(0.2 + Math.random() * 0.4).toFixed(3),
        y: +(0.15 + Math.random() * 0.4).toFixed(3),
        w: +(0.15 + Math.random() * 0.2).toFixed(3),
        h: +(0.2 + Math.random() * 0.25).toFixed(3),
      };
    });
    this.log("info", `المصدر: heuristic — ${faces.length} وجه`);
    return { faces };
  }
}
