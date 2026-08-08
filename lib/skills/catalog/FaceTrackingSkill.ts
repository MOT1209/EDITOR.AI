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
interface Track {
  id: string;
  keyframes: Array<{ time: number; x: number; y: number; w: number; h: number }>;
}

export class FaceTrackingSkill extends BaseSkill {
  readonly name = "FaceTrackingSkill";
  readonly description = "تتبع الوجوه عبر الزمن وربطها في مسارات.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { faces: "Face[]" };
  readonly outputSpec = { faceTracks: "Track[]" };
  protected readonly defaultConfig = { proximity: 0.2 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const faces = ((input.faces as Face[] | undefined) ?? [])
      .slice()
      .sort((a, b) => a.start - b.start);
    const prox = this.cfg("proximity", 0.2);
    const tracks: Track[] = [];

    for (const f of faces) {
      const kf = { time: f.start, x: f.x, y: f.y, w: f.w, h: f.h };
      // ابحث عن مسار قريب مكانياً لإلحاق الوجه به.
      const match = tracks.find((t) => {
        const last = t.keyframes[t.keyframes.length - 1];
        return Math.hypot(last.x - f.x, last.y - f.y) <= prox;
      });
      if (match) match.keyframes.push(kf);
      else tracks.push({ id: `face_track_${tracks.length + 1}`, keyframes: [kf] });
    }

    this.log("info", `تم بناء ${tracks.length} مسار وجه`);
    return { faceTracks: tracks };
  }
}
