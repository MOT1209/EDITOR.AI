import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Scene {
  start: number;
  end: number;
  score: number;
  description?: string;
}

export class SceneDetectionSkill extends BaseSkill {
  readonly name = "SceneDetectionSkill";
  readonly description = "تحليل الفيديو وتقسيمه إلى مشاهد.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { duration: "number", frames: "string[] (base64)" };
  readonly outputSpec = { scenes: "Scene[]" };
  protected readonly defaultConfig = { minSceneLen: 4, endpoint: "/api/ai/scenes" };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const frames = input.frames ?? [];
    const api = await this.callEndpoint<{ scenes?: Scene[] }>(
      this.cfg("endpoint", "/api/ai/scenes"),
      { duration, frames },
      ctx
    );
    if (api?.scenes?.length) {
      this.log("info", `المصدر: API — ${api.scenes.length} مشهد`);
      return { scenes: api.scenes };
    }
    const minLen = this.cfg("minSceneLen", 4);
    const count = Math.max(2, Math.floor(duration / minLen));
    const seg = duration / count;
    const scenes: Scene[] = Array.from({ length: count }, (_, i) => ({
      start: +(i * seg).toFixed(2),
      end: +Math.min((i + 1) * seg, duration).toFixed(2),
      score: +(0.5 + Math.random() * 0.5).toFixed(2),
      description: `مشهد ${i + 1}`,
    }));
    this.log("info", `المصدر: heuristic — ${scenes.length} مشهد`);
    return { scenes };
  }
}
