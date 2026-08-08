import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface MusicTrack {
  title: string;
  mood: string;
  bpm: number;
  energy: number;
}

export class MusicRecommendationSkill extends BaseSkill {
  readonly name = "MusicRecommendationSkill";
  readonly description = "اختيار موسيقى مناسبة لمزاج الفيديو.";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { highlights: "Highlight[]", mood: "string?" };
  readonly outputSpec = { musicRecommendations: "MusicTrack[]" };
  protected readonly defaultConfig = { count: 3 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const highlights = (input.highlights as Array<{ score: number }> | undefined) ?? [];
    const avg =
      highlights.length > 0
        ? highlights.reduce((a, h) => a + h.score, 0) / highlights.length
        : 0.6;
    const mood =
      (input.mood as string) ||
      (avg > 0.8 ? "energetic" : avg > 0.6 ? "upbeat" : "calm");

    const library: Record<string, MusicTrack[]> = {
      energetic: [
        { title: "Pulse Drive", mood: "energetic", bpm: 140, energy: 0.9 },
        { title: "Neon Rush", mood: "energetic", bpm: 128, energy: 0.85 },
      ],
      upbeat: [
        { title: "Sunny Steps", mood: "upbeat", bpm: 120, energy: 0.7 },
        { title: "Good Vibes", mood: "upbeat", bpm: 112, energy: 0.65 },
      ],
      calm: [
        { title: "Soft Light", mood: "calm", bpm: 90, energy: 0.4 },
        { title: "Slow Tide", mood: "calm", bpm: 78, energy: 0.35 },
      ],
    };
    const musicRecommendations = (library[mood] ?? library.upbeat).slice(
      0,
      this.cfg("count", 3)
    );
    this.log("info", `مزاج: ${mood} — ${musicRecommendations.length} مقترح`);
    return { musicRecommendations, musicMood: mood };
  }
}
