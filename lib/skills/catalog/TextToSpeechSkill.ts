import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class TextToSpeechSkill extends BaseSkill {
  readonly name = "TextToSpeechSkill";
  readonly description = "تحويل النص إلى صوت (TTS).";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { text: "string", voice: "string", language: "string" };
  readonly outputSpec = { tts: "{ text, voice, estDuration }" };
  protected readonly defaultConfig = { voice: "ar-male-1", wpm: 150 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    // يأخذ النص من input.text أو من الـ hook إن وُجد.
    const text =
      (input.text as string) ||
      ((input.hook as { text?: string } | undefined)?.text ?? "");
    if (!text) {
      this.log("warn", "لا يوجد نص للتحويل");
      return { tts: null, skipped: "no_text" };
    }
    const wpm = this.cfg("wpm", 150);
    const words = text.trim().split(/\s+/).length;
    const tts = {
      text,
      voice: this.cfg("voice", "ar-male-1"),
      language: (input.language as string) || "ar",
      estDuration: +((words / wpm) * 60).toFixed(1),
    };
    this.log("info", `TTS لـ ${words} كلمة (~${tts.estDuration}ث)`);
    return { tts };
  }
}
