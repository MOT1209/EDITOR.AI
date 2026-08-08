import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface DetectedObject {
  start: number;
  end: number;
  label: string;
  confidence: number;
}
interface PersonTrack {
  id: string;
  start: number;
  end: number;
  confidence: number;
}

export class PersonTrackingSkill extends BaseSkill {
  readonly name = "PersonTrackingSkill";
  readonly description = "تتبع الأشخاص عبر اللقطات.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { objects: "DetectedObject[]", faces: "Face[]" };
  readonly outputSpec = { personTracks: "PersonTrack[]" };
  protected readonly defaultConfig = { mergeGap: 1.5 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const objects = (input.objects as DetectedObject[] | undefined) ?? [];
    const people = objects
      .filter((o) => o.label.toLowerCase().includes("person"))
      .sort((a, b) => a.start - b.start);
    const mergeGap = this.cfg("mergeGap", 1.5);

    const tracks: PersonTrack[] = [];
    for (const p of people) {
      const last = tracks[tracks.length - 1];
      if (last && p.start - last.end <= mergeGap) {
        last.end = Math.max(last.end, p.end);
        last.confidence = Math.max(last.confidence, p.confidence);
      } else {
        tracks.push({
          id: `person_${tracks.length + 1}`,
          start: p.start,
          end: p.end,
          confidence: p.confidence,
        });
      }
    }
    this.log("info", `تم تتبع ${tracks.length} شخص`);
    return { personTracks: tracks };
  }
}
