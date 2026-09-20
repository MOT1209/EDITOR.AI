import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";
import { GeneratedScript, ScriptSection } from "./ScriptWriterSkill";

export interface StoryboardShot {
  sceneNumber: number;
  text: string;
  durationSec: number;
  shotType: string;
  visualNotes: string;
}

const SHOT_TYPES = ["Close-up", "Medium Shot", "Wide Shot", "Cutaway / B-Roll"];

/**
 * يحوّل سكربت (من ScriptWriterSkill) إلى لوحة مشاهد (Storyboard) —
 * تقسيم كل قسم نصّي إلى لقطة مع نوع تصوير مقترح وملاحظات بصرية.
 * محلي بالكامل، بلا حاجة لمزوّد خارجي (تدهور أنيق دائماً).
 */
export class StoryboardGeneratorSkill extends BaseSkill {
  readonly name = "StoryboardGeneratorSkill";
  readonly description = "تحويل سكربت الفيديو إلى لوحة مشاهد (Storyboard) بلقطات مقترحة.";
  readonly category: SkillCategory = "generation";
  readonly inputSpec = { script: "{ hook, sections[], cta }" };
  readonly outputSpec = { storyboard: "StoryboardShot[]" };
  protected readonly defaultConfig = {};

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const script = input.script as GeneratedScript | undefined;
    if (!script) {
      this.log("warn", "لا يوجد سكربت — نفّذ ScriptWriterSkill أولاً");
      return { storyboard: [] as StoryboardShot[] };
    }

    const shots: StoryboardShot[] = [];
    let sceneNumber = 1;

    shots.push({
      sceneNumber: sceneNumber++,
      text: script.hook,
      durationSec: 3,
      shotType: "Close-up",
      visualNotes: "لقطة قريبة وقوية بصرياً لجذب الانتباه في أول 3 ثوانٍ.",
    });

    (script.sections as ScriptSection[]).forEach((section, i) => {
      shots.push({
        sceneNumber: sceneNumber++,
        text: section.text,
        durationSec: section.durationSec,
        shotType: SHOT_TYPES[i % SHOT_TYPES.length],
        visualNotes: `مشهد مساند للنص — انتقال سلس من اللقطة رقم ${sceneNumber - 1}.`,
      });
    });

    shots.push({
      sceneNumber: sceneNumber++,
      text: script.cta,
      durationSec: 4,
      shotType: "Medium Shot",
      visualNotes: "وجه المتحدث + نص CTA على الشاشة.",
    });

    this.log("info", `تم بناء لوحة مشاهد من ${shots.length} لقطة`);
    return { storyboard: shots };
  }
}
