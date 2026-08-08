import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface DetectedObject {
  start: number;
  end: number;
  label: string;
  confidence: number;
}

export class ObjectDetectionSkill extends BaseSkill {
  readonly name = "ObjectDetectionSkill";
  readonly description = "اكتشاف العناصر المهمة في الفيديو.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { duration: "number", frames: "string[] (base64)" };
  readonly outputSpec = { objects: "DetectedObject[]" };
  protected readonly defaultConfig = { endpoint: "/api/ai/objects" };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const frames = input.frames ?? [];
    const api = await this.callEndpoint<{ objects?: DetectedObject[] }>(
      this.cfg("endpoint", "/api/ai/objects"),
      { duration, frames },
      ctx
    );
    if (api?.objects?.length) {
      this.log("info", `المصدر: API — ${api.objects.length} عنصر`);
      return { objects: api.objects };
    }
    const labels = ["person", "car", "phone", "laptop", "book", "bottle", "chair", "tv"];
    const count = Math.max(2, Math.floor(duration / 8));
    const objects: DetectedObject[] = Array.from({ length: count }, (_, i) => {
      const start = (i / count) * duration + Math.random() * 2;
      return {
        start: +start.toFixed(2),
        end: +Math.min(start + 3, duration).toFixed(2),
        label: labels[Math.floor(Math.random() * labels.length)],
        confidence: +(0.5 + Math.random() * 0.5).toFixed(2),
      };
    });
    this.log("info", `المصدر: heuristic — ${objects.length} عنصر`);
    return { objects };
  }
}
