import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export class DescriptionGenerationSkill extends BaseSkill {
  readonly name = "DescriptionGenerationSkill";
  readonly description = "إنشاء وصف للفيديو مع نقاط زمنية.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { transcript: "{ text }", scenes: "Scene[]", titles: "string[]" };
  readonly outputSpec = { description: "string" };
  protected readonly defaultConfig = { includeChapters: true };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const titles = (input.titles as string[] | undefined) ?? [];
    const transcript = input.transcript as { text?: string } | undefined;
    const scenes =
      (input.scenes as Array<{ start: number; description?: string }> | undefined) ?? [];

    const intro = titles[0] ?? "فيديو جديد";
    const summary = transcript?.text
      ? transcript.text.slice(0, 160)
      : "وصف تلقائي للفيديو.";

    let chapters = "";
    if (this.cfg("includeChapters", true) && scenes.length > 1) {
      chapters =
        "\n\nالفصول:\n" +
        scenes
          .map((s) => {
            const mm = String(Math.floor(s.start / 60)).padStart(2, "0");
            const ss = String(Math.floor(s.start % 60)).padStart(2, "0");
            return `${mm}:${ss} ${s.description ?? "مشهد"}`;
          })
          .join("\n");
    }
    const description = `${intro}\n\n${summary}${chapters}`;
    this.log("info", "تم توليد الوصف");
    return { description };
  }
}
