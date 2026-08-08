import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class HookGenerationSkill extends BaseSkill {
  readonly name = "HookGenerationSkill";
  readonly description = "إنشاء مقدمة جذّابة (Hook) لأول 3 ثوانٍ.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { transcript: "{ text }", topic: "string?" };
  readonly outputSpec = { hook: "{ text, durationSec }" };
  protected readonly defaultConfig = { durationSec: 3 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const transcript = input.transcript as { text?: string } | undefined;
    const topic =
      (input.topic as string) ||
      (transcript?.text ? transcript.text.split(/\s+/).slice(0, 4).join(" ") : "هذا الفيديو");

    const templates = [
      `لا تصدّق ما حدث في ${topic}!`,
      `سر لا يعرفه أحد عن ${topic}`,
      `توقف! شاهد ${topic} قبل فوات الأوان`,
      `${topic} في 30 ثانية فقط`,
    ];
    const text = templates[Math.floor(Math.random() * templates.length)];
    const hook = { text, durationSec: this.cfg("durationSec", 3) };
    this.log("info", `Hook: ${text}`);
    return { hook };
  }
}
