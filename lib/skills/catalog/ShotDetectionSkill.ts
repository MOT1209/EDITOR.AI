import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Scene {
  start: number;
  end: number;
}
interface Shot {
  start: number;
  end: number;
  sceneIndex: number;
}

export class ShotDetectionSkill extends BaseSkill {
  readonly name = "ShotDetectionSkill";
  readonly description = "اكتشاف بداية ونهاية اللقطات (أدق من المشاهد).";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { duration: "number", scenes: "Scene[] (اختياري)" };
  readonly outputSpec = { shots: "Shot[]" };
  protected readonly defaultConfig = { shotLen: 2 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const scenes = (input.scenes as Scene[] | undefined) ?? [
      { start: 0, end: duration },
    ];
    const shotLen = this.cfg("shotLen", 2);
    const shots: Shot[] = [];
    scenes.forEach((sc, si) => {
      const span = Math.max(0.1, sc.end - sc.start);
      const n = Math.max(1, Math.round(span / shotLen));
      const step = span / n;
      for (let i = 0; i < n; i++) {
        shots.push({
          start: +(sc.start + i * step).toFixed(2),
          end: +Math.min(sc.start + (i + 1) * step, sc.end).toFixed(2),
          sceneIndex: si,
        });
      }
    });
    this.log("info", `تم اكتشاف ${shots.length} لقطة`);
    return { shots };
  }
}
