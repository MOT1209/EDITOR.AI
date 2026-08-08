import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Segment {
  start: number;
  end: number;
  text: string;
}
interface Caption {
  start: number;
  end: number;
  text: string;
  style: Record<string, unknown>;
}

export class AutoCaptionSkill extends BaseSkill {
  readonly name = "AutoCaptionSkill";
  readonly description = "إنشاء ترجمة (Captions) منسّقة من النص المُستخرج.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { transcript: "{ segments }" };
  readonly outputSpec = { captions: "Caption[]" };
  protected readonly defaultConfig = {
    fontSize: 42,
    position: "bottom",
    color: "#ffffff",
    maxChars: 38,
  };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const transcript = input.transcript as { segments?: Segment[] } | undefined;
    const segments = transcript?.segments ?? [];
    const style = {
      fontSize: this.cfg("fontSize", 42),
      position: this.cfg("position", "bottom"),
      color: this.cfg("color", "#ffffff"),
      background: "rgba(0,0,0,0.5)",
    };
    const maxChars = this.cfg("maxChars", 38);

    const captions: Caption[] = segments.map((s) => ({
      start: s.start,
      end: s.end,
      text:
        s.text.length > maxChars ? `${s.text.slice(0, maxChars - 1)}…` : s.text,
      style,
    }));
    this.log("info", `تم إنشاء ${captions.length} ترجمة`);
    return { captions };
  }
}
